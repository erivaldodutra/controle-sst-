/**
 * Fase 5: eventos S-2220, S-2240, S-2210 e S-3000.
 *
 * Banco descartável e um servidor HTTPS LOCAL que imita o webservice do eSocial só neste
 * teste (exige certificado de cliente e devolve protocolo/recibos de teste). Nada aqui fala
 * com o governo, e o código do sistema não tem nenhum caminho que simule transmissão.
 */
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, cpfTeste, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let tec: Agente;
let med: Agente;
let A: Awaited<ReturnType<typeof criarEmpresa>>;
let vinculoId: string;
let funcionarioId: string;
let gheId: string;
let asoId: string;
let servidor: Server;
let servidorPem: string;
const recebidos: { op: string; corpo: string; certCliente: boolean }[] = [];
let modoServidor: 'normal' | 'erro500' = 'normal';

const hoje = new Date();
const dia = (delta: number) => new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta)).toISOString().slice(0, 10);

function certificado(cn: string, extensoes = false) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = String(Date.now());
  c.validity.notBefore = new Date(Date.now() - 86400_000);
  c.validity.notAfter = new Date(Date.now() + 86400_000 * 30);
  const attrs = [{ name: 'commonName', value: cn }];
  c.setSubject(attrs);
  c.setIssuer(attrs);
  if (extensoes) c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]);
  c.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, cert: c };
}

function pfx(cn: string, senha: string) {
  const { keys, cert } = certificado(cn);
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' })).getBytes(), 'binary');
}

let protocolo = 0;
let recibo = 1000;
const lotes = new Map<string, string[]>();

/** Respostas no formato do eSocial, só para este teste. */
function responder(op: string, corpo: string) {
  const env = (x: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${x}</s:Body></s:Envelope>`;
  if (op === 'envio') {
    const ids = [...corpo.matchAll(/<evento Id="(ID\d+)">/g)].map((m) => m[1]!);
    const p = `1.2.202611.${String(++protocolo).padStart(13, '0')}`;
    lotes.set(p, ids);
    return env(`<EnviarLoteEventosResponse xmlns="http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0"><EnviarLoteEventosResult>`
      + `<eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoEnvio/v1_1_0"><retornoEnvioLoteEventos>`
      + '<ideEmpregador><tpInsc>1</tpInsc><nrInsc>12345678</nrInsc></ideEmpregador><ideTransmissor><tpInsc>1</tpInsc><nrInsc>12345678000195</nrInsc></ideTransmissor>'
      + '<status><cdResposta>201</cdResposta><descResposta>Lote Recebido com Sucesso.</descResposta></status>'
      + `<dadosRecepcaoLote><dhRecepcao>2026-11-19T10:00:00</dhRecepcao><versaoAplicativoRecepcao>1</versaoAplicativoRecepcao><protocoloEnvio>${p}</protocoloEnvio></dadosRecepcaoLote>`
      + '</retornoEnvioLoteEventos></eSocial></EnviarLoteEventosResult></EnviarLoteEventosResponse>');
  }
  const p = /<protocoloEnvio>([^<]+)</.exec(corpo)![1]!;
  const ids = lotes.get(p) ?? [];
  const eventos = ids.map((id) => `<evento Id="${id}"><retornoEvento><eSocial xmlns="http://www.esocial.gov.br/schema/evt/retornoEvento/v1_3_0">`
    + `<retornoEvento Id="${id}"><ideEmpregador><tpInsc>1</tpInsc><nrInsc>12345678</nrInsc></ideEmpregador>`
    + '<recepcao><tpAmb>2</tpAmb><dhRecepcao>2026-11-19T10:00:00</dhRecepcao><versaoAppRecepcao>1</versaoAppRecepcao><protocoloEnvioLote>1</protocoloEnvioLote></recepcao>'
    + '<processamento><cdResposta>201</cdResposta><descResposta>Sucesso.</descResposta><versaoAppProcessamento>1</versaoAppProcessamento><dhProcessamento>2026-11-19T10:00:01</dhProcessamento></processamento>'
    + `<recibo><nrRecibo>1.2.${String(++recibo).padStart(19, '0')}</nrRecibo><hash>abc</hash></recibo></retornoEvento></eSocial></retornoEvento></evento>`).join('');
  return env('<ConsultarLoteEventosResponse xmlns="http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0"><ConsultarLoteEventosResult>'
    + '<eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/retornoProcessamento/v1_3_0"><retornoProcessamentoLoteEventos>'
    + '<status><cdResposta>201</cdResposta><descResposta>Lote processado com sucesso.</descResposta></status>'
    + `<retornoEventos>${eventos}</retornoEventos></retornoProcessamentoLoteEventos></eSocial></ConsultarLoteEventosResult></ConsultarLoteEventosResponse>`);
}

