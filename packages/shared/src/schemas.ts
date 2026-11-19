import { z } from 'zod';
import { cnpjValido, cpfValido, somenteDigitos } from './documentos';

const texto = (max: number) => z.string().trim().min(1, 'Obrigatório').max(max);
const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const digitos = (n: number, rotulo: string) =>
  z.string().transform(somenteDigitos).refine((v) => v.length === n, `${rotulo} deve ter ${n} dígitos`);
const digitosOpcional = (n: number, rotulo: string) =>
  z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? somenteDigitos(v) : null))
    .refine((v) => v === null || v.length === n, `${rotulo} deve ter ${n} dígitos`);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const dataOpcional = data.optional().nullable().transform((v) => v ?? null);
const uuid = z.string().uuid();
const uuidOpcional = uuid.optional().nullable().transform((v) => v ?? null);
const email = z.string().trim().toLowerCase().email('E-mail inválido');

export const cpfSchema = z.string().transform(somenteDigitos).refine(cpfValido, 'CPF inválido');

export const enderecoSchema = z.object({
  logradouro: textoOpcional(200),
  numero: textoOpcional(20),
  complemento: textoOpcional(100),
  bairro: textoOpcional(100),
  municipio: textoOpcional(100),
  uf: z.string().trim().toUpperCase().length(2).optional().nullable().transform((v) => v ?? null),
  cep: digitosOpcional(8, 'CEP'),
});

/** Empresa (empregador). tipoInscricao segue o eSocial: 1 = CNPJ, 2 = CPF. */
export const empresaSchema = z
  .object({
    tipoInscricao: z.union([z.literal(1), z.literal(2)]),
    inscricao: z.string().transform(somenteDigitos),
    razaoSocial: texto(200),
    nomeFantasia: textoOpcional(200),
    cnaePrincipal: digitosOpcional(7, 'CNAE'),
    cnaesSecundarios: z.array(digitos(7, 'CNAE')).default([]),
    grauRisco: z.number().int().min(1).max(4).optional().nullable().transform((v) => v ?? null),
    naturezaJuridica: digitosOpcional(4, 'Natureza jurídica'),
    classificacaoTributaria: digitosOpcional(2, 'Classificação tributária'),
    endereco: enderecoSchema.prefault({}),
    responsavelNome: textoOpcional(200),
    responsavelCpf: z.string().optional().nullable().transform((v) => (v ? somenteDigitos(v) : null))
      .refine((v) => v === null || cpfValido(v), 'CPF do responsável inválido'),
    responsavelEmail: email.optional().nullable().transform((v) => v ?? null),
    responsavelTelefone: textoOpcional(30),
    contatoEmail: email.optional().nullable().transform((v) => v ?? null),
    contatoTelefone: textoOpcional(30),
    observacoes: textoOpcional(2000),
  })
  .superRefine((v, ctx) => {
    const ok = v.tipoInscricao === 1 ? cnpjValido(v.inscricao) : cpfValido(v.inscricao);
    if (!ok) ctx.addIssue({ code: 'custom', path: ['inscricao'], message: v.tipoInscricao === 1 ? 'CNPJ inválido' : 'CPF inválido' });
  });
export type EmpresaInput = z.infer<typeof empresaSchema>;

/** Estabelecimento. tipoInscricao eSocial: 1 = CNPJ, 3 = CAEPF, 4 = CNO. */
export const estabelecimentoSchema = z
  .object({
    tipoInscricao: z.union([z.literal(1), z.literal(3), z.literal(4)]),
    inscricao: z.string().transform(somenteDigitos),
    nome: texto(200),
    matriz: z.boolean().default(false),
    cnae: digitosOpcional(7, 'CNAE'),
    grauRisco: z.number().int().min(1).max(4).optional().nullable().transform((v) => v ?? null),
    endereco: enderecoSchema.prefault({}),
    observacoes: textoOpcional(2000),
  })
  .superRefine((v, ctx) => {
    if (v.tipoInscricao === 1 && !cnpjValido(v.inscricao))
      ctx.addIssue({ code: 'custom', path: ['inscricao'], message: 'CNPJ inválido' });
    if (v.tipoInscricao === 3 && v.inscricao.length !== 14)
      ctx.addIssue({ code: 'custom', path: ['inscricao'], message: 'CAEPF deve ter 14 dígitos' });
    if (v.tipoInscricao === 4 && v.inscricao.length !== 12)
      ctx.addIssue({ code: 'custom', path: ['inscricao'], message: 'CNO deve ter 12 dígitos' });
  });
