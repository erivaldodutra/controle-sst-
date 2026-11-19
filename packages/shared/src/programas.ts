import { z } from 'zod';

/**
 * Programas legais e documentos de SST.
 * Nenhuma validade universal: cada prazo vem do tipo e pode ser ajustado em cada documento.
 */

export const APLICABILIDADES = { a_avaliar: 'A avaliar', aplicavel: 'Aplicável', nao_aplicavel: 'Não aplicável' } as const;
export type Aplicabilidade = keyof typeof APLICABILIDADES;

export const SITUACOES_VERSAO = {
  em_elaboracao: 'Em elaboração', em_revisao: 'Em revisão', vigente: 'Vigente', substituida: 'Substituída', cancelada: 'Cancelada',
} as const;

export const SITUACOES_DOCUMENTO = {
  regular: 'Regular',
  proximo_revisao: 'Próximo da revisão',
  proximo_vencimento: 'Próximo do vencimento',
  vencido: 'Vencido',
  pendente: 'Pendente',
  em_elaboracao: 'Em elaboração',
  em_revisao: 'Em revisão',
  substituido: 'Substituído',
  nao_aplicavel: 'Não aplicável',
} as const;
export type SituacaoDocumento = keyof typeof SITUACOES_DOCUMENTO;

/** Os cinco prazos controlados separadamente. */
export const TIPOS_PRAZO = {
  revisao: 'Revisão legal',
  vencimento: 'Vencimento',
  monitoramento: 'Acompanhamento periódico',
  reavaliacao: 'Reavaliação interna',
} as const;
export type TipoPrazo = keyof typeof TIPOS_PRAZO;

/**
 * Biblioteca sugerida. Só traz prazo quando a própria norma o fixa de forma expressa;
 * nos demais, o prazo fica em branco para o profissional definir.
 */
export const BIBLIOTECA_DOCUMENTOS: {
  sigla: string; nome: string; baseLegal: string; criterioRevisao?: string;
  prazoRevisaoMeses?: number; vencimentoMeses?: number; monitoramentoMeses?: number;
}[] = [
  {
    sigla: 'PGR', nome: 'Programa de Gerenciamento de Riscos', baseLegal: 'NR-01',
    prazoRevisaoMeses: 24,
    criterioRevisao: 'Avaliação de riscos revista a cada 2 anos (3 anos com sistema de gestão de SST certificado) e sempre que houver '
      + 'implementação de medidas de prevenção, inovações e modificações tecnológicas, ambientais ou organizacionais, '
      + 'identificação de inadequações, ocorrência de acidente ou doença relacionada ao trabalho, ou mudança nos requisitos legais (NR-01).',
  },
  {
    sigla: 'PGRTR', nome: 'Programa de Gerenciamento de Riscos no Trabalho Rural', baseLegal: 'NR-31',
    criterioRevisao: 'Conforme a NR-31 e sempre que houver mudança nas condições de trabalho.',
  },
  {
    sigla: 'PCMSO', nome: 'Programa de Controle Médico de Saúde Ocupacional', baseLegal: 'NR-07',
    monitoramentoMeses: 12,
    criterioRevisao: 'Relatório analítico anual (NR-07). Atualizar quando o inventário de riscos do PGR mudar.',
  },
  {
    sigla: 'LTCAT', nome: 'Laudo Técnico das Condições Ambientais do Trabalho', baseLegal: 'Lei 8.213/1991, art. 58',
    criterioRevisao: 'Sem prazo fixo na legislação: atualizar quando houver mudança no ambiente, nos agentes ou nas medidas de controle.',
  },
  { sigla: 'AEP', nome: 'Avaliação Ergonômica Preliminar', baseLegal: 'NR-17' },
  { sigla: 'AET', nome: 'Análise Ergonômica do Trabalho', baseLegal: 'NR-17' },
  { sigla: 'PCA', nome: 'Programa de Conservação Auditiva', baseLegal: 'NR-07 (Anexo II) e NR-09' },
  { sigla: 'PPR', nome: 'Programa de Proteção Respiratória', baseLegal: 'Instrução Normativa MTb nº 1/1994 e NR-06' },
  {
    sigla: 'CIPA', nome: 'CIPA: processo eleitoral e mandato', baseLegal: 'NR-05',
    vencimentoMeses: 12, criterioRevisao: 'Mandato de 1 ano (NR-05).',
  },
  { sigla: 'LI', nome: 'Laudo de insalubridade', baseLegal: 'NR-15' },
  { sigla: 'LP', nome: 'Laudo de periculosidade', baseLegal: 'NR-16' },
  { sigla: 'LTA', nome: 'Laudo técnico de avaliação ambiental', baseLegal: 'NR-09' },
  { sigla: 'PE', nome: 'Plano de atendimento a emergências', baseLegal: 'NR-01' },
  {
    sigla: 'AVCB', nome: 'Documentação de proteção contra incêndio (AVCB/CLCB)', baseLegal: 'NR-23 e legislação estadual do Corpo de Bombeiros',
    criterioRevisao: 'Validade definida no próprio certificado emitido pelo Corpo de Bombeiros.',
  },
];

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------
const texto = (max: number) => z.string().trim().min(1, 'Obrigatório').max(max);
const textoOpcional = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const dataOpcional = data.optional().nullable().transform((v) => v ?? null);
const meses = z.number().int().min(1, 'Mínimo 1 mês').max(120, 'Máximo 120 meses').optional().nullable().transform((v) => v ?? null);

