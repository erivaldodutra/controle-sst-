import { z } from 'zod';
import { cnpjValido, cpfValido, somenteDigitos } from './documentos';

/** Tipos de ASO conforme o eSocial (tpExameOcup). */
export const TIPOS_ASO = {
  0: 'Admissional',
  1: 'Periódico',
  2: 'Retorno ao trabalho',
  3: 'Mudança de risco ocupacional',
  4: 'Monitoração pontual',
  9: 'Demissional',
} as const;
export type TipoAso = keyof typeof TIPOS_ASO;

/** Resultado do ASO (resAso). */
export const RESULTADOS_ASO = { 1: 'Apto', 2: 'Inapto' } as const;

/** Resultado do exame complementar (indResult). Dado clínico. */
export const RESULTADOS_EXAME = { 1: 'Normal', 2: 'Alterado', 3: 'Estável', 4: 'Agravamento' } as const;

/** Ordem do exame (ordExame). */
export const ORDENS_EXAME = { 1: 'Referencial', 2: 'Sequencial' } as const;

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const TIPOS_TURMA = { inicial: 'Inicial', reciclagem: 'Reciclagem', eventual: 'Eventual' } as const;
export const MODALIDADES_TURMA = { presencial: 'Presencial', ead: 'EAD', semipresencial: 'Semipresencial' } as const;
export const SITUACOES_TURMA = { planejada: 'Planejada', realizada: 'Realizada', cancelada: 'Cancelada' } as const;

const texto = (max: number) => z.string().trim().min(1, 'Obrigatório').max(max);
const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const dataOpcional = data.optional().nullable().transform((v) => v ?? null);
const uuid = z.string().uuid();
const uuidOpcional = uuid.optional().nullable().transform((v) => v ?? null);
const emailOpcional = z.string().trim().toLowerCase().email('E-mail inválido').optional().nullable()
  .or(z.literal('').transform(() => null)).transform((v) => v ?? null);
const horas = z.number().positive('Deve ser maior que zero').max(9999);

export const medicoSchema = z.object({
  nome: texto(200),
  cpf: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null))
    .refine((v) => v === null || cpfValido(v), 'CPF inválido'),
  crm: z.string().transform(somenteDigitos).refine((v) => /^\d{1,10}$/.test(v), 'CRM deve ter só números'),
  ufCrm: z.enum(UFS, { message: 'UF inválida' }),
  email: emailOpcional,
  telefone: textoOpcional(30),
  ativo: z.boolean().default(true),
});

export const clinicaSchema = z.object({
  razaoSocial: texto(200),
  nomeFantasia: textoOpcional(200),
  cnpj: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null))
    .refine((v) => v === null || cnpjValido(v), 'CNPJ inválido'),
  telefone: textoOpcional(30),
  email: emailOpcional,
  municipio: textoOpcional(100),
  uf: z.enum(UFS).optional().nullable().transform((v) => v ?? null),
  ativo: z.boolean().default(true),
});

export const exameTipoSchema = z.object({
  nome: texto(200),
  codigoEsocial: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null))
    .refine((v) => v === null || /^\d{4}$/.test(v), 'Código do eSocial deve ter 4 dígitos (Tabela 27)'),
  descricao: textoOpcional(1000),
  ativo: z.boolean().default(true),
});

export const medicoCoordenadorSchema = z.object({
  medicoId: uuid,
  inicio: data,
});

export const asoExameSchema = z.object({
  exameTipoId: uuid,
  dataRealizacao: data,
  ordem: z.union([z.literal(1), z.literal(2)]).optional().nullable().transform((v) => v ?? null),
});

export const asoSchema = z
  .object({
    vinculoId: uuid,
    tipo: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(9)]),
    dataExame: data,
    resultado: z.union([z.literal(1), z.literal(2)]),
    medicoId: uuid,
    clinicaId: uuidOpcional,
    vencimento: dataOpcional,
    riscos: textoOpcional(4000),
    observacoes: textoOpcional(2000),
    exames: z.array(asoExameSchema).max(60).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.vencimento && v.vencimento <= v.dataExame)
      ctx.addIssue({ code: 'custom', path: ['vencimento'], message: 'O vencimento deve ser depois da data do exame' });
    if (v.tipo === 9 && v.vencimento)
      ctx.addIssue({ code: 'custom', path: ['vencimento'], message: 'ASO demissional não tem vencimento' });
    const ids = v.exames.map((e) => e.exameTipoId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['exames'], message: 'Exame repetido no mesmo ASO' });
  });
export type AsoInput = z.infer<typeof asoSchema>;

export const cancelamentoSchema = z.object({ motivo: texto(500) });

/** Resultado de exame: só para quem tem saude.clinico. */
export const resultadoExameSchema = z.object({
  resultado: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  observacao: textoOpcional(2000),
});

export const treinamentoSchema = z.object({
  nome: texto(200),
  norma: textoOpcional(60),
  cargaHoraria: horas,
  cargaHorariaReciclagem: horas.optional().nullable().transform((v) => v ?? null),
  periodicidadeMeses: z.number().int().min(1).max(120).optional().nullable().transform((v) => v ?? null),
  conteudoProgramatico: textoOpcional(10000),
  ativo: z.boolean().default(true),
});

export const turmaSchema = z
  .object({
    treinamentoId: uuid,
    tipo: z.enum(['inicial', 'reciclagem', 'eventual']),
    modalidade: z.enum(['presencial', 'ead', 'semipresencial']),
    dataInicio: data,
    dataFim: data,
    cargaHoraria: horas,
    instrutorNome: texto(200),
    instrutorQualificacao: textoOpcional(300),
    responsavelTecnico: textoOpcional(300),
    local: textoOpcional(300),
    observacoes: textoOpcional(2000),
  })
  .refine((v) => v.dataFim >= v.dataInicio, { path: ['dataFim'], message: 'O fim deve ser igual ou depois do início' });

export const participantesSchema = z.object({ funcionarioIds: z.array(uuid).min(1).max(500) });

export const conclusaoTurmaSchema = z.object({
  participantes: z
    .array(
      z.object({
        id: uuid,
        presente: z.boolean(),
        aprovado: z.boolean(),
        nota: z.number().min(0).max(100).optional().nullable().transform((v) => v ?? null),
      }).refine((p) => !p.aprovado || p.presente, { message: 'Só quem esteve presente pode ser aprovado' }),
    )
    .min(1),
});

export const matrizSchema = z
  .object({ treinamentoId: uuid, funcaoId: uuidOpcional, gheId: uuidOpcional })
  .refine((v) => (v.funcaoId === null) !== (v.gheId === null), { message: 'Informe a função ou o GHE (um dos dois)' });

export const alertasSchema = z.object({
  alertasDias: z.array(z.number().int().min(1).max(365)).min(1).max(6)
    .transform((v) => [...new Set(v)].sort((a, b) => b - a)),
});
