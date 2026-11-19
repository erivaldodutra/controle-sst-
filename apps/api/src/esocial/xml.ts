import { DOMParser } from '@xmldom/xmldom';

/**
 * Montagem dos XMLs do eSocial (leiaute S-1.3) e leitura dos retornos.
 * Só monta a estrutura: as regras de negócio ficam no serviço e o XSD oficial
 * confere o resultado antes de o evento poder ser aprovado.
 */

export const VERSAO_LEIAUTE = 'v_S_01_03_00';
export const NS_EVENTO: Record<string, string> = {
  'S-2210': `http://www.esocial.gov.br/schema/evt/evtCAT/${VERSAO_LEIAUTE}`,
  'S-2220': `http://www.esocial.gov.br/schema/evt/evtMonit/${VERSAO_LEIAUTE}`,
  'S-2240': `http://www.esocial.gov.br/schema/evt/evtExpRisco/${VERSAO_LEIAUTE}`,
  'S-3000': `http://www.esocial.gov.br/schema/evt/evtExclusao/${VERSAO_LEIAUTE}`,
};
export const XSD_EVENTO: Record<string, string> = {
  'S-2210': 'evtCAT.xsd', 'S-2220': 'evtMonit.xsd', 'S-2240': 'evtExpRisco.xsd', 'S-3000': 'evtExclusao.xsd',
};
export const NS_LOTE = 'http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1';
export const NS_CONSULTA = 'http://www.esocial.gov.br/schema/lote/eventos/envio/consulta/retornoProcessamento/v1_0_0';
export const NS_WS_ENVIO = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0';
export const NS_WS_CONSULTA = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0';
export const ACAO_ENVIO = `${NS_WS_ENVIO}/ServicoEnviarLoteEventos/EnviarLoteEventos`;
export const ACAO_CONSULTA = `${NS_WS_CONSULTA}/ServicoConsultarLoteEventos/ConsultarLoteEventos`;

// ---------------------------------------------------------------------------
// Construtor mínimo
// ---------------------------------------------------------------------------
type Valor = string | number | null | undefined | false;
type Filhos = (string | null | undefined | false)[];

export const esc = (v: string | number) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Elemento com valor (escapado). Valor vazio/ausente omite o elemento. */
export function v(nome: string, valor: Valor): string {
  if (valor === null || valor === undefined || valor === false) return '';
  const s = typeof valor === 'number' ? String(valor) : valor.trim();
  return s === '' ? '' : `<${nome}>${esc(s)}</${nome}>`;
}

/** Grupo com filhos já montados. Grupo sem filhos é omitido. */
export function g(nome: string, filhos: Filhos, attrs: Record<string, string> = {}): string {
  const dentro = filhos.filter(Boolean).join('');
  if (!dentro) return '';
  const a = Object.entries(attrs).map(([k, x]) => ` ${k}="${esc(x)}"`).join('');
  return `<${nome}${a}>${dentro}</${nome}>`;
}

/** Corta o texto no tamanho máximo do leiaute (sem deixar espaço nas pontas). */
export const corte = (t: string | null | undefined, max: number) => (t ? t.replace(/\s+/g, ' ').trim().slice(0, max).trim() : null);

/** Decimal com até 4 casas, sem notação científica. */
export const decimal = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? null : Number(Number(n).toFixed(4)).toString();

// ---------------------------------------------------------------------------
// Partes comuns
// ---------------------------------------------------------------------------
export interface IdeEvento {
  indRetif: 1 | 2;
  nrRecibo?: string | null;
  tpAmb: 1 | 2;
  verProc: string;
}
export interface IdeEmpregador { tpInsc: 1 | 2; nrInsc: string }
export interface IdeVinculo { cpfTrab: string; matricula: string }

const ideEvento = (i: IdeEvento) => g('ideEvento', [
  v('indRetif', i.indRetif), i.indRetif === 2 ? v('nrRecibo', i.nrRecibo) : '', v('tpAmb', i.tpAmb), v('procEmi', 1), v('verProc', i.verProc),
]);
const ideEmpregador = (e: IdeEmpregador) => g('ideEmpregador', [v('tpInsc', e.tpInsc), v('nrInsc', e.nrInsc)]);
const ideVinculo = (x: IdeVinculo) => g('ideVinculo', [v('cpfTrab', x.cpfTrab), v('matricula', x.matricula)]);