export type EstabelecimentoInput = z.infer<typeof estabelecimentoSchema>;

export const setorSchema = z.object({
  estabelecimentoId: uuid,
  nome: texto(150),
  descricao: textoOpcional(2000),
  ativo: z.boolean().default(true),
});
export const cargoSchema = z.object({
  nome: texto(150),
  cbo: digitosOpcional(6, 'CBO'),
  descricao: textoOpcional(2000),
  ativo: z.boolean().default(true),
});
export const funcaoSchema = z.object({
  nome: texto(150),
  cbo: digitosOpcional(6, 'CBO'),
  descricaoAtividades: textoOpcional(4000),
  ativo: z.boolean().default(true),
});
export const gheSchema = z.object({
  estabelecimentoId: uuid,
  codigo: texto(30),
  nome: texto(150),
  descricao: textoOpcional(4000),
  ativo: z.boolean().default(true),
});

/** Dados da pessoa. Não mudam com movimentações. */
export const pessoaSchema = z.object({
  nome: texto(200),
  cpf: cpfSchema,
  dataNascimento: dataOpcional,
  sexo: z.enum(['M', 'F']).optional().nullable().transform((v) => v ?? null),
  email: email.optional().nullable().transform((v) => v ?? null),
  telefone: textoOpcional(30),
});

/** Posição na estrutura. Cada mudança cria um novo período (lotação). */
export const posicaoSchema = z.object({
  estabelecimentoId: uuid,
  setorId: uuidOpcional,
  cargoId: uuidOpcional,
  funcaoId: uuidOpcional,
  gheId: uuidOpcional,
});

export const TIPOS_CONTRATO = {
  1: 'Prazo indeterminado',
  2: 'Prazo determinado, definido em dias',
  3: 'Prazo determinado, vinculado à ocorrência de um fato',
} as const;

export const admissaoSchema = z.object({
  pessoa: pessoaSchema,
  matricula: texto(30),
  dataAdmissao: data,
  categoria: digitosOpcional(3, 'Categoria eSocial'),
  tipoContrato: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().nullable().transform((v) => v ?? null),
  jornada: textoOpcional(200),
  posicao: posicaoSchema,
});
export type AdmissaoInput = z.infer<typeof admissaoSchema>;

export const movimentacaoSchema = z.object({
  inicio: data,
  motivo: texto(500),
  posicao: posicaoSchema,
});
export type MovimentacaoInput = z.infer<typeof movimentacaoSchema>;

export const afastamentoSchema = z.object({
  inicio: data,
  fim: dataOpcional,
  motivo: texto(500),
});
export const desligamentoSchema = z.object({ data: data, motivo: textoOpcional(500) });

export const loginSchema = z.object({ email, senha: z.string().min(1), codigoMfa: z.string().optional() });

/** Política mínima de senha: 10+ caracteres com letras e números. */
export const senhaSchema = z
  .string()
  .min(10, 'A senha precisa ter pelo menos 10 caracteres')
  .max(200)
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), 'Use letras e números');

export const configuracaoInicialSchema = z.object({
  organizacao: texto(200),
  nome: texto(200),
  email,
  senha: senhaSchema,
});

export const usuarioSchema = z.object({
  nome: texto(200),
  email,
  ativo: z.boolean().default(true),
  atribuicoes: z
    .array(z.object({ perfil: z.string(), empresaId: uuidOpcional }))
    .min(1, 'Atribua ao menos um perfil'),
});
export const novoUsuarioSchema = usuarioSchema.extend({ senhaTemporaria: senhaSchema });
