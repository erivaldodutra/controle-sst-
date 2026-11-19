/**
 * Fase 3: programas legais e documentos (tipos, versões, prazos, aplicabilidade, isolamento).
 * Banco descartável; nomes gerados só para o teste.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let A: Awaited<ReturnType<typeof criarEmpresa>>;
let B: Awaited<ReturnType<typeof criarEmpresa>>;
let tipos: Record<string, any>;

const hoje = new Date();
const dia = (delta: number) =>
  new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta)).toISOString().slice(0, 10);
const mesesAtras = (m: number) =>
  new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - m, hoje.getDate())).toISOString().slice(0, 10);

async function novoUsuario(email: string, perfil: string, empresaId: string | null) {
  await adm.post('/api/usuarios', { nome: email, email, senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil, empresaId }] }).expect(201);
  const a = amb.agente();
  await a.post('/api/auth/login', { email, senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  return a;
}

async function novoDocumento(empresaId: string, sigla: string, identificacao: string, extra: object = {}) {
  return (await adm.post('/api/documentos', { empresaId, tipoId: tipos[sigla].id, identificacao, ...extra }).expect(201)).body;
}

/** Cria e emite uma versão; devolve o documento atualizado. */
async function emitir(docId: string, dados: object) {
  const d = (await adm.post(`/api/documentos/${docId}/versoes`, { responsavelNome: 'Responsável Teste', responsavelRegistro: 'CREA 000', ...dados }).expect(201)).body;
  const rascunho = d.versoes.find((v: any) => ['em_elaboracao', 'em_revisao'].includes(v.situacao));
  return (await adm.post(`/api/documento-versoes/${rascunho.id}/emissao`).expect(201)).body;
}

beforeAll(async () => {
  amb = await prepararAmbiente('documentos');
  adm = await configurarELogar(amb);
  A = await criarEmpresa(adm, 'Empresa A');
  B = await criarEmpresa(adm, 'Empresa B');
}, 60_000);
afterAll(async () => amb?.fechar());

describe('biblioteca de tipos', () => {
  it('começa vazia e carrega a biblioteca sugerida uma vez só, sem duplicar', async () => {
    expect((await adm.get('/api/documentos-tipos').expect(200)).body).toEqual([]);
    expect((await adm.post('/api/documentos-tipos/biblioteca').expect(201)).body.incluidos).toBe(14);
    expect((await adm.post('/api/documentos-tipos/biblioteca').expect(201)).body.incluidos).toBe(0);
    const lista = (await adm.get('/api/documentos-tipos').expect(200)).body;
    tipos = Object.fromEntries(lista.map((t: any) => [t.sigla, t]));
    expect(tipos.PGR.prazoRevisaoMeses).toBe(24);
    // Sem validade universal: laudos e LTCAT sem prazo fixo.
    expect(tipos.LTCAT.prazoRevisaoMeses).toBeNull();
    expect(tipos.LTCAT.vencimentoMeses).toBeNull();
  });

  it('aceita tipo personalizado e recusa nome repetido', async () => {
    const t = (await adm.post('/api/documentos-tipos', { sigla: 'PPCI', nome: 'Plano de prevenção personalizado', reavaliacaoMeses: 6 }).expect(201)).body;
    tipos.PPCI = t;
    const r = await adm.post('/api/documentos-tipos', { nome: 'Plano de prevenção personalizado' }).expect(409);
    expect(r.body.mensagem).toMatch(/tipo de documento com este nome/);
    await adm.post('/api/documentos-tipos', { nome: 'X', prazoRevisaoMeses: 0 }).expect(400);
  });
});

