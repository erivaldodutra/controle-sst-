import { z } from 'zod';
import { diasEntre, type SituacaoDocumento } from './programas';

/**
 * Fase 4: planos de ação, inspeções, ocorrências e matriz de conformidade.
 * A aplicabilidade de um requisito é sempre decidida pelo profissional; os critérios
 * cadastrados no requisito só geram uma sugestão para a triagem.
 */

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------
export const ORIGENS_ACAO = {
  pgr: 'PGR', pgrtr: 'PGRTR', pcmso: 'PCMSO', aep: 'AEP', aet: 'AET', pca: 'PCA', ppr: 'PPR', cipa: 'CIPA',
  inspecao: 'Inspeção', auditoria: 'Auditoria', acidente: 'Acidente ou ocorrência', investigacao: 'Investigação de acidente',
  recomendacao: 'Recomendação técnica', conformidade: 'Matriz de conformidade', outra: 'Outra',
} as const;
export type OrigemAcao = keyof typeof ORIGENS_ACAO;

export const TIPOS_ACAO = { introduzir: 'Introduzir', aprimorar: 'Aprimorar', manter: 'Manter' } as const;
export const PRIORIDADES = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' } as const;
export type Prioridade = keyof typeof PRIORIDADES;

export const SITUACOES_ACAO = {
  nao_iniciada: 'Não iniciada',
  em_andamento: 'Em andamento',
  aguardando_evidencia: 'Aguardando evidência',
  em_validacao: 'Em validação',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
} as const;
export type SituacaoAcao = keyof typeof SITUACOES_ACAO;
export const SITUACOES_ACAO_ABERTA: SituacaoAcao[] = ['nao_iniciada', 'em_andamento', 'aguardando_evidencia', 'em_validacao'];

/**
 * Mudanças de situação feitas pelo responsável (acoes.editar).
 * Concluir só pela validação (acoes.validar), a partir de "em validação".
 * Cancelar é possível em qualquer situação aberta, com motivo.
 */
export const TRANSICOES_ACAO: Record<SituacaoAcao, SituacaoAcao[]> = {
  nao_iniciada: ['em_andamento', 'aguardando_evidencia', 'em_validacao'],
  em_andamento: ['aguardando_evidencia', 'em_validacao'],
  aguardando_evidencia: ['em_andamento', 'em_validacao'],
  em_validacao: [],
  concluida: [],
  cancelada: [],
};

export const TIPOS_EVIDENCIA = {
  foto: 'Foto', documento: 'Documento', certificado: 'Certificado', lista_presenca: 'Lista de presença',
  comprovante: 'Comprovante de compra ou serviço', outro: 'Outro',
} as const;

export const EVENTOS_ACAO = {
  aberta: 'Abertura', editada: 'Edição', situacao: 'Situação', reprogramada: 'Reprogramação', evidencia: 'Evidência',
  dispensa: 'Dispensa de evidência', devolvida: 'Devolvida', concluida: 'Concluída', cancelada: 'Cancelada', comentario: 'Comentário',
} as const;

const texto = (max: number) => z.string().trim().min(1, 'Obrigatório').max(max);
const textoOpcional = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const dataOpcional = data.optional().nullable().transform((v) => v ?? null);
const idOpcional = z.string().uuid().optional().nullable().transform((v) => v ?? null);

const camposAcao = {
  estabelecimentoId: idOpcional,
  setorId: idOpcional,
  gheId: idOpcional,
  perigo: textoOpcional(2000),
  descricao: texto(5000),
  justificativa: textoOpcional(5000),
  tipo: z.enum(['introduzir', 'aprimorar', 'manter']),
  prioridade: z.enum(['baixa', 'media', 'alta', 'urgente']),
  responsavelNome: texto(200),
  validadorNome: textoOpcional(200),
  recursos: textoOpcional(2000),
  formaAcompanhamento: textoOpcional(2000),
};

export const acaoSchema = z
  .object({
    empresaId: z.string().uuid(),
    origem: z.enum(Object.keys(ORIGENS_ACAO) as [OrigemAcao, ...OrigemAcao[]]),
    documentoId: idOpcional,
    inspecaoItemId: idOpcional,
    ocorrenciaId: idOpcional,
    conformidadeId: idOpcional,
    ...camposAcao,
    dataAbertura: data,
    prazo: data,
    exigeEvidencia: z.boolean().default(true),
    dispensaJustificativa: textoOpcional(2000),
  })
  .superRefine((v, c) => {
    if (v.prazo < v.dataAbertura) c.addIssue({ code: 'custom', path: ['prazo'], message: 'O prazo não pode ser antes da abertura' });
    if (!v.exigeEvidencia && !v.dispensaJustificativa)
      c.addIssue({ code: 'custom', path: ['dispensaJustificativa'], message: 'Justifique por que a ação dispensa evidência' });
  });
