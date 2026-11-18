import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { ConfigBackup, EstadoBackup, ServicoBackup } from '@sst/api';
import { abrirBackup, criarBackup } from './backup';
import { gravarSegredos, Servidor } from './servidor';

export interface Dialogos {
  escolherDestino(nomeSugerido: string): Promise<string | null>;
  escolherArquivo(): Promise<string | null>;
  escolherPasta(): Promise<string | null>;
  reiniciar(): void;
}

export const ARQ_CONFIG_BACKUP = 'backup-config.json';
export const CONFIG_PADRAO: ConfigBackup = { pasta: null, frequencia: 'diario', aoSair: true, manter: 10 };
const INTERVALO = { diario: 24 * 3600_000, semanal: 7 * 24 * 3600_000 } as const;
/** Nome dos arquivos criados pelo sistema; só esses entram na limpeza dos antigos. */
const NOME_AUTOMATICO = /^controle-sst-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.sstbak$/;

const carimbo = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const falha = (m: string) => Object.assign(new Error(m), { code: 'P0001' });

export class GestorBackup implements ServicoBackup {
  private ocupado = false;
  private relogio?: NodeJS.Timeout;
  private primeiro?: NodeJS.Timeout;

  constructor(private readonly srv: Servidor, private readonly dialogos: Dialogos, private readonly log?: (m: string) => void) {}

  /** Pasta interna, dentro da pasta de dados. Usada quando nenhuma outra foi escolhida ou ela não está acessível. */
  get pastaPadrao() {
    const p = join(this.srv.op.pastaDados, 'backups');
    mkdirSync(p, { recursive: true });
    return p;
  }

  get config(): ConfigBackup {
    try {
      return { ...CONFIG_PADRAO, ...JSON.parse(readFileSync(join(this.srv.op.pastaDados, ARQ_CONFIG_BACKUP), 'utf8')) };
    } catch {
      return { ...CONFIG_PADRAO };
    }
  }

  /** Pasta onde o próximo backup será gravado e, se a escolhida não estiver acessível, o aviso. */
  private destino(): { pasta: string; aviso?: string } {
    const { pasta } = this.config;
    if (!pasta) return { pasta: this.pastaPadrao };
    try {
      mkdirSync(pasta, { recursive: true });
      accessSync(pasta, constants.W_OK);
      return { pasta };
    } catch {
      return {
        pasta: this.pastaPadrao,
        aviso: `A pasta escolhida (${pasta}) não está acessível agora. Se for um pendrive ou HD externo, conecte-o. Enquanto isso, os backups são gravados em ${this.pastaPadrao}.`,
      };
    }
  }

  private lista() {
    const pastas = [...new Set([this.config.pasta, this.pastaPadrao].filter((p): p is string => !!p))];
    const itens: { arquivo: string; pasta: string; caminho: string; criadoEm: string; bytes: number }[] = [];
    for (const pasta of pastas) {
      let nomes: string[];
      try {
        nomes = readdirSync(pasta);
      } catch {
        continue;
      }
      for (const arquivo of nomes.filter((f) => f.endsWith('.sstbak'))) {
        const caminho = join(pasta, arquivo);
        try {
          const st = statSync(caminho);
          if (st.isFile()) itens.push({ arquivo, pasta, caminho, criadoEm: st.mtime.toISOString(), bytes: st.size });
        } catch {
          /* removido enquanto lia */
        }
      }
    }
    return itens.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }

  private proximo(): string | null {
    const c = this.config;
    if (c.frequencia === 'desligado' || !this.srv.segredos.senhaBackup) return null;
    const ultimo = this.lista()[0];
    if (!ultimo) return new Date().toISOString();
    return new Date(Math.max(Date.now(), Date.parse(ultimo.criadoEm) + INTERVALO[c.frequencia])).toISOString();
  }

  async estado(): Promise<EstadoBackup> {
    const d = this.destino();
    return {
      senhaConfigurada: !!this.srv.segredos.senhaBackup,
      pastaDados: this.srv.op.pastaDados,
      pastaPadrao: this.pastaPadrao,
      pasta: d.pasta,
      aviso: d.aviso ?? null,
      config: this.config,
      proximoAutomatico: this.proximo(),
      backups: this.lista().map(({ arquivo, pasta, caminho, criadoEm, bytes }) => ({ arquivo, pasta, caminho, criadoEm, bytes })),
    };
  }

  async definirSenha(senha: string) {
    this.srv.segredos.senhaBackup = senha;
    gravarSegredos(this.srv.op.pastaDados, this.srv.op.cofre, this.srv.segredos);
  }

