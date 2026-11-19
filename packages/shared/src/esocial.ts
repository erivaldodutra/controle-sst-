import { z } from 'zod';
import { cpfValido, somenteDigitos } from './documentos';
import { UFS } from './saude';

/**
 * Fase 5: eSocial S-2210, S-2220, S-2240 e S-3000 (leiaute S-1.3).
 *
 * Regras que valem para todo o módulo:
 *   * nenhum evento é transmitido sem aprovação humana;
 *   * um evento só fica "processado" quando o eSocial devolve o número do recibo;
 *   * a produção só é liberada depois de lote aceito na produção restrita.
 */

export const AMBIENTES_ESOCIAL = { 1: 'Produção', 2: 'Produção restrita (testes)' } as const;
export type AmbienteEsocial = 1 | 2;

export const TIPOS_EVENTO_ESOCIAL = {
  'S-2210': 'Comunicação de acidente de trabalho (CAT)',
  'S-2220': 'Monitoramento da saúde do trabalhador (ASO)',
  'S-2240': 'Condições ambientais do trabalho (agentes nocivos)',
  'S-3000': 'Exclusão de evento',
} as const;
export type TipoEventoEsocial = keyof typeof TIPOS_EVENTO_ESOCIAL;

export const SITUACOES_EVENTO = {
  invalido: 'Com erros de validação',
  pendente: 'Aguardando aprovação',
  aprovado: 'Aprovado, aguardando envio',
  enviado: 'Enviado, aguardando retorno',
  processado: 'Processado (com recibo)',
  rejeitado: 'Rejeitado pelo eSocial',
  cancelado: 'Descartado',
  excluido: 'Excluído (S-3000)',
} as const;
export type SituacaoEvento = keyof typeof SITUACOES_EVENTO;

export const SITUACOES_LOTE = {
  enviando: 'Envio em andamento',
  aguardando: 'Enviado, aguardando retorno',
  processado: 'Processado',
  recusado: 'Recusado na recepção',
  rejeitado: 'Rejeitado no processamento',
  falha_comunicacao: 'Falha de comunicação',
} as const;
export type SituacaoLote = keyof typeof SITUACOES_LOTE;

/** Endereços oficiais (Manual de Orientação do Desenvolvedor eSocial v1.15). */
export const ENDERECOS_ESOCIAL: Record<AmbienteEsocial, { envio: string; consulta: string }> = {
  1: {
    envio: 'https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
    consulta: 'https://webservices.consulta.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
  },
  2: {
    envio: 'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
    consulta: 'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
  },
};

/** Máximo de eventos por lote (manual do desenvolvedor). */
export const MAX_EVENTOS_LOTE = 50;

// ---------------------------------------------------------------------------
// Identificação
// ---------------------------------------------------------------------------

/**
 * nrInsc do empregador nos eventos: raiz do CNPJ (8 dígitos), ou CNPJ completo para
 * órgão público da administração direta (natureza jurídica 1xxx), ou CPF.
 */
export function inscricaoEmpregador(tipo: 1 | 2, inscricao: string, naturezaJuridica?: string | null): string {
  const n = somenteDigitos(inscricao);
  if (tipo === 2) return n;
  return naturezaJuridica?.startsWith('1') ? n : n.slice(0, 8);
}

/**
 * Id do evento (REGRA_VALIDA_ID_EVENTO): "ID" + tipo de inscrição + inscrição com 14
 * posições (completada com zeros à direita) + AAAAMMDDHHMMSS + sequencial de 5 dígitos.
 */
export function idEvento(tipo: 1 | 2, nrInsc: string, quando: Date, sequencial: number): string {
  const p = (n: number, t = 2) => String(n).padStart(t, '0');
  const dh = `${quando.getFullYear()}${p(quando.getMonth() + 1)}${p(quando.getDate())}${p(quando.getHours())}${p(quando.getMinutes())}${p(quando.getSeconds())}`;
  const seq = ((sequencial - 1) % 99999) + 1;
  return `ID${tipo}${somenteDigitos(nrInsc).padEnd(14, '0')}${dh}${p(seq, 5)}`;
}