describe('documento e versões', () => {
  let pgr: any;

  it('cria documento copiando as regras do tipo; sem versão fica pendente', async () => {
    pgr = await novoDocumento(A.empresa.id, 'PGR', 'PGR Matriz', { estabelecimentoId: A.estabelecimento.id });
    expect(pgr.prazoRevisaoMeses).toBe(24);
    expect(pgr.situacao).toBe('pendente');
    expect(pgr.motivos).toEqual(expect.arrayContaining([expect.stringMatching(/Aplicabilidade/), 'Nenhuma versão emitida']));
  });

  it('não emite sem responsável técnico e data de emissão', async () => {
    const d = (await adm.post(`/api/documentos/${pgr.id}/versoes`, {}).expect(201)).body;
    expect(d.situacao).toBe('em_elaboracao');
    const v = d.versoes[0];
    expect(v.situacao).toBe('em_elaboracao');
    const r = await adm.post(`/api/documento-versoes/${v.id}/emissao`).expect(422);
    expect(r.body.mensagem).toMatch(/responsável técnico e data de emissão/);
    // Só um rascunho por vez.
    await adm.post(`/api/documentos/${pgr.id}/versoes`, {}).expect(409);
    await adm.put(`/api/documento-versoes/${v.id}`, { responsavelNome: 'Eng. Responsável', responsavelRegistro: 'CREA-SP 1', dataEmissao: mesesAtras(23) }).expect(200);
    const emitido = (await adm.post(`/api/documento-versoes/${v.id}/emissao`).expect(201)).body;
    // Revisão calculada pela regra (24 meses) => vence em ~1 mês: próximo da revisão.
    expect(emitido.versoes[0].situacao).toBe('vigente');
    expect(emitido.versoes[0].dataRevisao).toBeTruthy();
    expect(emitido.situacao).toBe('proximo_revisao');
    pgr = emitido;
  });

  it('nova versão substitui a anterior, que fica guardada e imutável', async () => {
    const d = (await adm.post(`/api/documentos/${pgr.id}/versoes`, { responsavelNome: 'Outro Responsável', dataEmissao: dia(0), descricaoAlteracoes: 'Revisão bienal' }).expect(201)).body;
    expect(d.situacao).toBe('em_revisao');
    const rascunho = d.versoes.find((v: any) => v.situacao === 'em_revisao');
    const r = (await adm.post(`/api/documento-versoes/${rascunho.id}/emissao`).expect(201)).body;
    const [v2, v1] = r.versoes;
    expect(v2).toMatchObject({ numero: 2, situacao: 'vigente' });
    expect(v1).toMatchObject({ numero: 1, situacao: 'substituida', substituidaEm: dia(0) });
    expect(r.situacao).toBe('regular');
    // A substituída não pode ser alterada nem pela API nem direto no banco.
    await adm.put(`/api/documento-versoes/${v1.id}`, { responsavelNome: 'X', dataEmissao: dia(-10) }).expect(409);
    const c = new Client({ connectionString: amb.urlDono });
    await c.connect();
    await expect(c.query(`UPDATE documento_versao SET observacoes = 'x' WHERE id = $1`, [v1.id])).rejects.toThrow(/não pode ser alterada/);
    await c.end();
    pgr = r;
  });

  it('cancela rascunho com motivo; versão vigente não é cancelada', async () => {
    const d = (await adm.post(`/api/documentos/${pgr.id}/versoes`, {}).expect(201)).body;
    const rascunho = d.versoes.find((v: any) => v.situacao === 'em_revisao');
    await adm.post(`/api/documento-versoes/${rascunho.id}/cancelamento`, {}).expect(400);
    const r = (await adm.post(`/api/documento-versoes/${rascunho.id}/cancelamento`, { motivo: 'Aberta por engano' }).expect(201)).body;
    expect(r.versoes[0].situacao).toBe('cancelada');
    expect(r.situacao).toBe('regular');
    const vigente = r.versoes.find((v: any) => v.situacao === 'vigente');
    await adm.post(`/api/documento-versoes/${vigente.id}/cancelamento`, { motivo: 'teste' }).expect(422);
  });

  it('anexa o arquivo da versão (só PDF/imagem de verdade) e baixa', async () => {
    const vigente = pgr.versoes.find((v: any) => v.situacao === 'vigente');
    await adm.upload(`/api/documento-versoes/${vigente.id}/arquivo`, 'arquivo', Buffer.from('texto'), 'pgr.pdf').expect(400);
    const r = (await adm.upload(`/api/documento-versoes/${vigente.id}/arquivo`, 'arquivo', Buffer.from('%PDF-1.4\n%teste\n'), 'PGR assinado.pdf').expect(201)).body;
    expect(r.versoes.find((v: any) => v.id === vigente.id).arquivoNome).toBe('PGR assinado.pdf');
    const d = await adm.get(`/api/documento-versoes/${vigente.id}/arquivo`).expect(200);
    expect(d.headers['content-type']).toContain('application/pdf');
  });

  it('mudança de condições deixa pendente até nova versão ser emitida', async () => {
    await adm.put(`/api/documentos/${pgr.id}/mudanca-condicoes`, { data: dia(0) }).expect(400);
    let d = (await adm.put(`/api/documentos/${pgr.id}/mudanca-condicoes`, { data: dia(0), motivo: 'Nova linha de produção' }).expect(200)).body;
    expect(d.situacao).toBe('pendente');
    expect(d.motivos.join(' ')).toMatch(/mudança de condições/);
    d = await emitir(pgr.id, { dataEmissao: dia(0) });
    expect(d.mudancaCondicoesEm).toBeNull();
    expect(d.situacao).toBe('regular');
  });
});

