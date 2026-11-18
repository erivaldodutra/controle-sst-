import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ServicoBackup } from '@sst/api';
import { abrirBackup, criarBackup } from './backup';
import { gravarSegredos, Servidor } from './servidor';

export interface Dialogos {
  escolherDestino(nomeSugerido: string): Promise<string | null>;
  escolherArquivo(): Promise<string | null>;
  reiniciar(): void;
}

const MANTER_AUTOMATICOS = 10;

const carimbo = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

export class GestorBackup implements ServicoBackup {
  private ocupado = false;

  constructor(private readonly srv: Servidor, private readonly dialogos: Dialogos) {}

  get pasta() {
    const p = join(this.srv.op.pastaDados, 'backups');
    mkdirSync(p, { recursive: true });
    return p;
  }

  private lista() {
    return readdirSync(this.pasta)
      .filter((f) => f.endsWith('.sstbak'))
      .map((f) => {
        const st = statSync(join(this.pasta, f));
        return { arquivo: f, caminho: join(this.pasta, f), criadoEm: st.mtime.toISOString(), bytes: st.size };
      })
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  async estado() {
    return {
      senhaConfigurada: !!this.srv.segredos.senhaBackup,
      pasta: this.pasta,
      backups: this.lista().map(({ arquivo, criadoEm, bytes }) => ({ arquivo, criadoEm, bytes })),
    };
  }

  async definirSenha(senha: string) {
    this.srv.segredos.senhaBackup = senha;
    gravarSegredos(this.srv.op.pastaDados, this.srv.op.cofre, this.srv.segredos);
  }

  private async exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    if (this.ocupado) throw Object.assign(new Error('Já existe um backup ou restauração em andamento'), { code: 'P0001' });
    this.ocupado = true;
    try {
      return await fn();
    } finally {
      this.ocupado = false;
    }
  }

  /** Para o banco por alguns segundos, copia e religa. */
  async criarAgora(reiniciarBanco = true) {
    const senha = this.srv.segredos.senhaBackup;
    if (!senha) throw Object.assign(new Error('Defina a senha dos backups antes de criar um backup'), { code: 'P0001' });
    return this.exclusivo(async () => {
      const destino = join(this.pasta, `controle-sst-${carimbo()}.sstbak`);
      await this.srv.pararBanco();
      try {
        await criarBackup(destino, this.srv.pastaPg, this.srv.segredos, senha);
      } finally {
        if (reiniciarBanco) await this.srv.iniciarBanco();
      }
      for (const x of this.lista().slice(MANTER_AUTOMATICOS)) rmSync(x.caminho, { force: true });
      return { arquivo: destino };
    });
  }

  async exportar() {
    const ultimo = this.lista()[0];
    if (!ultimo) throw Object.assign(new Error('Ainda não há backup. Crie um backup primeiro.'), { code: 'P0001' });
    const destino = await this.dialogos.escolherDestino(ultimo.arquivo);
    if (!destino) return { arquivo: null };
    copyFileSync(ultimo.caminho, destino);
    return { arquivo: destino };
  }

  async restaurar(senha: string) {
    const arquivo = await this.dialogos.escolherArquivo();
    if (!arquivo) return { restaurado: false };
    return this.exclusivo(async () => {
      const temp = join(this.srv.op.pastaDados, 'restauracao-temp');
      // Confere tudo antes de mexer no banco atual.
      const segredos = await abrirBackup(arquivo, senha, temp);
      // Só o banco é parado aqui: fechar a API dentro desta própria requisição travaria a resposta.
      await this.srv.pararBanco();
      const anterior = join(this.srv.op.pastaDados, `pg-antes-da-restauracao-${carimbo()}`);
      if (existsSync(this.srv.pastaPg)) renameSync(this.srv.pastaPg, anterior);
      renameSync(temp, this.srv.pastaPg);
      // O PostgreSQL exige que só o dono acesse a pasta de dados.
      chmodSync(this.srv.pastaPg, 0o700);
      gravarSegredos(this.srv.op.pastaDados, this.srv.op.cofre, { ...segredos, senhaBackup: senha });
      // Reinicia depois de responder a requisição.
      setTimeout(() => this.dialogos.reiniciar(), 300);
      return { restaurado: true };
    });
  }
}