// ---------------------------------------------------------------------------
// Prazos de envio
// ---------------------------------------------------------------------------
const somarDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * Prazo legal de envio:
 *   S-2220 e S-2240: até o dia 15 do mês seguinte;
 *   S-2210: primeiro dia útil seguinte ao acidente (em caso de óbito, imediato).
 * Feriados não são considerados: o prazo calculado pode ser um pouco mais curto que o real.
 */
export function prazoEvento(tipo: TipoEventoEsocial, referencia: string, obito = false): string | null {
  if (tipo === 'S-2220' || tipo === 'S-2240') {
    const [a, m] = referencia.split('-').map(Number) as [number, number];
    const ano = m === 12 ? a + 1 : a;
    const mes = m === 12 ? 1 : m + 1;
    return `${ano}-${String(mes).padStart(2, '0')}-15`;
  }
  if (tipo === 'S-2210') {
    if (obito) return referencia;
    let d = somarDias(referencia, 1);
    for (let dia = new Date(`${d}T12:00:00Z`).getUTCDay(); dia === 0 || dia === 6; dia = new Date(`${d}T12:00:00Z`).getUTCDay())
      d = somarDias(d, 1);
    return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const dataOpcional = data.optional().nullable().transform((v) => v ?? null);
const texto = (max: number) => z.string().trim().min(1, 'Obrigatório').max(max);
const textoOpcional = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const sn = z.enum(['S', 'N']);
const snOpcional = sn.optional().nullable().transform((v) => v ?? null);
const hhmm = (max: number) => z.string().regex(/^\d{4}$/, 'Use o formato HHMM').refine((v) => Number(v.slice(2)) <= 59 && Number(v) <= max, 'Hora inválida');

export const configEsocialSchema = z.object({
  ambiente: z.union([z.literal(1), z.literal(2)]),
  inicioObrigatoriedade: dataOpcional,
  /** Quem transmite: a própria empresa ou um procurador (CNPJ/CPF do certificado). */
  transmissorTipo: z.union([z.literal(1), z.literal(2)]),
  transmissorInscricao: z.string().transform(somenteDigitos).refine((v) => v.length === 11 || v.length === 14, 'CNPJ ou CPF do transmissor'),
});
export type ConfigEsocialInput = z.infer<typeof configEsocialSchema>;

// ---------------------------------------------------------------------------
// S-2240: agentes nocivos por GHE e responsáveis pelos registros ambientais
// ---------------------------------------------------------------------------
export const SEM_AGENTE_NOCIVO = '09.01.001';
/** dscAgNoc obrigatório para estes códigos. */
export const AGENTES_EXIGEM_DESCRICAO = [
  '01.01.001', '01.02.001', '01.03.001', '01.04.001', '01.05.001', '01.06.001', '01.07.001', '01.08.001', '01.09.001',
  '01.10.001', '01.12.001', '01.13.001', '01.14.001', '01.15.001', '01.16.001', '01.17.001', '01.18.001', '05.01.001',
];
/** limTol obrigatório (quando quantitativo) para estes códigos. */
export const AGENTES_LIMITE_TOLERANCIA = ['01.18.001', '02.01.014'];

export const TIPOS_AVALIACAO = { 1: 'Quantitativa', 2: 'Qualitativa' } as const;
export const UTILIZACAO_EPC = { 0: 'Não se aplica', 1: 'Não implementa', 2: 'Implementa' } as const;
export const UTILIZACAO_EPI = { 0: 'Não se aplica', 1: 'Não utilizado', 2: 'Utilizado' } as const;
export const UNIDADES_MEDIDA: Record<number, string> = {
  1: 'dose diária de ruído', 2: 'dB (linear)', 3: 'dB(C)', 4: 'dB(A)', 5: 'm/s²', 6: 'm/s^1,75', 7: 'ppm', 8: 'mg/m³',
  9: 'f/cm³', 10: 'ºC', 11: 'm/s', 12: '%', 13: 'lux', 14: 'ufc/m³', 15: 'dose diária', 16: 'dose mensal', 17: 'dose trimestral',
  18: 'dose anual', 19: 'W/m²', 20: 'A/m', 21: 'mT', 22: 'μT', 23: 'mA', 24: 'kV/m', 25: 'V/m', 26: 'J/m²', 27: 'mJ/cm²',
  28: 'mSv', 29: 'mppdc', 30: 'UR (%)',
};
export const REQUISITOS_EPI = {
  medProtecao: 'Tentou-se antes medidas de proteção coletiva, administrativas ou de organização',
  condFuncto: 'Condições de funcionamento do EPI observadas ao longo do tempo',
  usoInint: 'Uso ininterrupto do EPI observado',
  przValid: 'Prazo de validade do CA observado na compra',
  periodicTroca: 'Periodicidade de troca observada (com recibo assinado)',
  higienizacao: 'Higienização conforme orientação do fabricante',
} as const;

const numeroOpcional = z.union([z.number(), z.string()]).optional().nullable()
  .transform((v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.'))))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e10), 'Número inválido');

export const agenteNocivoSchema = z.object({
  gheId: z.string().uuid(),
  codigo: z.string().trim().regex(/^\d{2}\.\d{2}\.\d{3}$/, 'Código da Tabela 24 (ex.: 02.01.001)'),
  descricao: textoOpcional(100),
  tpAval: z.union([z.literal(1), z.literal(2)]).optional().nullable().transform((v) => v ?? null),
  intConc: numeroOpcional,
  limTol: numeroOpcional,
  unMed: z.number().int().min(1).max(30).optional().nullable().transform((v) => v ?? null),
  tecMedicao: textoOpcional(40),
  nrProcJud: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null))
    .refine((v) => v === null || [17, 20, 21].includes(v.length), 'Número do processo com 17, 20 ou 21 dígitos'),
  utilizEpc: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().nullable().transform((v) => v ?? null),
  eficEpc: snOpcional,
  utilizEpi: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().nullable().transform((v) => v ?? null),
  eficEpi: snOpcional,
  epis: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  epiCompl: z.object({
    medProtecao: sn, condFuncto: sn, usoInint: sn, przValid: sn, periodicTroca: sn, higienizacao: sn,
  }).optional().nullable().transform((v) => v ?? null),
  inicio: data,
  fim: dataOpcional,
}).superRefine((a, ctx) => {
  for (const p of problemasAgente(a)) ctx.addIssue({ code: 'custom', path: [p.campo], message: p.mensagem });
});
export type AgenteNocivoInput = z.infer<typeof agenteNocivoSchema>;

type Agente = Omit<AgenteNocivoInput, 'gheId'>;

/** Regras de preenchimento do grupo agNoc do S-2240 (leiaute S-1.3). */
export function problemasAgente(a: Agente, dtIniCondicao?: string): { campo: string; mensagem: string }[] {
  const r: { campo: string; mensagem: string }[] = [];
  const add = (campo: string, mensagem: string) => r.push({ campo, mensagem });
  if (a.fim && a.fim < a.inicio) add('fim', 'O fim deve ser igual ou posterior ao início');
  if (a.codigo === SEM_AGENTE_NOCIVO) {
    if (a.tpAval !== null) add('tpAval', 'Sem agente nocivo (09.01.001) não leva tipo de avaliação');
    if (a.utilizEpc !== null || a.utilizEpi !== null) add('utilizEpi', 'Sem agente nocivo (09.01.001) não leva EPC/EPI');
    if (a.descricao && (dtIniCondicao ?? a.inicio) >= '2024-04-22') add('descricao', 'Sem agente nocivo (09.01.001) não leva descrição');
    return r;
  }
  if (AGENTES_EXIGEM_DESCRICAO.includes(a.codigo) && !a.descricao) add('descricao', 'Descreva o agente (obrigatório para este código)');
  if (a.tpAval === null) add('tpAval', 'Informe o tipo de avaliação');
  if (a.tpAval === 1) {
    if (a.intConc === null) add('intConc', 'Avaliação quantitativa: informe a intensidade ou concentração');
    if (a.unMed === null) add('unMed', 'Avaliação quantitativa: informe a unidade de medida');
    if (!a.tecMedicao) add('tecMedicao', 'Avaliação quantitativa: informe a técnica de medição');
    if (AGENTES_LIMITE_TOLERANCIA.includes(a.codigo) && a.limTol === null) add('limTol', 'Informe o limite de tolerância (obrigatório para este código)');
  } else {
    if (a.intConc !== null || a.unMed !== null || a.tecMedicao) add('intConc', 'Intensidade, unidade e técnica só para avaliação quantitativa');
  }
  if (a.limTol !== null && !(a.tpAval === 1 && AGENTES_LIMITE_TOLERANCIA.includes(a.codigo)))
    add('limTol', 'Limite de tolerância só para avaliação quantitativa dos códigos 01.18.001 e 02.01.014');
  if (a.codigo === '05.01.001' && !a.nrProcJud && (dtIniCondicao ?? a.inicio) >= '2024-01-22')
    add('nrProcJud', 'Informe o número do processo (agente incluído por determinação administrativa ou judicial)');
  if (a.codigo !== '05.01.001' && a.nrProcJud) add('nrProcJud', 'Número do processo só para o código 05.01.001');
  if (a.utilizEpc === null) add('utilizEpc', 'Informe se há EPC');
  if (a.utilizEpi === null) add('utilizEpi', 'Informe se há EPI');
  if ((a.utilizEpc === 2) !== (a.eficEpc !== null)) add('eficEpc', a.utilizEpc === 2 ? 'Informe se o EPC é eficaz' : 'Eficácia do EPC só quando implementa EPC');
  if ((a.utilizEpi === 2) !== (a.eficEpi !== null)) add('eficEpi', a.utilizEpi === 2 ? 'Informe se o EPI é eficaz' : 'Eficácia do EPI só quando utiliza EPI');
  if (a.utilizEpi === 2) {
    if (!a.epis.length) add('epis', 'Informe o CA (ou documento de avaliação) de pelo menos um EPI');
    if (!a.epiCompl) add('epiCompl', 'Responda os requisitos da NR-06 e NR-09 para o EPI');
  } else if (a.epis.length || a.epiCompl) add('epis', 'EPIs e requisitos só quando o EPI é utilizado');
  return r;
}

/** Conjunto de agentes de um trabalhador: 09.01.001 não pode vir com outro código. */
export function problemasConjuntoAgentes(codigos: string[]): string | null {
  if (!codigos.length) return 'Nenhum agente cadastrado para o GHE. Se não há exposição, cadastre o código 09.01.001.';
  if (codigos.includes(SEM_AGENTE_NOCIVO) && codigos.length > 1) return 'O código 09.01.001 (ausência de agente nocivo) não pode vir junto com outros agentes.';
  if (new Set(codigos).size !== codigos.length) return 'Agente nocivo repetido no mesmo GHE.';
  return null;
}

export const ORGAOS_CLASSE_AMBIENTAL = { 1: 'CRM', 4: 'CREA', 9: 'Outro' } as const;

export const responsavelAmbientalSchema = z.object({
  empresaId: z.string().uuid(),
  nome: texto(200),
  cpf: z.string().transform(somenteDigitos).refine(cpfValido, 'CPF inválido'),
  ideOc: z.union([z.literal(1), z.literal(4), z.literal(9)]),
  dscOc: textoOpcional(20),
  nrOc: texto(14),
  ufOc: z.enum(UFS, { message: 'UF inválida' }),
  inicio: data,
  fim: dataOpcional,
}).superRefine((v, ctx) => {
  if ((v.ideOc === 9) !== !!v.dscOc)
    ctx.addIssue({ code: 'custom', path: ['dscOc'], message: v.ideOc === 9 ? 'Informe a sigla do órgão de classe' : 'Sigla só para "Outro" órgão' });
  if (v.fim && v.fim < v.inicio) ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O fim deve ser igual ou posterior ao início' });
});

export const preparoS2240Schema = z.object({
  vinculoId: z.string().uuid(),
  /** Início das condições informadas (padrão: início da lotação atual ou da obrigatoriedade). */
  dtIniCondicao: dataOpcional,
  observacao: textoOpcional(999),
});

// ---------------------------------------------------------------------------
// S-2210: dados da CAT
// ---------------------------------------------------------------------------
export const TIPOS_CAT = { 1: 'Inicial', 2: 'Reabertura', 3: 'Comunicação de óbito' } as const;
export const INICIATIVAS_CAT = { 1: 'Empregador', 2: 'Ordem judicial', 3: 'Determinação de órgão fiscalizador' } as const;
export const TIPOS_LOCAL_ACIDENTE = {
  1: 'Estabelecimento do empregador no Brasil', 2: 'Estabelecimento do empregador no exterior',
  3: 'Estabelecimento de terceiros onde presta serviços', 4: 'Via pública', 5: 'Área rural', 6: 'Embarcação', 9: 'Outros',
} as const;
export const LATERALIDADES = { 0: 'Não aplicável', 1: 'Esquerda', 2: 'Direita', 3: 'Ambas' } as const;
export const ORGAOS_EMITENTE_ATESTADO = { 1: 'CRM', 2: 'CRO', 3: 'RMS' } as const;

/** tpAcid a partir do tipo da ocorrência. */
export const TIPO_ACIDENTE_OCORRENCIA: Record<string, 1 | 2 | 3> = { acidente_tipico: 1, doenca_ocupacional: 2, acidente_trajeto: 3 };

const codigoTabela = (rotulo: string) => z.string().trim().regex(/^\d{9}$/, `${rotulo}: código de 9 dígitos`);

/** Dados do acidente (sem informação clínica). Data, hora e tipo vêm da ocorrência. */
export const catSchema = z.object({
  vinculoId: z.string().uuid(),
  tpCat: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  nrRecCatOrig: z.string().trim().optional().nullable().transform((v) => v || null)
    .refine((v) => v === null || reciboValido(v), 'Recibo no formato 1.X.NNNNNNNNNNNNNNNNNNN (23 caracteres)'),
  hrsTrabAntesAcid: hhmm(9959).optional().nullable().transform((v) => v ?? null),
  indCatObito: sn,
  dtObito: dataOpcional,
  indComunPolicia: sn,
  codSitGeradora: codigoTabela('Situação geradora (Tabela 15)'),
  iniciatCat: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  obsCat: textoOpcional(999),
  ultDiaTrab: dataOpcional,
  tpLocal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(9)]),
  dscLocal: textoOpcional(255),
  dscLograd: texto(100),
  nrLograd: texto(10),
  complemento: textoOpcional(30),
  bairro: textoOpcional(90),
  cep: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null)).refine((v) => v === null || v.length === 8, 'CEP com 8 dígitos'),
  codMunic: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null)).refine((v) => v === null || v.length === 7, 'Código IBGE do município com 7 dígitos'),
  uf: z.enum(UFS).optional().nullable().transform((v) => v ?? null),
  pais: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null)).refine((v) => v === null || v.length === 3, 'Código do país (Tabela 06) com 3 dígitos'),
  codPostal: textoOpcional(12),
  localTpInsc: z.union([z.literal(1), z.literal(3), z.literal(4)]).optional().nullable().transform((v) => v ?? null),
  localNrInsc: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null)),
  codParteAting: codigoTabela('Parte atingida (Tabela 13)'),
  lateralidade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  codAgntCausador: codigoTabela('Agente causador (Tabela 14 ou 15)'),
}).superRefine((v, ctx) => {
  const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.tpCat === 3 && v.indCatObito !== 'S') add('indCatObito', 'CAT de óbito: houve óbito deve ser "Sim"');
  if (v.tpCat === 2 && v.indCatObito !== 'N') add('indCatObito', 'CAT de reabertura: houve óbito deve ser "Não"');
  if ((v.indCatObito === 'S') !== !!v.dtObito) add('dtObito', v.indCatObito === 'S' ? 'Informe a data do óbito' : 'Data do óbito só quando houve óbito');
  if (v.tpCat === 2 && !v.nrRecCatOrig) add('nrRecCatOrig', 'Reabertura: informe o recibo da CAT anterior');
  if (v.tpCat === 1 && v.nrRecCatOrig) add('nrRecCatOrig', 'CAT inicial não leva recibo de CAT anterior');
  const brasil = v.tpLocal !== 2;
  if ([1, 3, 5].includes(v.tpLocal) && !v.cep) add('cep', 'Informe o CEP');
  if (!brasil && v.cep) add('cep', 'Exterior: não informe CEP');
  if (brasil && v.tpLocal !== 6 && v.tpLocal !== 9 && (!v.codMunic || !v.uf)) add('codMunic', 'Informe o município (código IBGE) e a UF');
  if (!brasil && (v.codMunic || v.uf)) add('codMunic', 'Exterior: não informe município e UF');
  if (!brasil && (!v.pais || !v.codPostal)) add('pais', 'Exterior: informe o país e o código postal');
  if (brasil && (v.pais || v.codPostal)) add('pais', 'País e código postal só para acidente no exterior');
  if ((v.localTpInsc === null) !== (v.localNrInsc === null)) add('localNrInsc', 'Informe tipo e número de inscrição do local, ou nenhum dos dois');
  if (v.localNrInsc && v.localTpInsc && v.localNrInsc.length !== (v.localTpInsc === 4 ? 12 : 14))
    add('localNrInsc', 'Número de inscrição do local incompatível com o tipo');
  if ([1, 3].includes(v.tpLocal) && !v.localTpInsc) add('localTpInsc', 'Informe a inscrição do estabelecimento onde ocorreu o acidente');
});
export type CatInput = z.infer<typeof catSchema>;