describe('prazos distintos', () => {
  it('vencimento expresso: CIPA vencida pelo mandato de 12 meses', async () => {
    const cipa = await novoDocumento(A.empresa.id, 'CIPA', 'CIPA gestão anterior');
    const d = await emitir(cipa.id, { dataEmissao: mesesAtras(13) });
    expect(d.situacao).toBe('vencido');
    expect(d.prazos.find((p: any) => p.tipo === 'vencimento').estado).toBe('atrasado');
  });

  it('acompanhamento periódico: PCMSO sem relatório no prazo fica pendente até registrar', async () => {
    const pcmso = await novoDocumento(A.empresa.id, 'PCMSO', 'PCMSO');
    let d = await emitir(pcmso.id, { dataEmissao: mesesAtras(13) });
    expect(d.situacao).toBe('pendente');
    await adm.post(`/api/documentos/${pcmso.id}/acompanhamentos`, { data: dia(1), responsavelNome: 'Médico', descricao: 'Relatório' }).expect(422);
    d = (await adm.post(`/api/documentos/${pcmso.id}/acompanhamentos`, { data: dia(0), responsavelNome: 'Médico Coordenador', descricao: 'Relatório analítico anual' }).expect(201)).body;
    expect(d.situacao).toBe('regular');
    expect(d.acompanhamentos).toHaveLength(1);
  });

  it('documento com regra própria diferente do tipo', async () => {
    const ltcat = await novoDocumento(A.empresa.id, 'LTCAT', 'LTCAT', { regras: { reavaliacaoMeses: 12 } });
    expect(ltcat.reavaliacaoMeses).toBe(12);
    const d = await emitir(ltcat.id, { dataEmissao: mesesAtras(14) });
    expect(d.situacao).toBe('pendente');
    expect(d.motivos.join(' ')).toMatch(/Reavaliação interna atrasada/);
  });
});

