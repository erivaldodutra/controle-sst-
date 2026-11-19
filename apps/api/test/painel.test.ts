/**
 * Fase 6: calendário de obrigações, notificações, indicadores, relatórios e assistente de IA.
 *
 * O assistente fala com um servidor HTTP LOCAL que imita a API da Anthropic só neste teste
 * (endereço passado pela configuração de teste). O sistema não tem caminho que invente respostas.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { semIdentificacao } from '../src/ia/ia.service';
import { Agente, Ambiente, configurarELogar, cpfTeste, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let tec: Agente;
let tecB: Agente;
let vis: Agente;
let A: Awaited<ReturnType<typeof criarEmpresa>>;
let B: Awaited<ReturnType<typeof criarEmpresa>>;
let vinculoId: string;
const CPF = cpfTeste();
const NOME = 'Josefina Trabalhadora Teste';
const CHAVE = 'sk-ant-api03-teste_local_0123456789abcdefXYZ9';

let servidor: Server;
const recebidos: { url: string; headers: Record<string, unknown>; corpo: any }[] = [];
let modo: 'ok' | 'recusa' | '401' = 'ok';

const hoje = new Date();
const dia = (delta: number) => new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta)).toISOString().slice(0, 10);

async function novoUsuario(email: string, perfil: string, empresaId: string | null) {
  await adm.post('/api/usuarios', { nome: email, email, senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil, empresaId }] }).expect(201);
  const a = amb.agente();
  await a.post('/api/auth/login', { email, senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  return a;
}

const binario = (r: any) => r.buffer(true).parse((res: any, cb: any) => {
  const p: Buffer[] = [];
  res.on('data', (c: Buffer) => p.push(c));
  res.on('end', () => cb(null, Buffer.concat(p)));
});

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      const corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
      recebidos.push({ url: req.url!, headers: req.headers, corpo });
      res.setHeader('Content-Type', 'application/json');
      if (modo === '401') {
        res.writeHead(401);
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        return;
      }
      const texto = modo === 'recusa' ? '' : JSON.stringify({
        texto: 'Resposta de teste do servidor local.',
        acoes: [{ descricao: 'Cadastrar o responsável pelos registros ambientais', prioridade: 'alta' }, { descricao: '  ', prioridade: 'x' }],
      });
      res.writeHead(200);
      res.end(JSON.stringify({
        id: 'msg_teste', type: 'message', role: 'assistant', model: corpo.model,
        content: texto ? [{ type: 'text', text: texto }] : [],
        stop_reason: modo === 'recusa' ? 'refusal' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = (servidor.address() as AddressInfo).port;
  amb = await prepararAmbiente('painel', { iaBaseUrlTeste: `http://127.0.0.1:${porta}` });
  adm = await configurarELogar(amb);
  A = await criarEmpresa(adm, 'Empresa Painel');
  B = await criarEmpresa(adm, 'Outra Empresa');
  tec = await novoUsuario('tec.painel@teste.local', 'TEC_SEGURANCA', A.empresa.id);
  tecB = await novoUsuario('tec.b@teste.local', 'TEC_SEGURANCA', B.empresa.id);
  vis = await novoUsuario('vis.painel@teste.local', 'VISUALIZADOR', A.empresa.id);
  const e = A.empresa.id;
  const funcao = (await adm.post(`/api/empresas/${e}/estrutura/funcoes`, { nome: 'Soldador', descricaoAtividades: 'Soldar estruturas metálicas' }).expect(201)).body.id;
  const f = (await adm.post(`/api/empresas/${e}/funcionarios`, {
    pessoa: { nome: NOME, cpf: CPF }, matricula: 'P-001', dataAdmissao: dia(-400),
    posicao: { estabelecimentoId: A.estabelecimento.id, funcaoId: funcao },
  }).expect(201)).body;
  vinculoId = f.vinculoId;
  const medico = (await adm.post('/api/saude/medicos', { nome: 'Médico Examinador', crm: '654321', ufCrm: 'SP' }).expect(201)).body.id;
  await adm.post('/api/asos', { vinculoId, tipo: 1, dataExame: dia(-355), resultado: 1, medicoId: medico, vencimento: dia(10) }).expect(201);
  await adm.post('/api/acoes', {
    empresaId: e, estabelecimentoId: A.estabelecimento.id, origem: 'pgr', perigo: 'Fumos metálicos', descricao: 'Instalar exaustão localizada',
    tipo: 'introduzir', prioridade: 'alta', responsavelNome: 'Responsável Teste', dataAbertura: dia(-3), prazo: dia(5),
  }).expect(201);
  await adm.post('/api/acoes', {
    empresaId: B.empresa.id, estabelecimentoId: B.estabelecimento.id, origem: 'outra', perigo: 'Queda', descricao: 'Ação da outra empresa',
    tipo: 'introduzir', prioridade: 'media', responsavelNome: 'Outro Responsável', dataAbertura: dia(-1), prazo: dia(3),
  }).expect(201);
}, 90_000);
afterAll(async () => {
  await amb?.fechar();
  servidor?.close();
});

describe('calendário de obrigações', () => {
  it('junta os prazos dos módulos, sem digitação, respeitando as empresas do usuário', async () => {
    const c = (await tec.get('/api/calendario').expect(200)).body;
    const aso = c.itens.find((i: any) => i.categoria === 'aso');
    expect(aso).toMatchObject({ data: dia(10), estado: 'proximo', link: expect.stringMatching(/^\/funcionarios\//) });
    expect(aso.titulo).toContain(NOME);
    expect(c.itens.find((i: any) => i.categoria === 'acao')).toMatchObject({ data: dia(5), estado: 'proximo' });
    expect(c.itens.some((i: any) => i.empresaId === B.empresa.id)).toBe(false);
    const todos = (await adm.get('/api/calendario').expect(200)).body;
    expect(todos.itens.some((i: any) => i.empresaId === B.empresa.id)).toBe(true);
    const soB = (await adm.get(`/api/calendario?empresaId=${B.empresa.id}`).expect(200)).body;
    expect(soB.itens.every((i: any) => i.empresaId === B.empresa.id)).toBe(true);
  });
});

describe('notificações', () => {
  it('gera um aviso por prazo, sem repetir, e cada usuário vê só os seus', async () => {
    const n1 = (await tec.get('/api/notificacoes').expect(200)).body;
    expect(n1.naoLidas).toBe(2);
    const n2 = (await tec.get('/api/notificacoes').expect(200)).body;
    expect(n2.naoLidas).toBe(2);
    expect(n2.itens.map((i: any) => i.id).sort()).toEqual(n1.itens.map((i: any) => i.id).sort());
    const nAdm = (await adm.get('/api/notificacoes').expect(200)).body;
    expect(nAdm.naoLidas).toBe(3);
    // Marcar a notificação de outro usuário não tem efeito (RLS).
    await adm.post(`/api/notificacoes/${n1.itens[0].id}/lida`).expect(201);
    expect((await tec.get('/api/notificacoes').expect(200)).body.naoLidas).toBe(2);
    await tec.post(`/api/notificacoes/${n1.itens[0].id}/lida`).expect(201);
    expect((await tec.get('/api/notificacoes').expect(200)).body.naoLidas).toBe(1);
    expect((await tec.get('/api/notificacoes?todas=1').expect(200)).body.itens).toHaveLength(2);
  });

  it('a categoria desligada pelo usuário sai da lista', async () => {
    const p = (await adm.put('/api/notificacoes/preferencias', { categorias: { acao: false } }).expect(200)).body;
    expect(p.categorias).toMatchObject({ acao: false, aso: true });
    const n = (await adm.get('/api/notificacoes').expect(200)).body;
    expect(n.itens.every((i: any) => i.categoria !== 'acao')).toBe(true);
    expect(n.naoLidas).toBe(1);
    await adm.post('/api/notificacoes/lidas').expect(201);
    expect((await adm.get('/api/notificacoes').expect(200)).body.naoLidas).toBe(0);
    await adm.put('/api/notificacoes/preferencias', { categorias: { acao: 'sim' } }).expect(400);
  });
});

describe('indicadores', () => {
  it('calcula dos registros atuais, por período e empresa', async () => {
    const i = (await tec.get('/api/indicadores').expect(200)).body;
    expect(i.meses).toHaveLength(12);
    expect(i.acoes.abertas).toBe(1);
    expect(i.acoesPorMes.at(-1).abertas + (i.acoesPorMes.at(-2)?.abertas ?? 0)).toBe(1);
    expect(i.saude.aso.vencendo).toBe(1);
    expect(i.ocorrenciasPorMes.acidentes).toBe(0);
    expect(i.conformidade.empresas).toHaveLength(1);
    expect((await adm.get('/api/indicadores?meses=6').expect(200)).body.meses).toHaveLength(6);
    expect((await adm.get('/api/indicadores').expect(200)).body.acoes.abertas).toBe(2);
    expect((await adm.get(`/api/indicadores?empresaId=${A.empresa.id}`).expect(200)).body.acoes.abertas).toBe(1);
  });
});

describe('relatórios', () => {
  it('lista os relatórios disponíveis', async () => {
    const r = (await vis.get('/api/relatorios').expect(200)).body;
    expect(r.find((x: any) => x.tipo === 'funcionarios').disponivel).toBe(true);
  });

  it('gera PDF e Excel no próprio computador', async () => {
    const pdf = await binario(tec.get(`/api/relatorios/acoes?formato=pdf&empresaId=${A.empresa.id}`)).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const x = await binario(tec.get(`/api/relatorios/funcionarios?formato=xlsx&empresaId=${A.empresa.id}`)).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(4).values).toContain('Nome');
    expect(ws.getRow(4).values).not.toContain('Empresa');
    expect(ws.getRow(5).values).toContain(NOME);
    const aso = await binario(tec.get('/api/relatorios/aso?formato=xlsx')).expect(200);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(aso.body);
    const linha = wb2.worksheets[0]!.getRow(5).values as unknown[];
    expect(linha).toContain('Vencendo');
    expect(linha.some((v) => v instanceof Date)).toBe(true);
    for (const t of ['documentos', 'ocorrencias', 'conformidade', 'esocial', 'calendario', 'treinamentos'])
      await binario(adm.get(`/api/relatorios/${t}?formato=pdf`)).expect(200);
  });

  it('confere permissão e filtros', async () => {
    await tec.get(`/api/relatorios/acoes?formato=pdf&empresaId=${B.empresa.id}`).expect(403);
    await tec.get('/api/relatorios/acoes?formato=doc').expect(400);
    await tec.get('/api/relatorios/inexistente?formato=pdf').expect(404);
  });
});

describe('assistente de IA', () => {
  it('desligado por padrão; só quem configura o sistema ativa', async () => {
    const c = (await tec.get('/api/ia/config').expect(200)).body;
    expect(c.ativo).toBe(false);
    await tec.post(`/api/ia/empresas/${A.empresa.id}/resumo`).expect(422);
    await tec.put('/api/ia/config', { ativo: true, modelo: 'claude-opus-5-5', chave: CHAVE }).expect(403);
    await adm.put('/api/ia/config', { ativo: true, modelo: 'claude-opus-5-5' }).expect(422);
    await adm.put('/api/ia/config', { ativo: true, modelo: 'claude-opus-5-5', chave: 'abc' }).expect(400);
  });

  it('guarda a chave cifrada e nunca a devolve', async () => {
    const c = (await adm.put('/api/ia/config', { ativo: true, modelo: 'claude-opus-5-5', chave: CHAVE }).expect(200)).body;
    expect(c).toMatchObject({ ativo: true, temChave: true, chaveFinal: CHAVE.slice(-4) });
    expect(JSON.stringify(c)).not.toContain(CHAVE.slice(0, 20));
    // Salvar sem chave mantém a atual.
    expect((await adm.put('/api/ia/config', { ativo: true, modelo: 'claude-sonnet-5-5' }).expect(200)).body.temChave).toBe(true);
    await adm.put('/api/ia/config', { ativo: true, modelo: 'claude-opus-5-5' }).expect(200);
    const db = new Client({ connectionString: amb.urlDono });
    await db.connect();
    const r = (await db.query('SELECT chave_cifrada FROM ia_config')).rows[0];
    expect(r.chave_cifrada.startsWith('v1.')).toBe(true);
    expect(r.chave_cifrada).not.toContain(CHAVE);
    const aud = (await db.query(`SELECT coalesce(depois::text, '') AS d FROM auditoria WHERE tabela = 'ia_config'`)).rows;
    expect(aud.length).toBeGreaterThan(0);
    expect(aud.every((x) => !x.d.includes('chave_cifrada') && !x.d.includes(CHAVE))).toBe(true);
    await db.end();
  });

  let resumo: any;
  it('resumo de pendências: manda só contagens e volta como sugestão pendente', async () => {
    recebidos.length = 0;
    resumo = (await tec.post(`/api/ia/empresas/${A.empresa.id}/resumo`).expect(201)).body;
    expect(resumo).toMatchObject({ situacao: 'pendente', tipo: 'resumo_pendencias', texto: 'Resposta de teste do servidor local.', modelo: 'claude-opus-5-5' });
    expect(resumo.acoesSugeridas).toEqual([{ descricao: 'Cadastrar o responsável pelos registros ambientais', prioridade: 'alta' }]);
    expect(recebidos).toHaveLength(1);
    const req = recebidos[0]!;
    expect(req.url).toMatch(/^\/v1\/messages/);
    expect(req.headers.authorization).toBe(`Bearer ${CHAVE}`);
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(req.corpo).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(req.corpo.thinking).toBeUndefined();
    const enviado = JSON.stringify(req.corpo);
    expect(enviado).not.toContain(NOME);
    expect(enviado).not.toContain(CPF);
    expect(resumo.enviado).toEqual(JSON.parse(req.corpo.messages[0].content.split('Dados (JSON):\n')[1]));
  });

  it('explica erros de um evento sem mandar nome, CPF ou valores digitados', async () => {
    const ev = (await tec.post('/api/esocial/preparar/s2240', { vinculoId }).expect(201)).body;
    expect(ev.situacao).toBe('invalido');
    recebidos.length = 0;
    const s = (await tec.post(`/api/ia/eventos/${ev.id}/explicacao`).expect(201)).body;
    expect(s).toMatchObject({ tipo: 'explicar_rejeicao', eventoId: ev.id, eventoTipo: 'S-2240', situacao: 'pendente' });
    const enviado = JSON.stringify(recebidos[0]!.corpo);
    expect(enviado).not.toContain(NOME);
    expect(enviado).not.toContain(CPF);
    expect(s.enviado.errosValidacao.length).toBeGreaterThan(0);
    expect((await tec.get(`/api/ia/sugestoes?eventoId=${ev.id}`).expect(200)).body).toHaveLength(1);
  });

  it('a IA não decide: uma pessoa aceita ou descarta, uma única vez, e o texto não muda', async () => {
    await vis.post(`/api/ia/sugestoes/${resumo.id}/aceite`).expect(403);
    await tecB.post(`/api/ia/sugestoes/${resumo.id}/aceite`).expect(404);
    expect((await tecB.get('/api/ia/sugestoes').expect(200)).body).toHaveLength(0);
    const a = (await tec.post(`/api/ia/sugestoes/${resumo.id}/aceite`).expect(201)).body;
    expect(a).toMatchObject({ situacao: 'aceita', decididoPorNome: 'tec.painel@teste.local' });
    await tec.post(`/api/ia/sugestoes/${resumo.id}/descarte`, { motivo: 'Mudei de ideia' }).expect(422);
    const outra = (await tec.get('/api/ia/sugestoes?situacao=pendente').expect(200)).body[0];
    await tec.post(`/api/ia/sugestoes/${outra.id}/descarte`, {}).expect(400);
    const d = (await tec.post(`/api/ia/sugestoes/${outra.id}/descarte`, { motivo: 'Já corrigido no cadastro' }).expect(201)).body;
    expect(d).toMatchObject({ situacao: 'descartada', motivoDescarte: 'Já corrigido no cadastro' });
    const db = new Client({ connectionString: amb.urlDono });
    await db.connect();
    await expect(db.query(`UPDATE sugestao_ia SET texto = 'outro' WHERE id = $1`, [resumo.id])).rejects.toThrow(/não pode ser alterada/);
    await db.end();
  });

  it('recusa, chave inválida e falta de permissão não gravam nada', async () => {
    const antes = (await adm.get('/api/ia/sugestoes').expect(200)).body.length;
    modo = 'recusa';
    await tec.post(`/api/ia/empresas/${A.empresa.id}/resumo`).expect(422);
    modo = '401';
    const r = await tec.post(`/api/ia/empresas/${A.empresa.id}/resumo`).expect(422);
    expect(r.body.mensagem).toMatch(/chave da API foi recusada/);
    modo = 'ok';
    await vis.post(`/api/ia/empresas/${A.empresa.id}/resumo`).expect(403);
    await tec.post(`/api/ia/empresas/${B.empresa.id}/resumo`).expect(403);
    expect((await adm.get('/api/ia/sugestoes').expect(200)).body.length).toBe(antes);
  });

  it('tira identificação das mensagens antes de enviar', () => {
    const t = semIdentificacao("Fulano de Tal, CPF 123.456.789-09: valor 'Fulano de Tal' inválido, CID S61.0, nis 12345678901", ['Fulano de Tal']);
    expect(t).not.toMatch(/Fulano|123\.456|S61|12345678901/);
  });
});
