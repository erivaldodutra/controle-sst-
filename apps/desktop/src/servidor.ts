/**
 * Sobe o banco PostgreSQL embutido e a API no próprio computador.
 * Não depende do Electron, para poder ser testado isoladamente.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type EmbeddedPostgres from 'embedded-postgres' with { 'resolution-mode': 'import' };
import { Client } from 'pg';
import { criarApp, migrar, type ServicoBackup } from '@sst/api';

/** Guarda segredos cifrados pelo sistema operacional (DPAPI no Windows). */
export interface Cofre {
  cifrar(texto: string): Buffer;
  decifrar(dados: Buffer): string;
}

export interface Segredos {
  senhaSuper: string;
  senhaDono: string;
  senhaApp: string;
  /** Chave de 32 bytes (base64) para dados sensíveis cifrados pela aplicação. */
  chaveDados: string;
  /** Senha dos backups, para o backup automático ao fechar. */
  senhaBackup?: string;
}

export const ARQ_SEGREDOS = 'segredos.bin';
/** Gravado só depois que o banco foi criado, preparado e migrado pela primeira vez. */
export const ARQ_PRONTO = 'banco-pronto';
export const BANCO_NOME = 'sst';

const novaSenha = () => randomBytes(24).toString('base64url');

export function lerSegredos(pastaDados: string, cofre: Cofre): Segredos | null {
  const arq = join(pastaDados, ARQ_SEGREDOS);
  if (!existsSync(arq)) return null;
  return JSON.parse(cofre.decifrar(readFileSync(arq)));
}

export function gravarSegredos(pastaDados: string, cofre: Cofre, s: Segredos) {
  writeFileSync(join(pastaDados, ARQ_SEGREDOS), cofre.cifrar(JSON.stringify(s)), { mode: 0o600 });
}

async function portaLivre(): Promise<number> {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.unref();
    s.on('error', erro);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as any).port;
      s.close(() => ok(p));
    });
  });
}

export interface OpcoesServidor {
  pastaDados: string;
  pastaWeb?: string;
  pastaMigrations?: string;
  cofre: Cofre;
  backup?: (srv: Servidor) => ServicoBackup;
  log?: (m: string) => void;
  /** Porta fixa da interface (para abrir no navegador). Sem ela, usa uma porta livre qualquer. */
  portaApi?: number;
}

export class Servidor {
  private pg?: EmbeddedPostgres;
  private portaPg = 0;
  private fecharApi?: () => Promise<void>;
  segredos!: Segredos;
  url = '';

  constructor(readonly op: OpcoesServidor) {}

  get pastaPg() {
    return join(this.op.pastaDados, 'pg');
  }

  private async criarPg(): Promise<EmbeddedPostgres> {
    // embedded-postgres é publicado só como ES module.
    const { default: EP } = await import('embedded-postgres');
    return new EP({
      databaseDir: this.pastaPg,
      user: 'postgres',
      password: this.segredos.senhaSuper,
      port: this.portaPg,
      persistent: true,
      authMethod: 'scram-sha-256',
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
      onLog: (m: unknown) => this.op.log?.(`[pg] ${String(m).trim()}`),
      onError: (m: unknown) => this.op.log?.(`[pg:erro] ${String(m).trim()}`),
    } as any);
  }

  async iniciarBanco() {
    // Mantém a porta ao religar (ex.: depois do backup), pois a API já está conectada nela.
    if (!this.portaPg) this.portaPg = await portaLivre();
    this.pg = await this.criarPg();
    await this.pg.start();
  }

  async pararBanco() {
    await this.pg?.stop();
    this.pg = undefined;
  }

  urlBanco(usuario: 'postgres' | 'sst_owner' | 'sst_app', banco = BANCO_NOME) {
    const senha = { postgres: this.segredos.senhaSuper, sst_owner: this.segredos.senhaDono, sst_app: this.segredos.senhaApp }[usuario];
    return `postgres://${usuario}:${encodeURIComponent(senha)}@127.0.0.1:${this.portaPg}/${banco}`;
  }