async function novoUsuario(email: string, perfil: string, empresaId: string | null) {
  await adm.post('/api/usuarios', { nome: email, email, senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil, empresaId }] }).expect(201);
  const a = amb.agente();
  await a.post('/api/auth/login', { email, senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  return a;
}

beforeAll(async () => {
  const s = certificado('localhost', true);
  servidorPem = forge.pki.certificateToPem(s.cert);
  servidor = createServer({
    key: forge.pki.privateKeyToPem(s.keys.privateKey), cert: servidorPem, requestCert: true, rejectUnauthorized: false,
  }, (req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      const corpo = Buffer.concat(partes).toString('utf8');
      const op = req.url!.includes('consulta') ? 'consulta' : 'envio';
      const certCliente = !!(req.socket as any).getPeerCertificate?.()?.subject;
      recebidos.push({ op, corpo, certCliente });
      if (modoServidor === 'erro500') { res.writeHead(500); res.end('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>Indisponível</faultstring></s:Fault></s:Body></s:Envelope>'); return; }
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(responder(op, corpo));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = (servidor.address() as AddressInfo).port;
  const base = `https://localhost:${porta}`;
  const enderecos = { envio: `${base}/envio`, consulta: `${base}/consulta` };
  amb = await prepararAmbiente('esocial', { enderecosEsocialTeste: { 1: enderecos, 2: enderecos } });
  adm = await configurarELogar(amb);
  A = await criarEmpresa(adm, 'Empresa eSocial');
  tec = await novoUsuario('tec.es@teste.local', 'TEC_SEGURANCA', A.empresa.id);
  med = await novoUsuario('med.es@teste.local', 'MEDICO', A.empresa.id);
  const e = A.empresa.id;
  const setor = (await adm.post(`/api/empresas/${e}/estrutura/setores`, { estabelecimentoId: A.estabelecimento.id, nome: 'Manutenção' }).expect(201)).body.id;
  gheId = (await adm.post(`/api/empresas/${e}/estrutura/ghes`, { estabelecimentoId: A.estabelecimento.id, codigo: 'GHE-01', nome: 'Manutenção mecânica' }).expect(201)).body.id;
  const funcao = (await adm.post(`/api/empresas/${e}/estrutura/funcoes`, { nome: 'Mecânico', descricaoAtividades: 'Realizar manutenção preventiva e corretiva de máquinas' }).expect(201)).body.id;
  const f = (await adm.post(`/api/empresas/${e}/funcionarios`, {
    pessoa: { nome: 'Trabalhador Teste', cpf: cpfTeste() }, matricula: 'M-001', dataAdmissao: dia(-200),
    posicao: { estabelecimentoId: A.estabelecimento.id, setorId: setor, funcaoId: funcao, gheId },
  }).expect(201)).body;
  vinculoId = f.vinculoId;
  funcionarioId = f.funcionarioId;
  const medico = (await adm.post('/api/saude/medicos', { nome: 'Médica Examinadora', crm: '123456', ufCrm: 'SP' }).expect(201)).body.id;
  const audio = (await adm.post('/api/saude/tipos-exame', { nome: 'Audiometria tonal', codigoEsocial: '0281' }).expect(201)).body.id;
  asoId = (await adm.post('/api/asos', {
    vinculoId, tipo: 1, dataExame: dia(-5), resultado: 1, medicoId: medico, vencimento: dia(360),
    exames: [{ exameTipoId: audio, dataRealizacao: dia(-6), ordem: 2 }],
  }).expect(201)).body.id;
}, 90_000);
afterAll(async () => {
  await amb?.fechar();
  servidor?.close();
});

describe('configuração', () => {
  it('começa na produção restrita e não deixa ir para produção sem liberação', async () => {
    const c = (await adm.get(`/api/esocial/config/${A.empresa.id}`).expect(200)).body;
    expect(c.ambiente).toBe(2);
    expect(c.certificado).toBeNull();
    await adm.put(`/api/esocial/config/${A.empresa.id}`, { ambiente: 1, transmissorTipo: 1, transmissorInscricao: A.empresa.inscricao }).expect(422);
    await adm.post(`/api/esocial/config/${A.empresa.id}/liberar-producao`).expect(409);
    await tec.put(`/api/esocial/config/${A.empresa.id}`, { ambiente: 2, transmissorTipo: 1, transmissorInscricao: A.empresa.inscricao }).expect(403);
  });

  it('recebe o certificado A1, guarda cifrado e nunca devolve o conteúdo', async () => {
    const arq = pfx(`EMPRESA ESOCIAL:${A.empresa.inscricao}`, 'senha-certa');
    await adm.upload(`/api/esocial/config/${A.empresa.id}/certificado`, 'arquivo', arq, 'cert.pfx').field('senha', 'errada').expect(400);
    const c = (await adm.upload(`/api/esocial/config/${A.empresa.id}/certificado`, 'arquivo', arq, 'cert.pfx').field('senha', 'senha-certa').expect(201)).body;
    expect(c.certificado.titular).toBe('EMPRESA ESOCIAL');
    expect(c.certificado.documento).toBe(A.empresa.inscricao);
    expect(JSON.stringify(c)).not.toMatch(/pfx|senha/i);
    const db = new Client({ connectionString: amb.urlDono });
    await db.connect();
    const r = (await db.query('SELECT pfx_cifrado, senha_cifrada FROM esocial_certificado WHERE ativo')).rows[0];
    expect(r.pfx_cifrado.startsWith('v1.')).toBe(true);
    expect(r.senha_cifrada).not.toContain('senha-certa');
    const aud = (await db.query(`SELECT depois::text AS d FROM auditoria WHERE tabela = 'esocial_certificado'`)).rows;
    expect(aud.length).toBeGreaterThan(0);
    expect(aud.every((x) => !x.d.includes('pfx_cifrado'))).toBe(true);
    await db.end();
  });

  it('aceita a cadeia de autoridades (aqui, a do servidor de teste)', async () => {
    const c = (await adm.upload(`/api/esocial/config/${A.empresa.id}/cadeia`, 'arquivo', Buffer.from(servidorPem), 'cadeia.pem').expect(201)).body;
    expect(c.certificadosCadeia).toBe(1);
  });
});

describe('S-2220', () => {
  let ev: any;

  it('gera o evento do ASO, valida no XSD oficial e espera aprovação', async () => {
    ev = (await tec.post(`/api/esocial/preparar/s2220/${asoId}`).expect(201)).body;
    expect(ev.situacao).toBe('pendente');
    expect(ev.erros).toEqual([]);
    expect(ev.idEvento).toMatch(/^ID1\d{8}0{6}\d{14}\d{5}$/);
    expect(ev.xml).toContain('<procRealizado>0295</procRealizado>');
    expect(ev.xml).toContain('<procRealizado>0281</procRealizado><ordExame>2</ordExame>');
    expect(ev.xml).not.toContain('indResult');
    // Gerar de novo refaz o mesmo evento (mesmo Id), sem duplicar.
    const de_novo = (await tec.post(`/api/esocial/preparar/s2220/${asoId}`).expect(201)).body;
    expect(de_novo.id).toBe(ev.id);
  });

  it('só quem pode transmitir aprova; a aprovação assina', async () => {
    await tec.post('/api/esocial/aprovacao', { ids: [ev.id] }).expect(403);
    await adm.post('/api/esocial/aprovacao', { ids: [ev.id] }).expect(201);
    const a = (await adm.get(`/api/esocial/eventos/${ev.id}`).expect(200)).body;
    expect(a.situacao).toBe('aprovado');
    expect(a.aprovadoPorNome).toBe('Admin Teste');
    const xml = (await adm.get(`/api/esocial/eventos/${ev.id}/xml`).expect(200)).text;
    expect(xml).toContain('<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>');
    expect(xml).toContain('<Reference URI="">');
  });

  it('falha de comunicação não vira sucesso: lote registra a falha e o evento volta para aprovado', async () => {
    modoServidor = 'erro500';
    const l = (await adm.post(`/api/esocial/envio/${A.empresa.id}`).expect(201)).body;
    modoServidor = 'normal';
    expect(l.situacao).toBe('falha_comunicacao');
    expect(l.descResposta, l.descResposta).toMatch(/HTTP 500/);
    expect((await adm.get(`/api/esocial/eventos/${ev.id}`).expect(200)).body.situacao).toBe('aprovado');
  });

  it('envia com certificado de cliente, recebe protocolo e só marca processado com recibo', async () => {
    const l = (await adm.post(`/api/esocial/envio/${A.empresa.id}`).expect(201)).body;
    expect(l.situacao).toBe('aguardando');
    expect(l.protocolo).toMatch(/^1\.2\./);
    const env = recebidos.filter((r) => r.op === 'envio').pop()!;
    expect(env.certCliente).toBe(true);
    expect(env.corpo).toContain('<envioLoteEventos grupo="2">');
    expect((await adm.get(`/api/esocial/eventos/${ev.id}`).expect(200)).body.situacao).toBe('enviado');
    const c = (await adm.post(`/api/esocial/lotes/${l.id}/consulta`).expect(201)).body;
    expect(c.situacao).toBe('processado');
    const p = (await adm.get(`/api/esocial/eventos/${ev.id}`).expect(200)).body;
    expect(p.situacao).toBe('processado');
    expect(p.nrRecibo).toMatch(/^1\.2\.\d{19}$/);
    ev = p;
  });

  it('evento processado não é refeito; correção só por retificação', async () => {
    await tec.post(`/api/esocial/preparar/s2220/${asoId}`).expect(422);
    const r = (await adm.post(`/api/esocial/eventos/${ev.id}/retificar`).expect(201)).body;
    expect(r.indRetif).toBe(2);
    expect(r.xml).toContain(`<indRetif>2</indRetif><nrRecibo>${ev.nrRecibo}</nrRecibo>`);
    expect(r.situacao).toBe('pendente');
    await adm.post(`/api/esocial/eventos/${r.id}/descartar`, { motivo: 'Teste' }).expect(201);
  });

  it('libera a produção só depois de evento aceito na produção restrita', async () => {
    const c = (await adm.post(`/api/esocial/config/${A.empresa.id}/liberar-producao`).expect(201)).body;
    expect(c.producaoLiberadaEm).toBeTruthy();
  });

  it('exclusão S-3000 processada marca o original como excluído', async () => {
    const rx = await adm.post(`/api/esocial/eventos/${ev.id}/excluir`);
    expect(rx.status, JSON.stringify(rx.body)).toBe(201);
    const x = rx.body;
    expect(x.tipo).toBe('S-3000');
    expect(x.situacao).toBe('pendente');
    expect(x.xml).toContain(`<nrRecEvt>${ev.nrRecibo}</nrRecEvt>`);
    await adm.post('/api/esocial/aprovacao', { ids: [x.id] }).expect(201);
    const l = (await adm.post(`/api/esocial/envio/${A.empresa.id}`).expect(201)).body;
    await adm.post(`/api/esocial/lotes/${l.id}/consulta`).expect(201);
    expect((await adm.get(`/api/esocial/eventos/${ev.id}`).expect(200)).body.situacao).toBe('excluido');
  });
});

describe('S-2240', () => {
  it('sem agentes nem responsável, o evento fica com erros e não pode ser aprovado', async () => {
    const ev = (await tec.post('/api/esocial/preparar/s2240', { vinculoId }).expect(201)).body;
    expect(ev.situacao).toBe('invalido');
    expect(ev.erros.map((e: any) => e.mensagem).join(' ')).toMatch(/09\.01\.001/);
    expect(ev.erros.map((e: any) => e.mensagem).join(' ')).toMatch(/responsável pelos registros ambientais/);
    await adm.post('/api/esocial/aprovacao', { ids: [ev.id] }).expect(422);
  });

  it('valida as regras do agente nocivo', async () => {
    await tec.post('/api/esocial/agentes', { gheId, codigo: '02.01.001', tpAval: 1, inicio: dia(-300), utilizEpc: 0, utilizEpi: 0 }).expect(400);
    await tec.post('/api/esocial/agentes', { gheId, codigo: '99.99.999', tpAval: 2, inicio: dia(-300), utilizEpc: 0, utilizEpi: 0 }).expect(422);
    await tec.post('/api/esocial/agentes', {
      gheId, codigo: '02.01.001', tpAval: 1, intConc: 87.5, unMed: 4, tecMedicao: 'NHO 01', inicio: dia(-300),
      utilizEpc: 1, utilizEpi: 2, eficEpi: 'S', epis: ['12345'],
      epiCompl: { medProtecao: 'S', condFuncto: 'S', usoInint: 'S', przValid: 'S', periodicTroca: 'S', higienizacao: 'S' },
    }).expect(201);
    await tec.post('/api/esocial/responsaveis', {
      empresaId: A.empresa.id, nome: 'Engenheira Responsável', cpf: cpfTeste(), ideOc: 4, nrOc: '5061234567', ufOc: 'SP', inicio: dia(-365),
    }).expect(201);
  });

  it('com os cadastros completos, gera o S-2240 válido no XSD', async () => {
    const ev = (await tec.post('/api/esocial/preparar/s2240', { vinculoId }).expect(201)).body;
    expect(ev.erros, JSON.stringify(ev.erros)).toEqual([]);
    expect(ev.situacao).toBe('pendente');
    expect(ev.xml).toContain('<codAgNoc>02.01.001</codAgNoc>');
    expect(ev.xml).toContain('<intConc>87.5</intConc>');
    expect(ev.xml).toContain('<dscAtivDes>Realizar manutenção preventiva e corretiva de máquinas</dscAtivDes>');
    const pend = (await adm.get(`/api/esocial/pendencias/${A.empresa.id}`).expect(200)).body;
    expect(pend.s2240).toEqual([]);
  });
});

describe('S-2210', () => {
  let cat: string;

  it('CAT da ocorrência: dados do acidente por quem prepara, atestado só com acesso clínico', async () => {
    const o = (await tec.post('/api/ocorrencias', {
      empresaId: A.empresa.id, estabelecimentoId: A.estabelecimento.id, funcionarioId, dataHora: `${dia(-2)}T09:30`,
      tipo: 'acidente_tipico', gravidade: 'moderada', descricao: 'Corte na mão ao manusear chapa', houveAfastamento: true,
    }).expect(201)).body;
    const dados = {
      vinculoId, tpCat: 1, hrsTrabAntesAcid: '0130', indCatObito: 'N', indComunPolicia: 'N', codSitGeradora: '200004300',
      iniciatCat: 1, ultDiaTrab: dia(-2), tpLocal: 1, dscLograd: 'Rua das Indústrias', nrLograd: '100', cep: '01001000', codMunic: '3550308',
      uf: 'SP', localTpInsc: 1, localNrInsc: A.estabelecimento.inscricao, codParteAting: '755070000', lateralidade: 2, codAgntCausador: '302010200',
    };
    cat = (await tec.post(`/api/esocial/ocorrencias/${o.id}/cats`, dados).expect(201)).body.id;
    const semAtestado = (await tec.post(`/api/esocial/preparar/s2210/${cat}`).expect(201)).body;
    expect(semAtestado.situacao).toBe('invalido');
    const atestado = {
      dtAtendimento: dia(-2), hrAtendimento: '1015', indInternacao: 'N', durTrat: 5, indAfast: 'S', dscLesao: '702005000',
      codCid: 'S610', nmEmit: 'Médica Plantonista', ideOcEmit: 1, nrOcEmit: '98765', ufOcEmit: 'SP',
    };
    await adm.put(`/api/esocial/cats/${cat}/atestado`, atestado).expect(403);
    await med.put(`/api/esocial/cats/${cat}/atestado`, atestado).expect(200);
    const lista = (await tec.get(`/api/esocial/ocorrencias/${o.id}/cats`).expect(200)).body;
    expect(lista[0].temAtestado).toBe(true);
    expect(lista[0].atestado).toBeNull();
    expect((await med.get(`/api/esocial/ocorrencias/${o.id}/cats`).expect(200)).body[0].atestado.codCid).toBe('S610');
  });

  it('gera o S-2210 válido; o XML (com CID) só aparece para quem tem acesso clínico', async () => {
    const ev = (await tec.post(`/api/esocial/preparar/s2210/${cat}`).expect(201)).body;
    expect(ev.erros).toEqual([]);
    expect(ev.situacao).toBe('pendente');
    expect(ev.xml).toBeNull();
    const pelaMedica = (await med.get(`/api/esocial/eventos/${ev.id}`).expect(200)).body;
    expect(pelaMedica.xml).toContain('<codCID>S610</codCID>');
    expect(pelaMedica.xml).toContain('<hrAcid>0930</hrAcid>');
    await adm.get(`/api/esocial/eventos/${ev.id}/xml`).expect(403);
    // Sem acesso clínico, não aprova a CAT.
    await adm.post('/api/esocial/aprovacao', { ids: [ev.id] }).expect(403);
  });
});

describe('regras no banco', () => {
  it('evento não fica processado sem recibo nem volta de processado para pendente', async () => {
    const db = new Client({ connectionString: amb.urlDono });
    await db.connect();
    const pend = (await db.query(`SELECT id FROM esocial_evento WHERE situacao = 'pendente' LIMIT 1`)).rows[0];
    await expect(db.query(`UPDATE esocial_evento SET situacao = 'processado', processado_em = now() WHERE id = $1`, [pend.id])).rejects.toThrow();
    const proc = (await db.query(`SELECT id FROM esocial_evento WHERE situacao = 'processado' LIMIT 1`)).rows[0];
    await expect(db.query(`UPDATE esocial_evento SET situacao = 'pendente' WHERE id = $1`, [proc.id])).rejects.toThrow(/não é permitida/);
    await expect(db.query(`UPDATE esocial_evento SET xml = 'x' WHERE id = $1`, [proc.id])).rejects.toThrow(/conteúdo/);
    await db.end();
  });

  it('o painel conta os eventos por situação', async () => {
    const p = (await adm.get(`/api/esocial/painel?empresaId=${A.empresa.id}`).expect(200)).body;
    expect(p.porSituacao.processado).toBeGreaterThanOrEqual(1);
    expect(p.porSituacao.excluido).toBe(1);
  });
});
