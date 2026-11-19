/**
 * Fase 7: encerramento da sessão por inatividade, cabeçalhos de segurança e política de retenção.
 * O tempo é simulado movendo as datas no banco de teste descartável (nunca num banco real).
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let dono: Client;

async function novoUsuario(email: string, perfil: string) {
  await adm.post('/api/usuarios', { nome: email, email, senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil, empresaId: null }] }).expect(201);
  const a = amb.agente();
  await a.post('/api/auth/login', { email, senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  return a;
}

beforeAll(async () => {
  amb = await prepararAmbiente('seguranca');
  adm = await configurarELogar(amb);
  dono = new Client({ connectionString: amb.urlDono });
  await dono.connect();
}, 60_000);

afterAll(async () => {
  await dono?.end();
  await amb?.fechar();
});

describe('cabeçalhos de segurança', () => {
  it('a API responde sem cache e com isolamento de origem', async () => {
    const r = await adm.get('/api/auth/eu').expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(r.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(r.headers['permissions-policy']).toContain('camera=()');
    expect(r.headers['content-security-policy']).toContain("object-src 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
});

describe('inatividade', () => {
  it('a sessão cai depois do prazo sem uso e a consulta automática não renova', async () => {
    const a = await novoUsuario('inativo@teste.local', 'VISUALIZADOR');
    await a.get('/api/auth/eu').expect(200);
    // 30 minutos sem uso: ainda dentro do padrão de 60.
    await dono.query(`UPDATE sessao s SET ultimo_uso_em = now() - interval '30 minutes' FROM usuario u WHERE u.id = s.usuario_id AND u.email = 'inativo@teste.local'`);
    await a.raw.get('/api/notificacoes').set('x-sst-fundo', '1').expect(200);
    const uso = await dono.query(`SELECT s.ultimo_uso_em < now() - interval '29 minutes' AS antigo FROM sessao s JOIN usuario u ON u.id = s.usuario_id WHERE u.email = 'inativo@teste.local' AND s.revogada_em IS NULL`);
    expect(uso.rows.every((r) => r.antigo)).toBe(true);
    // 61 minutos sem uso: a sessão não vale mais, nem para a consulta automática.
    await dono.query(`UPDATE sessao s SET ultimo_uso_em = now() - interval '61 minutes' FROM usuario u WHERE u.id = s.usuario_id AND u.email = 'inativo@teste.local'`);
    await a.raw.get('/api/notificacoes').set('x-sst-fundo', '1').expect(401);
    await a.get('/api/auth/eu').expect(401);
  });

  it('uso normal renova a sessão', async () => {
    const a = await novoUsuario('ativo@teste.local', 'VISUALIZADOR');
    await dono.query(`UPDATE sessao s SET ultimo_uso_em = now() - interval '50 minutes' FROM usuario u WHERE u.id = s.usuario_id AND u.email = 'ativo@teste.local'`);
    await a.get('/api/auth/eu').expect(200);
    const r = await dono.query(`SELECT s.ultimo_uso_em > now() - interval '1 minute' AS novo FROM sessao s JOIN usuario u ON u.id = s.usuario_id WHERE u.email = 'ativo@teste.local' AND s.revogada_em IS NULL`);
    expect(r.rows[0].novo).toBe(true);
  });

  it('o prazo de inatividade é configurável e validado', async () => {
    await adm.put('/api/seguranca/politica', { inatividadeMinutos: 2, retencaoAvisosDias: 180, retencaoSessoesDias: 90 }).expect(400);
    const r = await adm.put('/api/seguranca/politica', { inatividadeMinutos: 15, retencaoAvisosDias: 180, retencaoSessoesDias: 90 }).expect(200);
    expect(r.body.inatividadeMinutos).toBe(15);
    const a = await novoUsuario('curto@teste.local', 'VISUALIZADOR');
    await dono.query(`UPDATE sessao s SET ultimo_uso_em = now() - interval '16 minutes' FROM usuario u WHERE u.id = s.usuario_id AND u.email = 'curto@teste.local'`);
    await a.get('/api/auth/eu').expect(401);
    // A mudança fica na auditoria.
    const aud = await dono.query(`SELECT depois->>'inatividade_minutos' AS m FROM auditoria WHERE tabela = 'tenant_config' ORDER BY id DESC LIMIT 1`);
    expect(aud.rows[0].m).toBe('15');
    await adm.put('/api/seguranca/politica', { inatividadeMinutos: 60, retencaoAvisosDias: 180, retencaoSessoesDias: 90 }).expect(200);
  });

  it('só quem configura o sistema vê e altera a política', async () => {
    const v = await novoUsuario('semconfig@teste.local', 'VISUALIZADOR');
    await v.get('/api/seguranca/politica').expect(403);
    await v.put('/api/seguranca/politica', { inatividadeMinutos: 60, retencaoAvisosDias: 180, retencaoSessoesDias: 90 }).expect(403);
    await v.post('/api/seguranca/retencao').expect(403);
  });
});

describe('retenção', () => {
  it('apaga só avisos lidos e sessões encerradas fora do prazo, e registra a execução', async () => {
    const t = (await dono.query('SELECT tenant_id FROM tenant_config LIMIT 1')).rows[0].tenant_id;
    const u = (await dono.query(`SELECT id FROM usuario WHERE email = 'admin@teste.local'`)).rows[0].id;
    const ins = (chave: string, lida: string | null) => dono.query(
      `INSERT INTO notificacao (tenant_id, usuario_id, categoria, chave, titulo, estado, lida_em) VALUES ($1, $2, 'acao', $3, 'Aviso de teste', 'atrasado', $4)`,
      [t, u, chave, lida],
    );
    await ins('ret-velho-lido', new Date(Date.now() - 200 * 86400_000).toISOString());
    await ins('ret-novo-lido', new Date(Date.now() - 10 * 86400_000).toISOString());
    await ins('ret-velho-nao-lido', null);
    await dono.query(`UPDATE notificacao SET criada_em = now() - interval '400 days' WHERE chave = 'ret-velho-nao-lido'`);
    // Sessão encerrada há 100 dias e sessão ativa.
    await dono.query(
      `INSERT INTO sessao (tenant_id, usuario_id, token_hash, criado_em, ultimo_uso_em, expira_em, revogada_em)
       VALUES ($1, $2, 'ret-antiga', now() - interval '101 days', now() - interval '101 days', now() - interval '100 days', now() - interval '100 days')`,
      [t, u],
    );
    const antes = (await dono.query('SELECT count(*)::int AS n FROM sessao WHERE revogada_em IS NULL AND expira_em > now()')).rows[0].n;
    const auditoriaAntes = (await dono.query('SELECT count(*)::int AS n FROM auditoria')).rows[0].n;

    const r = await adm.post('/api/seguranca/retencao').expect(201);
    expect(r.body).toEqual({ avisosRemovidos: 1, sessoesRemovidas: 1 });
    const chaves = (await dono.query(`SELECT chave FROM notificacao WHERE chave LIKE 'ret-%' ORDER BY chave`)).rows.map((x) => x.chave);
    expect(chaves).toEqual(['ret-novo-lido', 'ret-velho-nao-lido']);
    expect((await dono.query(`SELECT count(*)::int AS n FROM sessao WHERE token_hash = 'ret-antiga'`)).rows[0].n).toBe(0);
    expect((await dono.query('SELECT count(*)::int AS n FROM sessao WHERE revogada_em IS NULL AND expira_em > now()')).rows[0].n).toBe(antes);
    // Auditoria só cresce (a execução fica registrada).
    expect((await dono.query('SELECT count(*)::int AS n FROM auditoria')).rows[0].n).toBeGreaterThan(auditoriaAntes);

    const p = (await adm.get('/api/seguranca/politica').expect(200)).body;
    expect(p.execucoes[0]).toMatchObject({ avisosRemovidos: 1, sessoesRemovidas: 1 });
    expect(p.categorias.map((c: any) => c.chave)).toEqual(['aso', 'documento', 'treinamento', 'ocorrencia', 'acao', 'esocial', 'auditoria']);
    expect(p.categorias.find((c: any) => c.chave === 'auditoria').registros).toBeGreaterThan(0);
  });

  it('o agendamento interno roda no máximo uma vez por dia por tenant', async () => {
    const n0 = (await dono.query('SELECT count(*)::int AS n FROM retencao_execucao')).rows[0].n;
    await dono.query('SELECT app.aplicar_retencao_todos()');
    expect((await dono.query('SELECT count(*)::int AS n FROM retencao_execucao')).rows[0].n).toBe(n0);
    await dono.query(`UPDATE retencao_execucao SET executada_em = now() - interval '1 day'`).catch(() => undefined);
  });
});