describe('aplicabilidade e substituição', () => {
  it('não aplicável exige justificativa e registra quem decidiu', async () => {
    const aet = await novoDocumento(A.empresa.id, 'AET', 'AET');
    await adm.put(`/api/documentos/${aet.id}/aplicabilidade`, { aplicabilidade: 'nao_aplicavel' }).expect(400);
    const d = (await adm.put(`/api/documentos/${aet.id}/aplicabilidade`, { aplicabilidade: 'nao_aplicavel', justificativa: 'AEP não indicou necessidade de AET' }).expect(200)).body;
    expect(d.situacao).toBe('nao_aplicavel');
    expect(d.aplicabilidadePor).toBeTruthy();
  });

  it('documento substituído por outro da mesma empresa', async () => {
    const antigo = await novoDocumento(A.empresa.id, 'LI', 'Laudo de insalubridade 2024');
    const novo = await novoDocumento(A.empresa.id, 'LI', 'Laudo de insalubridade 2026');
    const deB = await novoDocumento(B.empresa.id, 'LI', 'Laudo empresa B');
    await adm.post(`/api/documentos/${antigo.id}/substituicao`, { data: dia(0), motivo: 'Refeito', substitutoId: deB.id }).expect(422);
    const d = (await adm.post(`/api/documentos/${antigo.id}/substituicao`, { data: dia(0), motivo: 'Laudo refeito', substitutoId: novo.id }).expect(201)).body;
    expect(d.situacao).toBe('substituido');
    expect(d.substituidoPorIdentificacao).toBe('Laudo de insalubridade 2026');
    await adm.post(`/api/documentos/${antigo.id}/versoes`, {}).expect(422);
    const n = (await adm.get(`/api/documentos/${novo.id}`).expect(200)).body;
    expect(n.substitui.map((x: any) => x.identificacao)).toEqual(['Laudo de insalubridade 2024']);
  });

  it('lista com resumo por situação e filtro', async () => {
    const r = (await adm.get(`/api/documentos?empresaId=${A.empresa.id}`).expect(200)).body;
    expect(r.resumo.vencido).toBeGreaterThanOrEqual(1);
    expect(r.resumo.nao_aplicavel).toBe(1);
    expect(r.resumo.substituido).toBe(1);
    const so = (await adm.get(`/api/documentos?empresaId=${A.empresa.id}&situacao=vencido`).expect(200)).body;
    expect(so.itens.every((d: any) => d.situacao === 'vencido')).toBe(true);
  });
});

describe('permissões e isolamento', () => {
  it('usuário da empresa B não vê nem altera documentos da A', async () => {
    const tecB = await novoUsuario('tec.b@teste.local', 'TEC_SEGURANCA', B.empresa.id);
    const lista = (await tecB.get('/api/documentos').expect(200)).body;
    expect(lista.itens.every((d: any) => d.empresaId === B.empresa.id)).toBe(true);
    const daA = (await adm.get(`/api/documentos?empresaId=${A.empresa.id}`).expect(200)).body.itens[0];
    await tecB.get(`/api/documentos/${daA.id}`).expect(404);
    await tecB.post(`/api/documentos/${daA.id}/versoes`, {}).expect(404);
    await tecB.post('/api/documentos', { empresaId: A.empresa.id, tipoId: tipos.PGR.id, identificacao: 'Invasão' }).expect(403);
    // Pode trabalhar na própria empresa.
    await tecB.post('/api/documentos', { empresaId: B.empresa.id, tipoId: tipos.PGR.id, identificacao: 'PGR B' }).expect(201);
  });

  it('RH só lê documentos', async () => {
    const rh = await novoUsuario('rh@teste.local', 'RH', A.empresa.id);
    const lista = (await rh.get('/api/documentos').expect(200)).body;
    expect(lista.itens.length).toBeGreaterThan(0);
    await rh.post('/api/documentos', { empresaId: A.empresa.id, tipoId: tipos.PGR.id, identificacao: 'X' }).expect(403);
    await rh.post('/api/documentos-tipos/biblioteca').expect(403);
  });

  it('RLS do banco também isola sem a API', async () => {
    const c = new Client({ connectionString: amb.urlApp });
    await c.connect();
    await c.query('BEGIN');
    const tenant = (await c.query('SELECT 1')).rows; // sem contexto: nada visível
    expect(tenant).toHaveLength(1);
    expect((await c.query('SELECT count(*)::int AS n FROM documento')).rows[0].n).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n FROM documento_versao')).rows[0].n).toBe(0);
    await c.query('ROLLBACK');
    await c.end();
  });

  it('auditoria registra emissões e não guarda o conteúdo do arquivo', async () => {
    const c = new Client({ connectionString: amb.urlDono });
    await c.connect();
    const r = await c.query(`SELECT count(*)::int AS n FROM auditoria WHERE tabela = 'documento_versao' AND operacao = 'UPDATE'`);
    expect(r.rows[0].n).toBeGreaterThan(0);
    const a = await c.query(`SELECT depois FROM auditoria WHERE tabela = 'arquivo' LIMIT 1`);
    expect(a.rows[0].depois.conteudo).toBeUndefined();
    await c.end();
  });
});
