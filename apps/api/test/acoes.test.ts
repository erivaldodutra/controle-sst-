/**
 * Fase 4: planos de ação, inspeções, ocorrências e matriz de conformidade.
 * Banco descartável; nomes gerados só para o teste.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let eng: Agente;
let tec: Agente;
let A: Awaited<ReturnType<typeof criarEmpresa>>;
let B: Awaited<ReturnType<typeof criarEmpresa>>;

const hoje = new Date();
const dia = (delta: number) =>
  new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta)).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n% evidência de teste\n%%EOF\n');

async function novoUsuario(email: string, perfil: string, empresaId: string | null) {
  await adm.post('/api/usuarios', { nome: email, email, senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil, empresaId }] }).expect(201);
  const a = amb.agente();
  await a.post('/api/auth/login', { email, senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  return a;
}

const acaoBase = () => ({
  empresaId: A.empresa.id, estabelecimentoId: A.estabelecimento.id, origem: 'pgr', perigo: 'Ruído contínuo acima do nível de ação',
  descricao: 'Enclausurar o compressor', tipo: 'introduzir', prioridade: 'alta', responsavelNome: 'Responsável Teste',
  dataAbertura: dia(-30), prazo: dia(20),
});

const evidencia = (a: Agente, id: string) =>
  a.upload(`/api/acoes/${id}/evidencias`, 'arquivo', PDF, 'evidencia.pdf')
    .field('tipo', 'foto').field('descricao', 'Foto do enclausuramento').field('data', dia(-1));

beforeAll(async () => {
  amb = await prepararAmbiente('acoes');
  adm = await configurarELogar(amb);
  A = await criarEmpresa(adm, 'Empresa A');
  B = await criarEmpresa(adm, 'Empresa B');
  eng = await novoUsuario('eng.a@teste.local', 'ENG_SEGURANCA', A.empresa.id);
  tec = await novoUsuario('tec.a@teste.local', 'TEC_SEGURANCA', A.empresa.id);
}, 60_000);
afterAll(async () => amb?.fechar());

describe('ações', () => {
  let acao: any;

  it('abre com código sequencial, prazo inicial e histórico', async () => {
    acao = (await tec.post('/api/acoes', acaoBase()).expect(201)).body;
    expect(acao.codigo).toMatch(/^AC-\d{4}-0001$/);
    expect(acao.situacao).toBe('nao_iniciada');
    expect(acao.prazoInicial).toBe(acao.prazo);
    expect(acao.historico.map((h: any) => h.evento)).toEqual(['aberta']);
    const outra = (await tec.post('/api/acoes', acaoBase()).expect(201)).body;
    expect(outra.codigo).toMatch(/0002$/);
    await tec.post('/api/acoes', { ...acaoBase(), prazo: dia(-31) }).expect(400);
    await tec.post('/api/acoes', { ...acaoBase(), exigeEvidencia: false }).expect(400);
  });

  it('não vai para validação sem evidência (regra no banco)', async () => {
    await tec.post(`/api/acoes/${acao.id}/situacao`, { situacao: 'em_andamento' }).expect(201);
    const r = await tec.post(`/api/acoes/${acao.id}/situacao`, { situacao: 'em_validacao' }).expect(409);
    expect(r.body.mensagem).toMatch(/evidência/);
  });

  it('reprograma com justificativa e mantém o prazo inicial', async () => {
    await tec.post(`/api/acoes/${acao.id}/reprogramacao`, { prazo: dia(40) }).expect(400);
    const r = (await tec.post(`/api/acoes/${acao.id}/reprogramacao`, { prazo: dia(40), justificativa: 'Fornecedor atrasou o material' })
      .expect(201)).body;
    expect(r.prazo).toBe(dia(40));
    expect(r.prazoInicial).toBe(dia(20));
    expect(r.reprogramada).toBe(true);
    expect(r.historico[0].descricao).toMatch(/Fornecedor atrasou/);
  });

  it('com evidência vai para validação; só quem valida conclui', async () => {
    await evidencia(tec, acao.id).expect(201);
    await tec.post(`/api/acoes/${acao.id}/situacao`, { situacao: 'em_validacao' }).expect(201);
    await tec.post(`/api/acoes/${acao.id}/validacao`, { data: dia(0), validadorNome: 'Técnico' }).expect(403);
    // Devolver pede motivo e volta para em andamento.
    await eng.post(`/api/acoes/${acao.id}/devolucao`, {}).expect(400);
    const dev = (await eng.post(`/api/acoes/${acao.id}/devolucao`, { motivo: 'Falta medição após a obra' }).expect(201)).body;
    expect(dev.situacao).toBe('em_andamento');
    await tec.post(`/api/acoes/${acao.id}/situacao`, { situacao: 'em_validacao' }).expect(201);
    await eng.post(`/api/acoes/${acao.id}/validacao`, { data: dia(1), validadorNome: 'Eng. Validador' }).expect(422);
    const ok = (await eng.post(`/api/acoes/${acao.id}/validacao`, { data: dia(0), validadorNome: 'Eng. Validador', parecer: 'Medição ok' })
      .expect(201)).body;
    expect(ok.situacao).toBe('concluida');
    expect(ok.validadaPorNome).toBe('Eng. Validador');
    expect(ok.evidenciasLista).toHaveLength(1);
    const arq = await tec.get(`/api/acao-evidencias/${ok.evidenciasLista[0].id}/arquivo`).expect(200);
    expect(arq.headers['content-type']).toMatch(/pdf/);
  });

  it('ação concluída não muda mais, nem pela API nem direto no banco', async () => {
    await tec.put(`/api/acoes/${acao.id}`, { ...acaoBase(), descricao: 'Outra' }).expect(422);
    await tec.post(`/api/acoes/${acao.id}/reprogramacao`, { prazo: dia(60), justificativa: 'x' }).expect(422);
    await evidencia(tec, acao.id).expect(422);
    // Comentário continua permitido (só entra no histórico).
    await tec.post(`/api/acoes/${acao.id}/comentarios`, { texto: 'Acompanhar na próxima inspeção' }).expect(201);
    const c = new Client({ connectionString: amb.urlDono });
    await c.connect();
    await expect(c.query(`UPDATE acao SET descricao = 'x' WHERE id = $1`, [acao.id])).rejects.toThrow(/não pode ser alterada/);
    await expect(c.query(`INSERT INTO acao (tenant_id, empresa_id, codigo, origem, descricao, tipo, prioridade, responsavel_nome, data_abertura,
        prazo_inicial, prazo, situacao, concluida_em, validada_por_nome)
      SELECT tenant_id, empresa_id, 'AC-X', 'outra', 'x', 'manter', 'baixa', 'x', current_date, current_date, current_date, 'concluida',
             current_date, 'x' FROM acao WHERE id = $1`, [acao.id])).rejects.toThrow(/começa como/);
    // Histórico e evidências: o usuário da aplicação não altera nem apaga.
    const p = await c.query(`SELECT has_table_privilege('sst_app', 'acao_historico', 'UPDATE') AS u,
                                    has_table_privilege('sst_app', 'acao_historico', 'DELETE') AS d,
                                    has_table_privilege('sst_app', 'acao_evidencia', 'DELETE') AS e,
                                    has_table_privilege('sst_app', 'acao', 'DELETE') AS a`);
    expect(p.rows[0]).toEqual({ u: false, d: false, e: false, a: false });
    await c.end();
  });

  it('dispensa justificada permite validar sem evidência', async () => {
    const a = (await tec.post('/api/acoes', { ...acaoBase(), exigeEvidencia: false, dispensaJustificativa: 'Ação de natureza administrativa' })
      .expect(201)).body;
    await tec.post(`/api/acoes/${a.id}/situacao`, { situacao: 'em_validacao' }).expect(201);
    const ok = (await eng.post(`/api/acoes/${a.id}/validacao`, { data: dia(0), validadorNome: 'Eng.' }).expect(201)).body;
    expect(ok.situacao).toBe('concluida');
  });

  it('cancela só com motivo e por quem valida', async () => {
    const a = (await tec.post('/api/acoes', { ...acaoBase(), prazo: dia(-5) }).expect(201)).body;
    expect(a.atrasada).toBe(true);
    await tec.post(`/api/acoes/${a.id}/cancelamento`, { data: dia(0), motivo: 'Duplicada' }).expect(403);
    await eng.post(`/api/acoes/${a.id}/cancelamento`, { data: dia(0) }).expect(400);
    const c = (await eng.post(`/api/acoes/${a.id}/cancelamento`, { data: dia(0), motivo: 'Duplicada da AC-0002' }).expect(201)).body;
    expect(c.situacao).toBe('cancelada');
    expect(c.atrasada).toBe(false);
  });

  it('lista com resumo e filtros', async () => {
    const atrasada = (await tec.post('/api/acoes', { ...acaoBase(), prazo: dia(-2) }).expect(201)).body;
    const l = (await tec.get(`/api/acoes?empresaId=${A.empresa.id}`).expect(200)).body;
    expect(l.resumo.concluida).toBe(2);
    expect(l.resumo.cancelada).toBe(1);
    expect(l.resumo.atrasadas).toBe(1);
    const so = (await tec.get('/api/acoes?situacao=atrasadas').expect(200)).body;
    expect(so.itens.map((a: any) => a.id)).toEqual([atrasada.id]);
    const busca = (await tec.get(`/api/acoes?busca=${encodeURIComponent(atrasada.codigo)}`).expect(200)).body;
    expect(busca.itens).toHaveLength(1);
  });
});

describe('inspeções', () => {
  let insp: any;

  it('registra itens, gera ação do item não conforme e conclui', async () => {
    insp = (await tec.post('/api/inspecoes', {
      empresaId: A.empresa.id, estabelecimentoId: A.estabelecimento.id, data: dia(-1), tipo: 'rotina', responsavelNome: 'Técnico A',
      escopo: 'Área de produção',
    }).expect(201)).body;
    expect(insp.codigo).toMatch(/^IN-\d{4}-0001$/);
    await tec.post(`/api/inspecoes/${insp.id}/conclusao`, { data: dia(0), conclusao: 'x' }).expect(422);
    await tec.post(`/api/inspecoes/${insp.id}/itens`, { descricao: 'Extintores sinalizados', resultado: 'conforme' }).expect(201);
    insp = (await tec.post(`/api/inspecoes/${insp.id}/itens`, { descricao: 'Proteção da serra circular', resultado: 'nao_conforme',
      observacao: 'Coifa ausente' }).expect(201)).body;
    const [ok, nc] = insp.itensLista;
    expect(nc.ordem).toBe(2);
    await tec.post('/api/acoes', { ...acaoBase(), origem: 'inspecao', inspecaoItemId: ok.id }).expect(422);
    const acao = (await tec.post('/api/acoes', { ...acaoBase(), origem: 'inspecao', inspecaoItemId: nc.id, descricao: 'Instalar coifa' })
      .expect(201)).body;
    expect(acao.inspecaoCodigo).toBe(insp.codigo);
    await tec.delete(`/api/inspecao-itens/${nc.id}`).expect(422);
    await tec.put(`/api/inspecao-itens/${nc.id}`, { descricao: 'Proteção da serra', resultado: 'conforme' }).expect(422);
    insp = (await tec.delete(`/api/inspecao-itens/${ok.id}`).expect(200)).body;
    expect(insp.itensLista).toHaveLength(1);
    expect(insp.itensLista[0].acoes[0].codigo).toBe(acao.codigo);
    const fim = (await tec.post(`/api/inspecoes/${insp.id}/conclusao`, { data: dia(0), conclusao: 'Uma não conformidade' }).expect(201)).body;
    expect(fim.situacao).toBe('concluida');
    await tec.post(`/api/inspecoes/${insp.id}/itens`, { descricao: 'Depois', resultado: 'conforme' }).expect(422);
    const lista = (await tec.get('/api/acoes?inspecaoId=' + insp.id).expect(200)).body;
    expect(lista.itens).toHaveLength(1);
  });
});

describe('ocorrências', () => {
  it('não encerra sem investigação; gera ação ligada', async () => {
    const quando = `${dia(-3)}T14:30`;
    await tec.post('/api/ocorrencias', {
      empresaId: A.empresa.id, estabelecimentoId: A.estabelecimento.id, dataHora: `${dia(2)}T08:00`, tipo: 'quase_acidente',
      gravidade: 'sem_lesao', descricao: 'x',
    }).expect(422);
    let o = (await tec.post('/api/ocorrencias', {
      empresaId: A.empresa.id, estabelecimentoId: A.estabelecimento.id, dataHora: quando, tipo: 'acidente_tipico', gravidade: 'leve',
      local: 'Prensa 2', descricao: 'Corte superficial na mão', medidasImediatas: 'Primeiros socorros', houveAfastamento: false,
    }).expect(201)).body;
    expect(o.codigo).toMatch(/^OC-\d{4}-0001$/);
    expect(o.dataHora).toBe(quando);
    await tec.post(`/api/ocorrencias/${o.id}/encerramento`, { data: dia(0) }).expect(422);
    o = (await tec.put(`/api/ocorrencias/${o.id}/investigacao`, { investigacao: 'Árvore de causas: luva inadequada', responsavel: 'Téc. A',
      concluidaEm: dia(-1) }).expect(200)).body;
    expect(o.situacao).toBe('em_investigacao');
    const a = (await tec.post('/api/acoes', { ...acaoBase(), origem: 'investigacao', ocorrenciaId: o.id, descricao: 'Trocar luvas' })
      .expect(201)).body;
    expect(a.ocorrenciaCodigo).toBe(o.codigo);
    o = (await tec.post(`/api/ocorrencias/${o.id}/encerramento`, { data: dia(0) }).expect(201)).body;
    expect(o.situacao).toBe('encerrada');
    expect(o.acoes).toBe(1);
    await tec.put(`/api/ocorrencias/${o.id}/investigacao`, { investigacao: 'x', responsavel: 'y' }).expect(422);
    // Ocorrência de outra empresa não pode ser ligada a ação desta.
    const daB = (await adm.post('/api/ocorrencias', {
      empresaId: B.empresa.id, estabelecimentoId: B.estabelecimento.id, dataHora: quando, tipo: 'incidente', gravidade: 'sem_lesao',
      descricao: 'Queda de material',
    }).expect(201)).body;
    await adm.post('/api/acoes', { ...acaoBase(), origem: 'acidente', ocorrenciaId: daB.id }).expect(422);
  });
});

describe('matriz de conformidade', () => {
  let tipos: Record<string, any>;
  let reqPgr: any;
  let reqManual: any;

  it('gera requisitos dos tipos de documento sem presumir aplicabilidade', async () => {
    await adm.post('/api/documentos-tipos/biblioteca').expect(201);
    tipos = Object.fromEntries((await adm.get('/api/documentos-tipos').expect(200)).body.map((t: any) => [t.sigla, t]));
    expect((await eng.post('/api/requisitos/dos-tipos-de-documento').expect(201)).body.incluidos).toBe(14);
    expect((await eng.post('/api/requisitos/dos-tipos-de-documento').expect(201)).body.incluidos).toBe(0);
    const reqs = (await eng.get('/api/requisitos').expect(200)).body;
    reqPgr = reqs.find((r: any) => r.documentoTipoId === tipos.PGR.id);
    const m = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(200)).body;
    expect(m.itens.every((l: any) => l.situacao === 'a_avaliar')).toBe(true);
    expect(m.itens.every((l: any) => l.sugestao === null)).toBe(true);
    expect(m.resumo.percentual).toBeNull();
  });

  it('requisito com documento segue a situação do documento', async () => {
    const base = { empresaId: A.empresa.id, requisitoId: reqPgr.id };
    await eng.put('/api/conformidade', { ...base, aplicabilidade: 'nao_aplicavel' }).expect(400);
    await eng.put('/api/conformidade', { ...base, aplicabilidade: 'aplicavel' }).expect(200);
    let linha = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(200)).body.itens.find((l: any) => l.requisito.id === reqPgr.id);
    expect(linha.situacao).toBe('nao_conforme');
    expect(linha.motivo).toMatch(/Nenhum documento/);
    const doc = (await eng.post('/api/documentos', { empresaId: A.empresa.id, tipoId: tipos.PGR.id, identificacao: 'PGR A' }).expect(201)).body;
    const d = (await eng.post(`/api/documentos/${doc.id}/versoes`, { responsavelNome: 'Eng.', dataEmissao: dia(-10) }).expect(201)).body;
    await eng.post(`/api/documento-versoes/${d.versoes[0].id}/emissao`).expect(201);
    await eng.put(`/api/documentos/${doc.id}/aplicabilidade`, { aplicabilidade: 'aplicavel' }).expect(200);
    linha = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(200)).body.itens.find((l: any) => l.requisito.id === reqPgr.id);
    expect(linha.situacao).toBe('conforme');
    expect(linha.documentos).toHaveLength(1);
  });

  it('requisito manual com critérios mostra sugestão, mas quem decide é o profissional', async () => {
    reqManual = (await eng.post('/api/requisitos', {
      titulo: 'SESMT dimensionado', fundamentacao: 'NR-04', sugestaoGrausRisco: [3, 4], sugestaoMinEmpregados: 50,
    }).expect(201)).body;
    await eng.post('/api/requisitos', { titulo: 'SESMT dimensionado' }).expect(409);
    let m = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(200)).body;
    let linha = m.itens.find((l: any) => l.requisito.id === reqManual.id);
    expect(linha.sugestao.sugere).toBe(false); // grau 3, mas sem empregados ativos
    expect(linha.situacao).toBe('a_avaliar');
    const base = { empresaId: A.empresa.id, requisitoId: reqManual.id, aplicabilidade: 'aplicavel' };
    await eng.put('/api/conformidade', { ...base, avaliacao: 'parcial' }).expect(400);
    const salvo = (await eng.put('/api/conformidade', { ...base, avaliacao: 'parcial', avaliacaoEm: dia(0), pendencias: 'Falta técnico' })
      .expect(200)).body;
    m = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(200)).body;
    linha = m.itens.find((l: any) => l.requisito.id === reqManual.id);
    expect(linha.situacao).toBe('parcial');
    expect(linha.conformidade.avaliadoPor).toBeTruthy();
    expect(m.resumo.percentual).toBe(75); // PGR conforme + SESMT parcial
    // Ação da matriz fica ligada à linha.
    await tec.post('/api/acoes', { ...acaoBase(), origem: 'conformidade', conformidadeId: salvo.id, descricao: 'Contratar técnico' }).expect(201);
    linha = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(200)).body.itens.find((l: any) => l.requisito.id === reqManual.id);
    expect(linha.acoesAbertas).toBe(1);
    // Por estabelecimento é uma avaliação separada.
    const e = (await eng.get(`/api/conformidade?empresaId=${A.empresa.id}&estabelecimentoId=${A.estabelecimento.id}`).expect(200)).body;
    expect(e.itens.find((l: any) => l.requisito.id === reqManual.id).situacao).toBe('a_avaliar');
    await eng.get(`/api/conformidade?empresaId=${A.empresa.id}&estabelecimentoId=${B.estabelecimento.id}`).expect(404);
  });

  it('visão consolidada classifica cada empresa', async () => {
    const v = (await adm.get('/api/conformidade/empresas').expect(200)).body;
    const a = v.empresas.find((e: any) => e.id === A.empresa.id);
    expect(a.classe).toBe('com_vencidos'); // há ação atrasada
    expect(a.acoesAtrasadas).toBeGreaterThan(0);
    expect(a.percentual).toBe(75);
    const b = v.empresas.find((e: any) => e.id === B.empresa.id);
    expect(b.classe).toBe('com_pendencias'); // requisitos ainda a avaliar
    // Usuário da empresa A vê só a A.
    const so = (await eng.get('/api/conformidade/empresas').expect(200)).body;
    expect(so.empresas.map((e: any) => e.id)).toEqual([A.empresa.id]);
  });
});

describe('permissões e isolamento', () => {
  it('usuário da empresa B não vê nem altera ações, inspeções e matriz da A', async () => {
    const tecB = await novoUsuario('tec.b@teste.local', 'TEC_SEGURANCA', B.empresa.id);
    const l = (await tecB.get('/api/acoes').expect(200)).body;
    expect(l.itens.every((a: any) => a.empresaId === B.empresa.id)).toBe(true);
    const daA = (await adm.get(`/api/acoes?empresaId=${A.empresa.id}`).expect(200)).body.itens[0];
    await tecB.get(`/api/acoes/${daA.id}`).expect(404);
    await tecB.post(`/api/acoes/${daA.id}/comentarios`, { texto: 'x' }).expect(404);
    await tecB.post('/api/acoes', acaoBase()).expect(403);
    expect((await tecB.get('/api/inspecoes').expect(200)).body).toEqual([]);
    await tecB.get(`/api/conformidade?empresaId=${A.empresa.id}`).expect(403);
  });

  it('RH registra inspeção mas não mexe em ações; visualizador só lê', async () => {
    const rh = await novoUsuario('rh@teste.local', 'RH', A.empresa.id);
    await rh.post('/api/acoes', acaoBase()).expect(403);
    await rh.post('/api/inspecoes', {
      empresaId: A.empresa.id, estabelecimentoId: A.estabelecimento.id, data: dia(0), tipo: 'cipa', responsavelNome: 'Cipeiro',
    }).expect(201);
    const vis = await novoUsuario('vis@teste.local', 'VISUALIZADOR', A.empresa.id);
    expect((await vis.get('/api/acoes').expect(200)).body.itens.length).toBeGreaterThan(0);
    await vis.put('/api/conformidade', { empresaId: A.empresa.id, requisitoId: '00000000-0000-4000-8000-000000000000', aplicabilidade: 'aplicavel' })
      .expect(403);
  });

  it('RLS do banco também isola sem a API', async () => {
    const c = new Client({ connectionString: amb.urlApp });
    await c.connect();
    await c.query('BEGIN');
    for (const t of ['acao', 'acao_historico', 'acao_evidencia', 'inspecao', 'ocorrencia', 'conformidade', 'requisito', 'contador'])
      expect((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
    await c.query('ROLLBACK');
    await c.end();
  });
});