export type AcaoInput = z.infer<typeof acaoSchema>;

/** Edição dos dados descritivos. Prazo muda só por reprogramação; situação, pelo fluxo. */
export const acaoEdicaoSchema = z.object(camposAcao);

export const reprogramacaoSchema = z.object({ prazo: data, justificativa: texto(2000) });
export const situacaoAcaoSchema = z.object({
  situacao: z.enum(['em_andamento', 'aguardando_evidencia', 'em_validacao']),
  comentario: textoOpcional(2000),
});
export const validacaoAcaoSchema = z.object({ data, validadorNome: texto(200), parecer: textoOpcional(2000) });
export const devolucaoAcaoSchema = z.object({ motivo: texto(2000) });
export const cancelamentoAcaoSchema = z.object({ data, motivo: texto(2000) });
export const dispensaEvidenciaSchema = z
  .object({ dispensar: z.boolean(), justificativa: textoOpcional(2000) })
  .refine((v) => !v.dispensar || !!v.justificativa, { message: 'Justifique a dispensa de evidência', path: ['justificativa'] });
export const evidenciaSchema = z.object({
  tipo: z.enum(Object.keys(TIPOS_EVIDENCIA) as [keyof typeof TIPOS_EVIDENCIA, ...(keyof typeof TIPOS_EVIDENCIA)[]]),
  descricao: texto(500),
  data,
});
export const comentarioSchema = z.object({ texto: texto(2000) });

export type EstadoPrazoAcao = 'em_dia' | 'proximo' | 'atrasado' | 'encerrada';

/** Situação do prazo de uma ação. janela = dias de antecedência para "próximo". */
export function prazoAcao(a: { situacao: SituacaoAcao; prazo: string; prazoInicial: string }, hoje: string, janela: number) {
  const dias = diasEntre(hoje, a.prazo);
  const aberta = SITUACOES_ACAO_ABERTA.includes(a.situacao);
  const estado: EstadoPrazoAcao = !aberta ? 'encerrada' : dias < 0 ? 'atrasado' : dias <= janela ? 'proximo' : 'em_dia';
  return { dias, estado, atrasada: estado === 'atrasado', reprogramada: a.prazo !== a.prazoInicial };
}

// ---------------------------------------------------------------------------
// Inspeções e ocorrências
// ---------------------------------------------------------------------------
export const TIPOS_INSPECAO = {
  rotina: 'Rotina', cipa: 'CIPA', auditoria: 'Auditoria interna', especifica: 'Específica (atividade ou equipamento)', outra: 'Outra',
} as const;
export const RESULTADOS_ITEM = { conforme: 'Conforme', nao_conforme: 'Não conforme', nao_aplicavel: 'Não se aplica' } as const;

export const inspecaoSchema = z.object({
  empresaId: z.string().uuid(),
  estabelecimentoId: z.string().uuid(),
  setorId: idOpcional,
  data,
  tipo: z.enum(['rotina', 'cipa', 'auditoria', 'especifica', 'outra']),
  responsavelNome: texto(200),
  escopo: textoOpcional(5000),
});
export const inspecaoEdicaoSchema = inspecaoSchema.omit({ empresaId: true });
export const inspecaoItemSchema = z.object({
  descricao: texto(2000),
  resultado: z.enum(['conforme', 'nao_conforme', 'nao_aplicavel']),
  observacao: textoOpcional(5000),
  setorId: idOpcional,
});
export const conclusaoInspecaoSchema = z.object({ data, conclusao: texto(5000) });

export const TIPOS_OCORRENCIA = {
  acidente_tipico: 'Acidente típico', acidente_trajeto: 'Acidente de trajeto', doenca_ocupacional: 'Doença ocupacional',
  incidente: 'Incidente', quase_acidente: 'Quase acidente', outro: 'Outro',
} as const;
export const GRAVIDADES = { sem_lesao: 'Sem lesão', leve: 'Leve', moderada: 'Moderada', grave: 'Grave', fatal: 'Fatal' } as const;
export const SITUACOES_OCORRENCIA = { aberta: 'Aberta', em_investigacao: 'Em investigação', encerrada: 'Encerrada' } as const;

