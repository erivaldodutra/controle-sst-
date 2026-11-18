import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ambiente, SENHA_ADMIN, prepararAmbiente } from './ambiente';

let amb: Ambiente;
beforeAll(async () => {
  amb = await prepararAmbiente('auth');
});
afterAll(async () => amb?.fechar());

describe('autenticação', () => {
  it('exige configuração inicial antes de qualquer login', async () => {
    const a = amb.agente();
    expect((await a.get('/api/auth/estado').expect(200)).body).toEqual({ configurado: false });
    await a.post('/api/auth/configuracao-inicial', { organizacao: 'X', nome: 'Admin', email: 'admin@teste.local', senha: 'curta' }).expect(400);
    await a.post('/api/auth/configuracao-inicial', { organizacao: 'Org', nome: 'Admin', email: 'admin@teste.local', senha: SENHA_ADMIN }).expect(201);
    expect((await a.get('/api/auth/estado').expect(200)).body).toEqual({ configurado: true });
  });

  it('não permite configurar o sistema duas vezes', async () => {
    await amb.agente().post('/api/auth/configuracao-inicial', { organizacao: 'Outra', nome: 'Invasor', email: 'x@teste.local', senha: SENHA_ADMIN }).expect(409);
  });

  it('recusa rotas protegidas sem sessão e mutações sem o cabeçalho anti-CSRF', async () => {
    await amb.agente().get('/api/empresas').expect(401);
    await amb.agente().raw.post('/api/auth/login').send({ email: 'admin@teste.local', senha: SENHA_ADMIN }).expect(403);
  });

  it('faz login, devolve o perfil e encerra a sessão no logout', async () => {
    const a = amb.agente();
    await a.post('/api/auth/login', { email: 'ADMIN@teste.local', senha: SENHA_ADMIN }).expect(200);
    const eu = (await a.get('/api/auth/eu').expect(200)).body;
    expect(eu.empresas).toBe('*');
    expect(eu.atribuicoes).toEqual([{ perfil: 'ADMIN_GERAL', empresaId: null }]);
    expect(eu.permissoes).toContain('usuarios.gerenciar');
    await a.post('/api/auth/logout').expect(200);
    await a.get('/api/auth/eu').expect(401);
  });

  it('bloqueia o usuário após 5 tentativas erradas', async () => {
    const a = amb.agente();
    for (let i = 0; i < 5; i++) await a.post('/api/auth/login', { email: 'admin@teste.local', senha: 'errada123456' }).expect(401);
    const r = await a.post('/api/auth/login', { email: 'admin@teste.local', senha: SENHA_ADMIN }).expect(403);
    expect(r.body.mensagem).toMatch(/bloqueado/);
    // destrava para os próximos testes (simula o fim do período de bloqueio)
    const { Client } = await import('pg');
    const c = new Client({ connectionString: amb.urlDono });
    await c.connect();
    await c.query('UPDATE usuario SET bloqueado_ate = NULL, tentativas_falhas = 0');
    await c.end();
  });

  it('não revela se o e-mail existe', async () => {
    const r = await amb.agente().post('/api/auth/login', { email: 'ninguem@teste.local', senha: 'qualquer1234' }).expect(401);
    expect(r.body.mensagem).toBe('E-mail ou senha incorretos');
  });

  it('obriga a trocar a senha temporária antes de usar o sistema', async () => {
    const adm = amb.agente();
    await adm.post('/api/auth/login', { email: 'admin@teste.local', senha: SENHA_ADMIN }).expect(200);
    await adm.post('/api/usuarios', {
      nome: 'Novo', email: 'novo@teste.local', senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil: 'VISUALIZADOR', empresaId: null }],
    }).expect(201);
    const n = amb.agente();
    await n.post('/api/auth/login', { email: 'novo@teste.local', senha: 'Temporaria123' }).expect(200);
    const r = await n.get('/api/empresas').expect(403);
    expect(r.body.trocarSenha).toBe(true);
    await n.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'NovaSenha2026' }).expect(200);
    await n.get('/api/empresas').expect(200);
  });

  it('nunca grava senha na auditoria', async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: amb.urlDono });
    await c.connect();
    const r = await c.query(`SELECT count(*)::int AS n FROM auditoria WHERE tabela = 'usuario' AND (depois ? 'senha_hash' OR antes ? 'senha_hash')`);
    await c.end();
    expect(r.rows[0].n).toBe(0);
  });
});