const raiz = (tipo: string, evt: string, id: string, corpo: Filhos) =>
  `<eSocial xmlns="${NS_EVENTO[tipo]}">${g(evt, corpo, { Id: id })}</eSocial>`;

// ---------------------------------------------------------------------------
// S-2220
// ---------------------------------------------------------------------------
export interface DadosS2220 {
  id: string;
  ide: IdeEvento;
  empregador: IdeEmpregador;
  vinculo: IdeVinculo;
  tpExameOcup: number;
  dtAso: string;
  resAso: 1 | 2;
  exames: { dtExm: string; procRealizado: string; obsProc?: string | null; ordExame?: number | null }[];
  medico: { nome: string; crm: string; uf: string };
  respMonit: { cpf?: string | null; nome: string; crm: string; uf: string } | null;
}

export function xmlS2220(d: DadosS2220): string {
  return raiz('S-2220', 'evtMonit', d.id, [
    ideEvento(d.ide), ideEmpregador(d.empregador), ideVinculo(d.vinculo),
    g('exMedOcup', [
      v('tpExameOcup', d.tpExameOcup),
      g('aso', [
        v('dtAso', d.dtAso), v('resAso', d.resAso),
        ...d.exames.map((x) => g('exame', [
          v('dtExm', x.dtExm), v('procRealizado', x.procRealizado), v('obsProc', corte(x.obsProc, 999)), v('ordExame', x.ordExame ?? null),
        ])),
        g('medico', [v('nmMed', corte(d.medico.nome, 70)), v('nrCRM', d.medico.crm), v('ufCRM', d.medico.uf)]),
      ]),
      d.respMonit ? g('respMonit', [
        v('cpfResp', d.respMonit.cpf), v('nmResp', corte(d.respMonit.nome, 70)), v('nrCRM', d.respMonit.crm), v('ufCRM', d.respMonit.uf),
      ]) : '',
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// S-2240
// ---------------------------------------------------------------------------
export interface AgenteXml {
  codigo: string;
  descricao: string | null;
  tpAval: number | null;
  intConc: number | null;
  limTol: number | null;
  unMed: number | null;
  tecMedicao: string | null;
  nrProcJud: string | null;
  utilizEpc: number | null;
  eficEpc: string | null;
  utilizEpi: number | null;
  eficEpi: string | null;
  epis: string[];
  epiCompl: Record<string, string> | null;
}
export interface DadosS2240 {
  id: string;
  ide: IdeEvento;
  empregador: IdeEmpregador;
  vinculo: IdeVinculo;
  dtIniCondicao: string;
  ambientes: { localAmb: 1 | 2; dscSetor: string; tpInsc: number; nrInsc: string }[];
  dscAtivDes: string;
  agentes: AgenteXml[];
  responsaveis: { cpf: string; ideOc: number | null; dscOc: string | null; nrOc: string | null; ufOc: string | null }[];
  obsCompl: string | null;
}

export function xmlS2240(d: DadosS2240): string {
  const semAgente = d.agentes.every((a) => a.codigo === '09.01.001');
  return raiz('S-2240', 'evtExpRisco', d.id, [
    ideEvento(d.ide), ideEmpregador(d.empregador), ideVinculo(d.vinculo),
    g('infoExpRisco', [
      v('dtIniCondicao', d.dtIniCondicao),
      ...d.ambientes.map((a) => g('infoAmb', [v('localAmb', a.localAmb), v('dscSetor', corte(a.dscSetor, 100)), v('tpInsc', a.tpInsc), v('nrInsc', a.nrInsc)])),
      g('infoAtiv', [v('dscAtivDes', corte(d.dscAtivDes, 999))]),
      ...d.agentes.map((a) => g('agNoc', [
        v('codAgNoc', a.codigo), v('dscAgNoc', corte(a.descricao, 100)), v('tpAval', a.tpAval),
        v('intConc', decimal(a.intConc)), v('limTol', decimal(a.limTol)), v('unMed', a.unMed), v('tecMedicao', corte(a.tecMedicao, 40)),
        v('nrProcJud', a.nrProcJud),
        a.codigo === '09.01.001' ? '' : g('epcEpi', [
          v('utilizEPC', a.utilizEpc), v('eficEpc', a.eficEpc), v('utilizEPI', a.utilizEpi), v('eficEpi', a.eficEpi),
          ...(a.utilizEpi === 2 ? a.epis.map((ca) => g('epi', [v('docAval', corte(ca, 255))])) : []),
          a.utilizEpi === 2 && a.epiCompl ? g('epiCompl', [
            v('medProtecao', a.epiCompl.medProtecao), v('condFuncto', a.epiCompl.condFuncto), v('usoInint', a.epiCompl.usoInint),
            v('przValid', a.epiCompl.przValid), v('periodicTroca', a.epiCompl.periodicTroca), v('higienizacao', a.epiCompl.higienizacao),
          ]) : '',
        ]),
      ])),
      ...d.responsaveis.map((r) => g('respReg', [
        v('cpfResp', r.cpf),
        ...(semAgente ? [] : [v('ideOC', r.ideOc), v('dscOC', r.dscOc), v('nrOC', r.nrOc), v('ufOC', r.ufOc)]),
      ])),
      d.obsCompl ? g('obs', [v('obsCompl', corte(d.obsCompl, 999))]) : '',
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// S-2210
// ---------------------------------------------------------------------------
export interface DadosS2210 {
  id: string;
  ide: IdeEvento;
  empregador: IdeEmpregador;
  vinculo: IdeVinculo;
  dtAcid: string;
  tpAcid: 1 | 2 | 3;
  hrAcid: string | null;
  cat: Record<string, any>;
  atestado: Record<string, any>;
}

export function xmlS2210(d: DadosS2210): string {
  const c = d.cat;
  const a = d.atestado;
  const exterior = c.tpLocal === 2;
  return raiz('S-2210', 'evtCAT', d.id, [
    ideEvento(d.ide), ideEmpregador(d.empregador), ideVinculo(d.vinculo),
    g('cat', [
      v('dtAcid', d.dtAcid), v('tpAcid', d.tpAcid), v('hrAcid', d.tpAcid === 2 ? null : d.hrAcid),
      v('hrsTrabAntesAcid', d.tpAcid === 2 ? null : c.hrsTrabAntesAcid), v('tpCat', c.tpCat), v('indCatObito', c.indCatObito),
      v('dtObito', c.dtObito), v('indComunPolicia', c.indComunPolicia), v('codSitGeradora', c.codSitGeradora),
      v('iniciatCAT', c.iniciatCat), v('obsCAT', corte(c.obsCat, 999)), v('ultDiaTrab', c.ultDiaTrab), v('houveAfast', c.houveAfast),
      g('localAcidente', [
        v('tpLocal', c.tpLocal), v('dscLocal', corte(c.dscLocal, 255)), v('dscLograd', corte(c.dscLograd, 100)), v('nrLograd', corte(c.nrLograd, 10)),
        v('complemento', corte(c.complemento, 30)), v('bairro', corte(c.bairro, 90)), v('cep', exterior ? null : c.cep),
        v('codMunic', exterior ? null : c.codMunic), v('uf', exterior ? null : c.uf), v('pais', exterior ? c.pais : null),
        v('codPostal', exterior ? c.codPostal : null),
        c.localTpInsc ? g('ideLocalAcid', [v('tpInsc', c.localTpInsc), v('nrInsc', c.localNrInsc)]) : '',
      ]),
      g('parteAtingida', [v('codParteAting', c.codParteAting), v('lateralidade', c.lateralidade)]),
      g('agenteCausador', [v('codAgntCausador', c.codAgntCausador)]),
      g('atestado', [
        v('dtAtendimento', a.dtAtendimento), v('hrAtendimento', a.hrAtendimento), v('indInternacao', a.indInternacao), v('durTrat', a.durTrat),
        v('indAfast', a.indAfast), v('dscLesao', a.dscLesao), v('dscCompLesao', corte(a.dscCompLesao, 200)), v('diagProvavel', corte(a.diagProvavel, 100)),
        v('codCID', a.codCid), v('observacao', corte(a.observacao, 255)),
        g('emitente', [v('nmEmit', corte(a.nmEmit, 70)), v('ideOC', a.ideOcEmit), v('nrOC', a.nrOcEmit), v('ufOC', a.ufOcEmit)]),
      ]),
      c.nrRecCatOrig ? g('catOrigem', [v('nrRecCatOrig', c.nrRecCatOrig)]) : '',
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// S-3000
// ---------------------------------------------------------------------------
export interface DadosS3000 {
  id: string;
  tpAmb: 1 | 2;
  verProc: string;
  empregador: IdeEmpregador;
  tpEvento: string;
  nrRecEvt: string;
  cpfTrab: string;
}

export function xmlS3000(d: DadosS3000): string {
  return raiz('S-3000', 'evtExclusao', d.id, [
    g('ideEvento', [v('tpAmb', d.tpAmb), v('procEmi', 1), v('verProc', d.verProc)]),
    ideEmpregador(d.empregador),
    g('infoExclusao', [v('tpEvento', d.tpEvento), v('nrRecEvt', d.nrRecEvt), g('ideTrabalhador', [v('cpfTrab', d.cpfTrab)])]),
  ]);
}

// ---------------------------------------------------------------------------
// Lote, consulta e envelope SOAP
// ---------------------------------------------------------------------------
const semDeclaracao = (x: string) => x.replace(/^\s*<\?xml[^?]*\?>\s*/, '');

export function xmlLote(empregador: IdeEmpregador, transmissor: { tpInsc: number; nrInsc: string }, eventos: { id: string; xml: string }[]) {
  return `<eSocial xmlns="${NS_LOTE}"><envioLoteEventos grupo="2">`
    + g('ideEmpregador', [v('tpInsc', empregador.tpInsc), v('nrInsc', empregador.nrInsc)])
    + g('ideTransmissor', [v('tpInsc', transmissor.tpInsc), v('nrInsc', transmissor.nrInsc)])
    + `<eventos>${eventos.map((e) => `<evento Id="${esc(e.id)}">${semDeclaracao(e.xml)}</evento>`).join('')}</eventos>`
    + '</envioLoteEventos></eSocial>';
}

export const xmlConsulta = (protocolo: string) =>
  `<eSocial xmlns="${NS_CONSULTA}"><consultaLoteEventos>${v('protocoloEnvio', protocolo)}</consultaLoteEventos></eSocial>`;

export function envelope(operacao: 'envio' | 'consulta', corpo: string) {
  const ns = operacao === 'envio' ? NS_WS_ENVIO : NS_WS_CONSULTA;
  const [metodo, param] = operacao === 'envio' ? ['EnviarLoteEventos', 'loteEventos'] : ['ConsultarLoteEventos', 'consulta'];
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="${ns}">`
    + `<soapenv:Header/><soapenv:Body><v1:${metodo}><v1:${param}>${semDeclaracao(corpo)}</v1:${param}></v1:${metodo}></soapenv:Body>`
    + '</soapenv:Envelope>';
}

// ---------------------------------------------------------------------------
// Leitura dos retornos
// ---------------------------------------------------------------------------
export interface Ocorrencia { tipo: string | null; codigo: string | null; descricao: string | null; localizacao: string | null }

const filhos = (n: Node | null | undefined, nome: string): Element[] => {
  const r: Element[] = [];
  if (!n) return r;
  for (let c = n.firstChild; c; c = c.nextSibling) if ((c as Element).localName === nome) r.push(c as Element);
  return r;
};
const filho = (n: Node | null | undefined, ...caminho: string[]): Element | null => {
  let atual: Node | null | undefined = n;
  for (const p of caminho) atual = filhos(atual, p)[0];
  return (atual as Element) ?? null;
};
const texto = (n: Node | null | undefined, ...caminho: string[]) => {
  const e = filho(n, ...caminho);
  const t = e?.textContent?.trim();
  return t ? t : null;
};
/** Primeiro elemento com este nome local em qualquer profundidade. */
const buscar = (n: Node, nome: string): Element | null => {
  const todos = (n as any).getElementsByTagName ? (n as Document).getElementsByTagName('*') : null;
  if (!todos) return null;
  for (let i = 0; i < todos.length; i++) if (todos[i]!.localName === nome) return todos[i] as Element;
  return null;
};

function ler(xml: string): Document {
  const erros: string[] = [];
  const doc = new DOMParser({ onError: (nivel: string, m: string) => { if (nivel !== 'warning') erros.push(m); } } as any)
    .parseFromString(xml, 'text/xml');
  if (erros.length || !doc?.documentElement) throw new Error(`Resposta do eSocial em formato inesperado: ${erros[0] ?? 'vazia'}`);
  return doc as unknown as Document;
}

const lerOcorrencias = (n: Node | null): Ocorrencia[] =>
  filhos(filho(n, 'ocorrencias'), 'ocorrencia').map((o) => ({
    tipo: texto(o, 'tipo'), codigo: texto(o, 'codigo'), descricao: texto(o, 'descricao'), localizacao: texto(o, 'localizacao'),
  }));

/** Falha SOAP (soap:Fault) devolvida pelo servidor. */
export function falhaSoap(xml: string): string | null {
  try {
    const doc = ler(xml);
    const f = buscar(doc, 'Fault');
    if (!f) return null;
    return texto(f, 'faultstring') ?? f.textContent?.trim() ?? 'Falha SOAP';
  } catch {
    return null;
  }
}

export interface RetornoEnvio { cdResposta: number; descResposta: string; protocolo: string | null; ocorrencias: Ocorrencia[] }

export function lerRetornoEnvio(xml: string): RetornoEnvio {
  const doc = ler(xml);
  const r = buscar(doc, 'retornoEnvioLoteEventos');
  if (!r) throw new Error('Resposta do envio sem o retorno do lote');
  const status = filho(r, 'status');
  return {
    cdResposta: Number(texto(status, 'cdResposta')),
    descResposta: texto(status, 'descResposta') ?? '',
    protocolo: texto(r, 'dadosRecepcaoLote', 'protocoloEnvio'),
    ocorrencias: lerOcorrencias(status),
  };
}

export interface RetornoEventoLido {
  id: string;
  cdResposta: number | null;
  descResposta: string | null;
  nrRecibo: string | null;
  dhProcessamento: string | null;
  ocorrencias: Ocorrencia[];
  xml: string;
}
export interface RetornoConsulta {
  cdResposta: number;
  descResposta: string;
  ocorrencias: Ocorrencia[];
  eventos: RetornoEventoLido[];
}

export function lerRetornoConsulta(xml: string): RetornoConsulta {
  const doc = ler(xml);
  const r = buscar(doc, 'retornoProcessamentoLoteEventos');
  if (!r) throw new Error('Resposta da consulta sem o retorno do processamento');
  const status = filho(r, 'status');
  const eventos = filhos(filho(r, 'retornoEventos'), 'evento').map((ev) => {
    // evento > retornoEvento (envelope) > eSocial > retornoEvento (documento assinado pelo eSocial)
    const envelopeRet = filho(ev, 'retornoEvento');
    const ret = filho(envelopeRet, 'eSocial', 'retornoEvento') ?? envelopeRet;
    const proc = filho(ret, 'processamento');
    return {
      id: ev.getAttribute('Id') ?? '',
      cdResposta: texto(proc, 'cdResposta') ? Number(texto(proc, 'cdResposta')) : null,
      descResposta: texto(proc, 'descResposta'),
      nrRecibo: texto(ret, 'recibo', 'nrRecibo'),
      dhProcessamento: texto(proc, 'dhProcessamento'),
      ocorrencias: lerOcorrencias(proc),
      xml: (filho(envelopeRet, 'eSocial') ?? ev).toString(),
    };
  });
  return {
    cdResposta: Number(texto(status, 'cdResposta')),
    descResposta: texto(status, 'descResposta') ?? '',
    ocorrencias: lerOcorrencias(status),
    eventos,
  };
}