export const ocorrenciaSchema = z.object({
  empresaId: z.string().uuid(),
  estabelecimentoId: z.string().uuid(),
  setorId: idOpcional,
  funcionarioId: idOpcional,
  dataHora: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data e hora no formato AAAA-MM-DDTHH:MM'),
  tipo: z.enum(['acidente_tipico', 'acidente_trajeto', 'doenca_ocupacional', 'incidente', 'quase_acidente', 'outro']),
  gravidade: z.enum(['sem_lesao', 'leve', 'moderada', 'grave', 'fatal']),
  local: textoOpcional(500),
  descricao: texto(5000),
  medidasImediatas: textoOpcional(5000),
  houveAfastamento: z.boolean().default(false),
});
export const ocorrenciaEdicaoSchema = ocorrenciaSchema.omit({ empresaId: true });
export const investigacaoSchema = z.object({
  investigacao: texto(10000),
  responsavel: texto(200),
  concluidaEm: dataOpcional,
});
export const encerramentoOcorrenciaSchema = z.object({ data });

// ---------------------------------------------------------------------------
// Matriz de conformidade
// ---------------------------------------------------------------------------
export const AVALIACOES_CONFORMIDADE = {
  nao_avaliado: 'Não avaliado', conforme: 'Conforme', parcial: 'Parcialmente conforme', nao_conforme: 'Não conforme',
} as const;
export type AvaliacaoConformidade = keyof typeof AVALIACOES_CONFORMIDADE;

export const SITUACOES_CONFORMIDADE = {
  conforme: 'Conforme',
  parcial: 'Parcialmente conforme',
  nao_conforme: 'Não conforme',
  nao_avaliado: 'Não avaliado',
  a_avaliar: 'Aplicabilidade a avaliar',
  nao_aplicavel: 'Não aplicável',
} as const;
export type SituacaoConformidade = keyof typeof SITUACOES_CONFORMIDADE;

export const requisitoSchema = z.object({
  titulo: texto(300),
  fundamentacao: textoOpcional(1000),
  descricao: textoOpcional(5000),
  documentoTipoId: idOpcional,
  sugestaoGrausRisco: z.array(z.number().int().min(1).max(4)).max(4).default([]),
  sugestaoCnaePrefixos: z
    .array(z.string().trim().regex(/^\d{2,7}$/, 'Prefixo de CNAE com 2 a 7 dígitos'))
    .max(50)
    .default([]),
  sugestaoMinEmpregados: z.number().int().min(1).optional().nullable().transform((v) => v ?? null),
  ativo: z.boolean().default(true),
});
export type RequisitoInput = z.infer<typeof requisitoSchema>;

export const conformidadeSchema = z
  .object({
    empresaId: z.string().uuid(),
    estabelecimentoId: idOpcional,
    requisitoId: z.string().uuid(),
    aplicabilidade: z.enum(['a_avaliar', 'aplicavel', 'nao_aplicavel']),
    justificativa: textoOpcional(2000),
    avaliacao: z.enum(['nao_avaliado', 'conforme', 'parcial', 'nao_conforme']).default('nao_avaliado'),
    avaliacaoEm: dataOpcional,
    responsavelNome: textoOpcional(200),
    pendencias: textoOpcional(5000),
    prazo: dataOpcional,
    observacoes: textoOpcional(5000),
  })
  .superRefine((v, c) => {
    if (v.aplicabilidade === 'nao_aplicavel' && !v.justificativa)
      c.addIssue({ code: 'custom', path: ['justificativa'], message: 'Justifique por que o requisito não se aplica' });
    if (v.avaliacao !== 'nao_avaliado' && !v.avaliacaoEm)
      c.addIssue({ code: 'custom', path: ['avaliacaoEm'], message: 'Informe a data da avaliação' });
  });
export type ConformidadeInput = z.infer<typeof conformidadeSchema>;

