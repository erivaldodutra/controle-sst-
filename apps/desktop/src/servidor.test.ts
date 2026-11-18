/**
 * Teste do núcleo do aplicativo de desktop sem o Electron: banco embutido,
 * migrations, API, backup criptografado e restauração.
 * Usa uma pasta temporária, apagada no fim. Nenhum dado real é envolvido.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GestorBackup } from './gestorBackup';
import { Cofre, gravarSegredos, Servidor } from './servidor';

const cofre: Cofre = { cifrar: (t) => Buffer.from(t, 'utf8'), decifrar: (b) => b.toString('utf8') };
const pasta = mkdtempSync(join(tmpdir(), 'sst-desktop-'));
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

  it('senha errada não restaura nada', async () => {
    const r = await chamar('POST', '/backup/restauracao', { senha: 'errada' });
    expect(r.status).toBe(409);
    expect(r.corpo.mensagem).toMatch(/Senha do backup incorreta/);
    expect((await chamar('GET', '/empresas')).corpo).toHaveLength(2);
  });

  it('restaura o backup e reinicia com os dados da data do backup', async () => {
    const r = await chamar('POST', '/backup/restauracao', { senha: 'SenhaBackup2026' });
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
