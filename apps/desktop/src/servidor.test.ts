/**
 * Teste do núcleo do aplicativo de desktop sem o Electron: banco embutido,
 * migrations, API, backup criptografado e restauração.
 * Usa uma pasta temporária, apagada no fim. Nenhum dado real é envolvido.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GestorBackup } from './gestorBackup';
import { escolherPastaDados, trazerDadosAnteriores } from './local';
import { Cofre, gravarSegredos, Servidor } from './servidor';

const cofre: Cofre = { cifrar: (t) => Buffer.from(t, 'utf8'), decifrar: (b) => b.toString('utf8') };
const pasta = mkdtempSync(join(tmpdir(), 'sst-desktop-'));
const externa = mkdtempSync(join(tmpdir(), 'sst-pendrive-'));
const migrations = join(__dirname, '..', '..', 'api', 'migrations');

let srv: Servidor;
let gestor: GestorBackup;
let arquivoEscolhido: string | null = null;
let reiniciado = false;

function novoServidor() {
  return new Servidor({
    pastaDados: pasta, pastaMigrations: migrations, cofre,
    backup: (s) => (gestor = new GestorBackup(s, {
      escolherDestino: async () => null,
      escolherArquivo: async () => arquivoEscolhido,
      escolherPasta: async () => null,
      reiniciar: () => { reiniciado = true; },
    })),
  });
}

let cookie = '';
async function chamar(metodo: string, url: string, corpo?: unknown) {
  const r = await fetch(srv.url + '/api' + url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-sst': '1', cookie },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const c = r.headers.get('set-cookie');
  if (c) cookie = c.split(';')[0]!;
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

afterAll(async () => {
  await srv?.parar();
  rmSync(pasta, { recursive: true, force: true });
  rmSync(externa, { recursive: true, force: true });
});

describe('aplicativo local', () => {
  it('cria o banco na primeira execução e sobe a API', async () => {
    srv = novoServidor();
    await srv.iniciar();
    expect((await chamar('GET', '/auth/estado')).corpo).toEqual({ configurado: false });
    expect((await chamar('POST', '/auth/configuracao-inicial', { organizacao: 'Teste', nome: 'Admin', email: 'a@teste.local', senha: 'SenhaForte2026' })).status).toBe(201);
    expect((await chamar('POST', '/auth/login', { email: 'a@teste.local', senha: 'SenhaForte2026' })).status).toBe(200);
    expect((await chamar('POST', '/empresas', { tipoInscricao: 1, inscricao: '11222333000181', razaoSocial: 'Antes do backup' })).status).toBe(201);
  }, 120_000);

  it('o banco aceita conexão só do usuário da aplicação com RLS (sem superusuário na API)', async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: srv.urlBanco('sst_app') });
    await c.connect();
    const r = await c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    await c.end();
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('exige senha de backup e cria backup criptografado', async () => {
    expect((await chamar('POST', '/backup/agora')).status).toBe(409);
    expect((await chamar('POST', '/backup/senha', { senha: 'SenhaBackup2026' })).status).toBe(201);
    const r = await chamar('POST', '/backup/agora');
    expect(r.status).toBe(201);
    arquivoEscolhido = r.corpo.arquivo;
    // O banco volta a funcionar depois do backup.
    expect((await chamar('POST', '/empresas', { tipoInscricao: 1, inscricao: '11444777000161', razaoSocial: 'Depois do backup' })).status).toBe(201);
    expect((await chamar('GET', '/empresas')).corpo).toHaveLength(2);
    const est = await chamar('GET', '/backup');
    expect(est.corpo.backups).toHaveLength(1);
  }, 60_000);

  it('grava os backups na pasta escolhida (ex.: pendrive) e mantém só os mais recentes', async () => {
    expect((await chamar('POST', '/backup/configuracao', { pasta: 'relativa', frequencia: 'diario', aoSair: true, manter: 2 })).status).toBe(409);
    const r = await chamar('POST', '/backup/configuracao', { pasta: externa, frequencia: 'diario', aoSair: true, manter: 2 });
    expect(r.status).toBe(201);
    const criado = (await chamar('POST', '/backup/agora')).corpo.arquivo as string;
    expect(criado.startsWith(externa)).toBe(true);
    // Nada fica pela metade na pasta de destino nem no arquivo temporário local.
    expect(readdirSync(externa).filter((f) => f.endsWith('.parcial'))).toEqual([]);
    const est = (await chamar('GET', '/backup')).corpo;
    expect(est.pasta).toBe(externa);
    expect(est.aviso).toBeNull();
    expect(est.backups.map((b: any) => b.pasta).sort()).toEqual([externa, gestor.pastaPadrao].sort());
    // Arquivo de outro programa na pasta não é apagado pela limpeza.
    writeFileSync(join(externa, 'meu-arquivo.sstbak'), 'x');
    for (const [i, nome] of ['controle-sst-2020-01-01-00-00-00.sstbak', 'controle-sst-2020-01-02-00-00-00.sstbak'].entries()) {
      writeFileSync(join(externa, nome), 'antigo');
      utimesSync(join(externa, nome), new Date(2020, 0, i + 1), new Date(2020, 0, i + 1));
    }
    await chamar('POST', '/backup/agora');
    const nossos = readdirSync(externa).filter((f) => f.startsWith('controle-sst-'));
    expect(nossos).toHaveLength(2);
    expect(nossos.some((f) => f.startsWith('controle-sst-2020'))).toBe(false);
    expect(existsSync(join(externa, 'meu-arquivo.sstbak'))).toBe(true);
    rmSync(join(externa, 'meu-arquivo.sstbak'));
  }, 60_000);

  it('avisa e usa a pasta interna quando a pasta escolhida some (pendrive desconectado)', async () => {
    const sumiu = join(externa, 'pendrive-removido');
    expect((await chamar('POST', '/backup/configuracao', { pasta: sumiu, frequencia: 'semanal', aoSair: false, manter: 10 })).status).toBe(201);
    rmSync(sumiu, { recursive: true });
    writeFileSync(sumiu, 'agora é um arquivo, não dá para gravar');
    const est = (await chamar('GET', '/backup')).corpo;
    expect(est.pasta).toBe(gestor.pastaPadrao);
    expect(est.aviso).toMatch(/não está acessível/);
    rmSync(sumiu);
    // Volta para o pendrive, para os próximos testes.
    await chamar('POST', '/backup/configuracao', { pasta: externa, frequencia: 'diario', aoSair: true, manter: 10 });
    expect(JSON.parse(readFileSync(join(pasta, 'backup-config.json'), 'utf8')).pasta).toBe(externa);
  });

  it('backup automático só quando passou o prazo desde o último', async () => {
    const antes = gestor['lista']().length;
    expect(await gestor.verificarAgendado()).toBe(false);
    expect(await gestor.verificarAgendado(Date.now() + 25 * 3600_000)).toBe(true);
    expect(gestor['lista']().length).toBe(antes + 1);
    await chamar('POST', '/backup/configuracao', { pasta: externa, frequencia: 'desligado', aoSair: true, manter: 10 });
    expect(await gestor.verificarAgendado(Date.now() + 100 * 24 * 3600_000)).toBe(false);
    expect((await chamar('GET', '/backup')).corpo.proximoAutomatico).toBeNull();
  }, 60_000);

  it('senha errada não restaura nada', async () => {
    const r = await chamar('POST', '/backup/restauracao', { senha: 'errada' });
    expect(r.status).toBe(409);
    expect(r.corpo.mensagem).toMatch(/Senha do backup incorreta/);
    expect((await chamar('GET', '/empresas')).corpo).toHaveLength(2);
  });

  it('restaura o backup e reinicia com os dados da data do backup', async () => {
    // Só aceita arquivos da lista da tela.
    expect((await chamar('POST', '/backup/restauracao', { senha: 'SenhaBackup2026', caminho: join(pasta, 'segredos.bin') })).status).toBe(409);
    const r = await chamar('POST', '/backup/restauracao', { senha: 'SenhaBackup2026', caminho: arquivoEscolhido });
    expect(r.corpo).toEqual({ restaurado: true });
    await new Promise((ok) => setTimeout(ok, 500));
    expect(reiniciado).toBe(true);
    await srv.parar();
    srv = novoServidor();
    await srv.iniciar();
    cookie = '';
    await chamar('POST', '/auth/login', { email: 'a@teste.local', senha: 'SenhaForte2026' });
    const lista = (await chamar('GET', '/empresas')).corpo;
    expect(lista.map((e: any) => e.razaoSocial)).toEqual(['Antes do backup']);
  }, 120_000);
});

describe('primeira execução que não terminou', () => {
  it('recomeça do zero quando só sobrou a configuração (banco nunca criado)', async () => {
    const outra = mkdtempSync(join(tmpdir(), 'sst-desktop-incompleto-'));
    try {
      // Simula a falha da 1ª instalação: segredos gravados, banco nunca criado.
      gravarSegredos(outra, cofre, { senhaSuper: 'a', senhaDono: 'b', senhaApp: 'c', chaveDados: Buffer.alloc(32).toString('base64') });
      const s = new Servidor({ pastaDados: outra, pastaMigrations: migrations, cofre });
      await s.iniciar();
      const r = await fetch(s.url + '/api/auth/estado');
      expect(await r.json()).toEqual({ configurado: false });
      await s.parar();
      // Os restos foram guardados ao lado, não apagados.
      expect(readdirSync(outra).some((n) => n.startsWith('segredos.bin-incompleto-'))).toBe(true);
      // Segunda abertura normal, já com o banco pronto.
      const s2 = new Servidor({ pastaDados: outra, pastaMigrations: migrations, cofre });
      await s2.iniciar();
      await s2.parar();
    } finally {
      rmSync(outra, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('pasta dos dados', () => {
  it('instalado fora da unidade do Windows, os dados ficam na mesma unidade', () => {
    const padrao = 'C:\\Users\\x\\AppData\\Roaming\\Controle SST\\dados';
    expect(escolherPastaDados({ programa: 'E:\\Controle SST\\Controle SST.exe', padrao, unidadeSistema: 'C:', windows: true })).toBe('E:\\Controle SST - Dados');
    expect(escolherPastaDados({ programa: 'e:\\Programas\\Controle SST\\Controle SST.exe', padrao, unidadeSistema: 'C:', windows: true })).toBe('e:\\Controle SST - Dados');
    expect(escolherPastaDados({ programa: 'C:\\Users\\x\\AppData\\Local\\Programs\\Controle SST\\Controle SST.exe', padrao, unidadeSistema: 'C:', windows: true })).toBe(padrao);
    expect(escolherPastaDados({ programa: '\\\\servidor\\pasta\\Controle SST.exe', padrao, unidadeSistema: 'C:', windows: true })).toBe(padrao);
    expect(escolherPastaDados({ programa: '/opt/x', padrao: '/home/x', windows: false })).toBe('/home/x');
  });

  it('copia os dados da pasta anterior (ex.: do C: para o E:) sem apagar a original', () => {
    const base = mkdtempSync(join(tmpdir(), 'sst-mudanca-'));
    try {
      const antiga = join(base, 'C', 'dados');
      const nova = join(base, 'E', 'Controle SST - Dados');
      mkdirSync(join(antiga, 'pg'), { recursive: true });
      writeFileSync(join(antiga, 'banco-pronto'), 'x');
      writeFileSync(join(antiga, 'pg', 'PG_VERSION'), '16');
      writeFileSync(join(antiga, 'segredos.bin'), 'segredo');
      expect(trazerDadosAnteriores(nova, [null, antiga])).toBe(antiga);
      expect(readFileSync(join(nova, 'pg', 'PG_VERSION'), 'utf8')).toBe('16');
      expect(readFileSync(join(nova, 'segredos.bin'), 'utf8')).toBe('segredo');
      expect(existsSync(antiga)).toBe(false);
      expect(readdirSync(join(base, 'C')).some((n) => n.startsWith('dados-copiado-'))).toBe(true);
      // Já copiado: não faz de novo.
      expect(trazerDadosAnteriores(nova, [antiga])).toBeNull();
      // Nenhum local anterior com banco: começa do zero.
      expect(trazerDadosAnteriores(join(base, 'outra'), [join(base, 'nada')])).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