/** Sugestão de aplicabilidade pelos critérios do requisito. null = requisito sem critérios. Nunca decide. */
export function sugerirAplicabilidade(
  r: { sugestaoGrausRisco: number[]; sugestaoCnaePrefixos: string[]; sugestaoMinEmpregados: number | null },
  e: { grauRisco: number | null; cnaes: string[]; empregados: number },
): { sugere: boolean; motivos: string[] } | null {
  const motivos: string[] = [];
  let sugere = true;
  let tem = false;
  if (r.sugestaoGrausRisco.length) {
    tem = true;
    const ok = e.grauRisco != null && r.sugestaoGrausRisco.includes(e.grauRisco);
    sugere &&= ok;
    motivos.push(e.grauRisco == null ? 'Grau de risco da empresa não informado'
      : `Grau de risco ${e.grauRisco} ${ok ? 'está' : 'não está'} entre ${r.sugestaoGrausRisco.join(', ')}`);
  }
  if (r.sugestaoCnaePrefixos.length) {
    tem = true;
    const achou = e.cnaes.find((c) => r.sugestaoCnaePrefixos.some((p) => c.replace(/\D/g, '').startsWith(p)));
    sugere &&= !!achou;
    motivos.push(achou ? `CNAE ${achou} corresponde ao critério` : 'Nenhum CNAE da empresa corresponde ao critério');
  }
  if (r.sugestaoMinEmpregados) {
    tem = true;
    const ok = e.empregados >= r.sugestaoMinEmpregados;
    sugere &&= ok;
    motivos.push(`${e.empregados} empregado(s) ativos ${ok ? '≥' : '<'} ${r.sugestaoMinEmpregados}`);
  }
  return tem ? { sugere, motivos } : null;
}

const CONFORMA: SituacaoDocumento[] = ['regular', 'proximo_revisao', 'proximo_vencimento', 'em_revisao'];

/**
 * Situação de um requisito numa empresa.
 * Com tipo de documento vinculado: vem dos documentos (o pior deles, sem contar substituídos ou não aplicáveis).
 * Sem documento: vem da avaliação registrada pelo profissional.
 */
export function situacaoConformidade(e: {
  aplicabilidade: 'a_avaliar' | 'aplicavel' | 'nao_aplicavel';
  porDocumento: boolean;
  documentos: SituacaoDocumento[];
  avaliacao: AvaliacaoConformidade;
}): { situacao: SituacaoConformidade; motivo: string | null; proximo: boolean } {
  if (e.aplicabilidade === 'nao_aplicavel') return { situacao: 'nao_aplicavel', motivo: null, proximo: false };
  if (e.aplicabilidade === 'a_avaliar') return { situacao: 'a_avaliar', motivo: 'Aplicabilidade ainda não avaliada', proximo: false };
  if (!e.porDocumento) return { situacao: e.avaliacao, motivo: e.avaliacao === 'nao_avaliado' ? 'Ainda não avaliado' : null, proximo: false };
  const docs = e.documentos.filter((s) => s !== 'substituido' && s !== 'nao_aplicavel');
  if (!docs.length) return { situacao: 'nao_conforme', motivo: 'Nenhum documento cadastrado', proximo: false };
  const ruim = docs.find((s) => !CONFORMA.includes(s));
  if (ruim) {
    const rot: Partial<Record<SituacaoDocumento, string>> = {
      vencido: 'Documento vencido', pendente: 'Documento pendente', em_elaboracao: 'Documento ainda em elaboração',
    };
    return { situacao: 'nao_conforme', motivo: rot[ruim] ?? 'Documento irregular', proximo: false };
  }
  const proximo = docs.some((s) => s === 'proximo_revisao' || s === 'proximo_vencimento');
  return { situacao: 'conforme', motivo: proximo ? 'Documento perto da revisão ou do vencimento' : null, proximo };
}

/** Percentual de atendimento: só conta requisitos aplicáveis e já avaliados (parcial vale meio). */
export function percentualConformidade(situacoes: SituacaoConformidade[]) {
  const c = situacoes.filter((s) => s === 'conforme').length;
  const p = situacoes.filter((s) => s === 'parcial').length;
  const n = situacoes.filter((s) => s === 'nao_conforme').length;
  const total = c + p + n;
  return total ? Math.round(((c + p / 2) / total) * 1000) / 10 : null;
}

export const CLASSES_EMPRESA = {
  com_vencidos: 'Com vencidos ou atrasos',
  com_pendencias: 'Com pendências',
  prazos_proximos: 'Com prazos próximos',
  regular: 'Regular',
} as const;
export type ClasseEmpresa = keyof typeof CLASSES_EMPRESA;

/** Classificação da empresa na visão consolidada (a pior condição prevalece). */
export function classificarEmpresa(e: {
  documentosVencidos: number; acoesAtrasadas: number; naoConformes: number; parciais: number; aAvaliar: number;
  naoAvaliados: number; documentosPendentes: number; documentosProximos: number; acoesProximas: number;
}): ClasseEmpresa {
  if (e.documentosVencidos || e.acoesAtrasadas) return 'com_vencidos';
  if (e.naoConformes || e.parciais || e.aAvaliar || e.naoAvaliados || e.documentosPendentes) return 'com_pendencias';
  if (e.documentosProximos || e.acoesProximas) return 'prazos_proximos';
  return 'regular';
}