  async iniciar() {
    mkdirSync(this.op.pastaDados, { recursive: true });
    const marca = join(this.op.pastaDados, ARQ_PRONTO);
    let existentes = lerSegredos(this.op.pastaDados, this.op.cofre);
    let temPg = existsSync(join(this.pastaPg, 'PG_VERSION'));

    if (!existsSync(marca) && (existentes || temPg)) {
      // Uma primeira execução anterior não terminou (ex.: falhou ao criar o banco).
      // Se o banco nem chegou a existir, ou não abre, recomeça do zero guardando os restos ao lado.
      let aproveitavel = false;
      if (temPg && existentes) {
        this.segredos = existentes;
        aproveitavel = await this.iniciarBanco().then(() => true, () => false);
        if (aproveitavel) aproveitavel = await this.temBancoDoSistema();
        if (!aproveitavel) await this.pararBanco().catch(() => {});
      }
      if (!aproveitavel) {
        const sufixo = new Date().toISOString().replace(/[:.]/g, '-');
        this.op.log?.(`Primeira execução incompleta encontrada; recomeçando (restos guardados com sufixo ${sufixo})`);
        if (existsSync(this.pastaPg)) renameSync(this.pastaPg, `${this.pastaPg}-incompleto-${sufixo}`);
        const arq = join(this.op.pastaDados, ARQ_SEGREDOS);
        if (existsSync(arq)) renameSync(arq, `${arq}-incompleto-${sufixo}`);
        existentes = null;
        temPg = false;
        this.pg = undefined;
        this.portaPg = 0;
      }
    }

    const primeiraVez = !temPg;
    if (primeiraVez && existentes) throw new Error('Os dados do banco não foram encontrados, mas há configuração anterior. Restaure um backup.');
    if (!primeiraVez && !existentes) throw new Error('A configuração protegida do banco não foi encontrada. Restaure um backup.');
    this.segredos = existentes ?? {
      senhaSuper: novaSenha(), senhaDono: novaSenha(), senhaApp: novaSenha(), chaveDados: randomBytes(32).toString('base64'),
    };
    if (primeiraVez) {
      gravarSegredos(this.op.pastaDados, this.op.cofre, this.segredos);
      this.portaPg = await portaLivre();
      this.pg = await this.criarPg();
      this.op.log?.('Criando banco de dados local');
      await this.pg.initialise();
      await this.pg.start();
      await this.prepararPapeis();
    } else if (!this.pg) {
      await this.iniciarBanco();
    }
    await migrar(this.urlBanco('sst_owner'), this.op.pastaMigrations, (m) => this.op.log?.(m));
    if (!existsSync(marca)) writeFileSync(marca, new Date().toISOString());
    await this.iniciarApi();
  }

  /** O banco do sistema existe e o dono das tabelas consegue entrar nele? */
  private async temBancoDoSistema(): Promise<boolean> {
    const c = new Client({ connectionString: this.urlBanco('sst_owner') });
    try {
      await c.connect();
      return true;
    } catch {
      return false;
    } finally {
      await c.end().catch(() => {});
    }
  }

  /** Cria os papéis: dono das tabelas (migrations) e aplicação (sujeita ao RLS). */
  private async prepararPapeis() {
    const c = new Client({ connectionString: this.urlBanco('postgres', 'postgres') });
    await c.connect();
    try {
      await c.query(`CREATE ROLE sst_owner LOGIN PASSWORD '${this.segredos.senhaDono.replace(/'/g, "''")}'`);
      await c.query(`CREATE ROLE sst_app LOGIN PASSWORD '${this.segredos.senhaApp.replace(/'/g, "''")}'`);
      await c.query(`CREATE DATABASE ${BANCO_NOME} OWNER sst_owner ENCODING 'UTF8'`);
      await c.query(`REVOKE ALL ON DATABASE ${BANCO_NOME} FROM PUBLIC`);
      await c.query(`GRANT CONNECT ON DATABASE ${BANCO_NOME} TO sst_owner, sst_app`);
    } finally {
      await c.end();
    }
    // Extensões usadas pelas migrations são criadas pelo superusuário.
    const d = new Client({ connectionString: this.urlBanco('postgres') });
    await d.connect();
    try {
      await d.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await d.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
      await d.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await d.query('ALTER SCHEMA public OWNER TO sst_owner');
    } finally {
      await d.end();
    }
  }

  private async iniciarApi() {
    const { app, banco } = await criarApp({
      config: { urlApp: this.urlBanco('sst_app'), chaveDados: Buffer.from(this.segredos.chaveDados, 'base64'), horasSessao: 12, cookieSeguro: false },
      pastaWeb: this.op.pastaWeb,
      log: false,
      backup: this.op.backup?.(this),
      hostsPermitidos: this.op.portaApi ? [`localhost:${this.op.portaApi}`, `127.0.0.1:${this.op.portaApi}`] : undefined,
    });
    const porta = this.op.portaApi ?? (await portaLivre());
    try {
      await app.listen(porta, '127.0.0.1');
    } catch (e: any) {
      await app.close().catch(() => {});
      await banco.fechar().catch(() => {});
      if (e?.code === 'EADDRINUSE')
        throw new Error(`A porta ${porta} já está em uso por outro programa. Feche esse programa e abra o Controle SST de novo.`);
      throw e;
    }
    this.url = `http://127.0.0.1:${porta}`;
    this.fecharApi = async () => {
      await app.close();
      await banco.fechar();
    };
  }

  async parar() {
    await this.fecharApi?.().catch(() => {});
    this.fecharApi = undefined;
    await this.pararBanco().catch(() => {});
  }
}