export const documentoTipoSchema = z.object({
  sigla: textoOpcional(20),
  nome: texto(200),
  baseLegal: textoOpcional(500),
  descricao: textoOpcional(5000),
  prazoRevisaoMeses: meses,
  vencimentoMeses: meses,
  monitoramentoMeses: meses,
  reavaliacaoMeses: meses,
  criterioRevisao: textoOpcional(5000),
  ativo: z.boolean().default(true),
});
export type DocumentoTipoInput = z.infer<typeof documentoTipoSchema>;

const regrasDocumento = {
  prazoRevisaoMeses: meses,
  vencimentoMeses: meses,
  monitoramentoMeses: meses,
  reavaliacaoMeses: meses,
  criterioRevisao: textoOpcional(5000),
  baseLegal: textoOpcional(500),
};

export const documentoSchema = z.object({
  empresaId: z.string().uuid(),
  estabelecimentoId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  tipoId: z.string().uuid(),
  identificacao: texto(300),
  observacoes: textoOpcional(5000),
  /** Ausente: copia os prazos do tipo. */
  regras: z.object(regrasDocumento).optional(),
});
export type DocumentoInput = z.infer<typeof documentoSchema>;

export const documentoEdicaoSchema = z.object({
  estabelecimentoId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  identificacao: texto(300),
  observacoes: textoOpcional(5000),
  ...regrasDocumento,
});

export const aplicabilidadeSchema = z
  .object({ aplicabilidade: z.enum(['a_avaliar', 'aplicavel', 'nao_aplicavel']), justificativa: textoOpcional(2000) })
  .refine((v) => v.aplicabilidade !== 'nao_aplicavel' || !!v.justificativa, {
    message: 'Justifique por que o documento não se aplica', path: ['justificativa'],
  });

export const mudancaCondicoesSchema = z.object({ data, motivo: texto(2000) });

export const substituicaoDocumentoSchema = z.object({
  data,
  motivo: texto(2000),
  substitutoId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
});

export const versaoSchema = z
  .object({
    responsavelNome: textoOpcional(200),
    responsavelRegistro: textoOpcional(100),
    responsavelFormacao: textoOpcional(200),
    dataElaboracao: dataOpcional,
    dataEmissao: dataOpcional,
    inicioVigencia: dataOpcional,
    dataRevisao: dataOpcional,
    dataVencimento: dataOpcional,
    dataReavaliacao: dataOpcional,
    descricaoAlteracoes: textoOpcional(5000),
    observacoes: textoOpcional(5000),
  })
  .superRefine((v, c) => {
    const depois = (campo: 'dataRevisao' | 'dataVencimento' | 'dataReavaliacao', rotulo: string) => {
      if (v[campo] && v.dataEmissao && v[campo]! <= v.dataEmissao)
        c.addIssue({ code: 'custom', path: [campo], message: `${rotulo} deve ser depois da emissão` });
    };
    depois('dataRevisao', 'A revisão');
    depois('dataVencimento', 'O vencimento');
    depois('dataReavaliacao', 'A reavaliação');
    if (v.dataElaboracao && v.dataEmissao && v.dataElaboracao > v.dataEmissao)
      c.addIssue({ code: 'custom', path: ['dataElaboracao'], message: 'A elaboração não pode ser depois da emissão' });
  });
export type VersaoInput = z.infer<typeof versaoSchema>;

export const acompanhamentoSchema = z.object({ data, responsavelNome: texto(200), descricao: texto(5000) });

// ---------------------------------------------------------------------------
// Datas e situação
// ---------------------------------------------------------------------------
const MS_DIA = 86_400_000;
const utc = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a!, m! - 1, d!);
};
export const diasEntre = (de: string, ate: string) => Math.round((utc(ate) - utc(de)) / MS_DIA);