/** Atestado médico da CAT: contém CID e diagnóstico (dado sensível de saúde). */
export const atestadoCatSchema = z.object({
  dtAtendimento: data,
  hrAtendimento: hhmm(2359),
  indInternacao: sn,
  durTrat: z.number().int().min(0).max(9999),
  indAfast: sn,
  dscLesao: codigoTabela('Natureza da lesão (Tabela 17)'),
  dscCompLesao: textoOpcional(200),
  diagProvavel: textoOpcional(100),
  codCid: z.string().trim().toUpperCase().regex(/^[A-Z]\d{2,3}$/, 'CID no formato A000 (letra e 2 ou 3 números, sem ponto)'),
  observacao: textoOpcional(255),
  nmEmit: texto(70),
  ideOcEmit: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  nrOcEmit: texto(14),
  ufOcEmit: z.enum(UFS).optional().nullable().transform((v) => v ?? null),
}).superRefine((v, ctx) => {
  if (v.ideOcEmit !== 3 && !v.ufOcEmit) ctx.addIssue({ code: 'custom', path: ['ufOcEmit'], message: 'Informe a UF do conselho' });
});
export type AtestadoCatInput = z.infer<typeof atestadoCatSchema>;

/** Regras da CAT que dependem da data do acidente e do tipo (vêm da ocorrência). */
export function problemasCat(c: CatInput, a: AtestadoCatInput | null, o: { dtAcid: string; tpAcid: 1 | 2 | 3; hoje: string; dataAdmissao: string }): string[] {
  const r: string[] = [];
  if (o.dtAcid > o.hoje) r.push('A data do acidente não pode ser futura.');
  if (o.dtAcid < o.dataAdmissao) r.push('A data do acidente é anterior à admissão do trabalhador.');
  if (o.tpAcid === 2 && c.hrsTrabAntesAcid) r.push('Doença ocupacional não leva horas trabalhadas antes do acidente.');
  const exigeHoras = o.tpAcid === 1 || (o.tpAcid === 3 && o.dtAcid >= '2022-07-20');
  if (exigeHoras && !c.hrsTrabAntesAcid) r.push('Informe as horas trabalhadas antes do acidente (HHMM).');
  if (o.dtAcid >= '2023-01-16' && !c.ultDiaTrab) r.push('Informe o último dia trabalhado.');
  if (c.ultDiaTrab && (c.ultDiaTrab > o.hoje || c.ultDiaTrab < o.dataAdmissao)) r.push('Último dia trabalhado fora do período do vínculo.');
  if (c.dtObito && (c.dtObito < o.dtAcid || c.dtObito > o.hoje)) r.push('A data do óbito deve ficar entre o acidente e hoje.');
  if (!a) r.push('Falta o atestado médico (preenchido por quem tem acesso a dados clínicos).');
  else {
    if (a.dtAtendimento < o.dtAcid || a.dtAtendimento > o.hoje) r.push('A data do atendimento deve ficar entre o acidente e hoje.');
    if (c.indCatObito === 'S' && a.indAfast !== 'N') r.push('Com óbito, o indicativo de afastamento no atestado deve ser "Não".');
  }
  return r;
}

/** Recibo do eSocial (TS_nrRecibo): números e pontos. */
export const reciboValido = (v: string) => /^1\.\d\.\d{19}$/.test(v);