  async configurar(c: ConfigBackup) {
    let pasta = c.pasta?.trim() || null;
    if (pasta) {
      if (!isAbsolute(pasta)) throw falha('Informe o caminho completo da pasta, por exemplo E:\\Backups SST');
      pasta = resolve(pasta);
      if (pasta === resolve(this.pastaPadrao)) pasta = null;
    }
    if (pasta) {
      const dados = resolve(this.srv.op.pastaDados);
      if (pasta === dados || pasta.startsWith(this.srv.pastaPg)) throw falha('Escolha uma pasta fora da pasta do banco de dados');
      try {
        mkdirSync(pasta, { recursive: true });
        const teste = join(pasta, `.teste-controle-sst-${process.pid}`);
        writeFileSync(teste, 'ok');
        rmSync(teste, { force: true });
      } catch {
        throw falha(`Não foi possível gravar na pasta ${pasta}. Confira se a unidade está conectada e se a pasta não é somente leitura.`);
      }
    }
    const nova: ConfigBackup = { pasta, frequencia: c.frequencia, aoSair: c.aoSair, manter: c.manter };
    writeFileSync(join(this.srv.op.pastaDados, ARQ_CONFIG_BACKUP), JSON.stringify(nova, null, 2));
    return nova;
  }

  async escolherPasta() {
    return { pasta: await this.dialogos.escolherPasta() };
  }

  private async exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    if (this.ocupado) throw falha('Já existe um backup ou restauração em andamento');
    this.ocupado = true;
    try {
      return await fn();
    } finally {
      this.ocupado = false;
    }
  }

  /**
   * Para o banco só enquanto copia para um arquivo local, religa e então leva o arquivo
   * para a pasta de destino (que pode ser um pendrive, mais lento).
   */
  async criarAgora(reiniciarBanco = true) {
    const senha = this.srv.segredos.senhaBackup;
    if (!senha) throw falha('Defina a senha dos backups antes de criar um backup');
    return this.exclusivo(async () => {
      const nome = `controle-sst-${carimbo()}.sstbak`;
      const local = join(this.pastaPadrao, nome);
      await this.srv.pararBanco();
      try {
        await criarBackup(local, this.srv.pastaPg, this.srv.segredos, senha);
      } finally {
        if (reiniciarBanco) await this.srv.iniciarBanco();
      }
      const { pasta, aviso } = this.destino();
      let arquivo = local;
      if (pasta !== this.pastaPadrao) {
        const final = join(pasta, nome);
        try {
          copyFileSync(local, `${final}.parcial`);
          renameSync(`${final}.parcial`, final);
          rmSync(local, { force: true });
          arquivo = final;
        } catch (e: any) {
          rmSync(`${final}.parcial`, { force: true });
          this.log?.(`Não foi possível gravar o backup em ${pasta}: ${e?.message}. Ficou em ${local}`);
        }
      } else if (aviso) {
        this.log?.(aviso);
      }
      this.limpar(this.pastaPadrao);
      if (pasta !== this.pastaPadrao) this.limpar(pasta);
      return { arquivo };
    });
  }

  /** Mantém só os N backups mais recentes criados pelo sistema em cada pasta. */
  private limpar(pasta: string) {
    const { manter } = this.config;
    const nossos = this.lista().filter((x) => x.pasta === pasta && NOME_AUTOMATICO.test(x.arquivo));
    for (const x of nossos.slice(manter)) rmSync(x.caminho, { force: true });
  }

  async exportar() {
    const ultimo = this.lista()[0];
    if (!ultimo) throw falha('Ainda não há backup. Crie um backup primeiro.');
    const destino = await this.dialogos.escolherDestino(ultimo.arquivo);
    if (!destino) return { arquivo: null };
    copyFileSync(ultimo.caminho, destino);
    return { arquivo: destino };
  }

  async restaurar(senha: string, caminho?: string) {
    let arquivo: string | null;
    if (caminho) {
      // Só arquivos da lista mostrada na tela; outro arquivo é escolhido pela janela do Windows.
      if (!this.lista().some((x) => x.caminho === caminho)) throw falha('Backup não encontrado. Atualize a página e tente de novo.');
      arquivo = caminho;
    } else {
      arquivo = await this.dialogos.escolherArquivo();
    }
    if (!arquivo) return { restaurado: false };
    const escolhido = arquivo;
    return this.exclusivo(async () => {
      const temp = join(this.srv.op.pastaDados, 'restauracao-temp');
      // Confere tudo antes de mexer no banco atual.
      const segredos = await abrirBackup(escolhido, senha, temp);
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

  /** Backup automático: confere de tempos em tempos se já passou o prazo desde o último. */
  async verificarAgendado(agora = Date.now()) {
    const c = this.config;
    if (c.frequencia === 'desligado' || !this.srv.segredos.senhaBackup || this.ocupado) return false;
    const ultimo = this.lista()[0];
    if (ultimo && agora - Date.parse(ultimo.criadoEm) < INTERVALO[c.frequencia]) return false;
    try {
      await this.criarAgora(true);
      this.log?.('Backup automático criado');
      return true;
    } catch (e: any) {
      this.log?.(`Falha no backup automático: ${e?.message}`);
      return false;
    }
  }

  iniciarAgendamento() {
    this.pararAgendamento();
    const verificar = () => void this.verificarAgendado();
    this.primeiro = setTimeout(verificar, 3 * 60_000);
    this.primeiro.unref();
    this.relogio = setInterval(verificar, 15 * 60_000);
    this.relogio.unref();
  }

  pararAgendamento() {
    clearTimeout(this.primeiro);
    clearInterval(this.relogio);
    this.relogio = this.primeiro = undefined;
  }
}