/** Soma meses a uma data AAAA-MM-DD; dia 31 vira o último dia do mês quando ele não existe. */
export function somarMesesIso(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a!, m! - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d!, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export interface PrazoDocumento {
  tipo: TipoPrazo;
  data: string;
  dias: number;
  estado: 'em_dia' | 'proximo' | 'atrasado';
}

export interface EntradaSituacao {
  aplicabilidade: Aplicabilidade;
  substituidoEm: string | null;
  mudancaCondicoesEm: string | null;
  mudancaCondicoesMotivo: string | null;
  monitoramentoMeses: number | null;
  ultimoAcompanhamento: string | null;
  temRascunho: boolean;
  vigente: { dataEmissao: string; dataRevisao: string | null; dataVencimento: string | null; dataReavaliacao: string | null } | null;
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Situação de um documento a partir da versão vigente e dos prazos.
 * janela = maior prazo de alerta em dias (configuração de alertas).
 * Prioridade: vencido > em revisão > pendente > próximo do vencimento > próximo da revisão > regular.
 */
export function situacaoDocumento(e: EntradaSituacao, hoje: string, janela: number) {
  const motivos: string[] = [];
  const prazos: PrazoDocumento[] = [];
  if (e.substituidoEm) return { situacao: 'substituido' as SituacaoDocumento, motivos: [`Substituído em ${dataBr(e.substituidoEm)}`], prazos };
  if (e.aplicabilidade === 'nao_aplicavel') return { situacao: 'nao_aplicavel' as SituacaoDocumento, motivos, prazos };
  if (e.aplicabilidade === 'a_avaliar') motivos.push('Aplicabilidade ainda não avaliada pelo responsável');
  if (!e.vigente) {
    if (e.temRascunho) return { situacao: 'em_elaboracao' as SituacaoDocumento, motivos: [...motivos, 'Primeira versão em elaboração'], prazos };
    return { situacao: 'pendente' as SituacaoDocumento, motivos: [...motivos, 'Nenhuma versão emitida'], prazos };
  }
  const v = e.vigente;
  const prazo = (tipo: TipoPrazo, data: string | null) => {
    if (!data) return;
    const dias = diasEntre(hoje, data);
    prazos.push({ tipo, data, dias, estado: dias < 0 ? 'atrasado' : dias <= janela ? 'proximo' : 'em_dia' });
  };
  prazo('revisao', v.dataRevisao);
  prazo('vencimento', v.dataVencimento);
  if (e.monitoramentoMeses) prazo('monitoramento', somarMesesIso(e.ultimoAcompanhamento ?? v.dataEmissao, e.monitoramentoMeses));
  prazo('reavaliacao', v.dataReavaliacao);
  const p = (t: TipoPrazo) => prazos.find((x) => x.tipo === t);
  const estado = (t: TipoPrazo) => p(t)?.estado;

  if (estado('vencimento') === 'atrasado') motivos.push(`Vencido em ${dataBr(p('vencimento')!.data)}`);
  if (estado('revisao') === 'atrasado') motivos.push(`Prazo legal de revisão venceu em ${dataBr(p('revisao')!.data)}`);
  if (e.mudancaCondicoesEm) motivos.push(`Atualização necessária por mudança de condições (${dataBr(e.mudancaCondicoesEm)}): ${e.mudancaCondicoesMotivo}`);
  if (estado('monitoramento') === 'atrasado') motivos.push(`Acompanhamento periódico atrasado desde ${dataBr(p('monitoramento')!.data)}`);
  if (estado('reavaliacao') === 'atrasado') motivos.push(`Reavaliação interna atrasada desde ${dataBr(p('reavaliacao')!.data)}`);
  if (e.temRascunho) motivos.push('Nova versão em revisão');
  if (estado('vencimento') === 'proximo') motivos.push(`Vence em ${p('vencimento')!.dias} dias`);
  if (estado('revisao') === 'proximo') motivos.push(`Revisão legal em ${p('revisao')!.dias} dias`);
  if (estado('monitoramento') === 'proximo') motivos.push(`Acompanhamento periódico em ${p('monitoramento')!.dias} dias`);
  if (estado('reavaliacao') === 'proximo') motivos.push(`Reavaliação interna em ${p('reavaliacao')!.dias} dias`);

  let situacao: SituacaoDocumento = 'regular';
  if (estado('vencimento') === 'atrasado' || estado('revisao') === 'atrasado') situacao = 'vencido';
  else if (e.temRascunho) situacao = 'em_revisao';
  else if (e.mudancaCondicoesEm || estado('monitoramento') === 'atrasado' || estado('reavaliacao') === 'atrasado') situacao = 'pendente';
  else if (estado('vencimento') === 'proximo') situacao = 'proximo_vencimento';
  else if (['revisao', 'monitoramento', 'reavaliacao'].some((t) => estado(t as TipoPrazo) === 'proximo')) situacao = 'proximo_revisao';
  return { situacao, motivos, prazos };
}
