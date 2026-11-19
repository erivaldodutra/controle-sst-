import { z } from 'zod';
import type { Permissao } from './permissoes';

// ---------------------------------------------------------------------------
// Calendário de obrigações e notificações
// ---------------------------------------------------------------------------
export const CATEGORIAS_ALERTA = {
  aso: 'ASO periódico',
  treinamento: 'Treinamentos',
  documento: 'Programas e documentos',
  acao: 'Planos de ação',
  esocial: 'Prazos do eSocial',
  certificado: 'Certificado digital',
} as const;
export type CategoriaAlerta = keyof typeof CATEGORIAS_ALERTA;
export const LISTA_CATEGORIAS = Object.keys(CATEGORIAS_ALERTA) as CategoriaAlerta[];

/** Estado do prazo na data de hoje, com a janela de alerta configurada (em dias). */
export type EstadoPrazo = 'atrasado' | 'proximo' | 'futuro';

export interface ItemCalendario {
  /** Chave estável do prazo (categoria, registro e data), usada para não repetir avisos. */
  chave: string;
  categoria: CategoriaAlerta;
  data: string;
  estado: EstadoPrazo;
  dias: number;
  titulo: string;
  detalhe: string | null;
  empresaId: string;
  empresa: string;
  link: string;
}

export function estadoPrazo(data: string, hoje: string, janela: number): { estado: EstadoPrazo; dias: number } {
  const dias = Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
  return { dias, estado: dias < 0 ? 'atrasado' : dias <= janela ? 'proximo' : 'futuro' };
}

export const preferenciasSchema = z.object({
  categorias: z.partialRecord(z.enum(LISTA_CATEGORIAS as [CategoriaAlerta, ...CategoriaAlerta[]]), z.boolean()),
});

// ---------------------------------------------------------------------------
// Central de relatórios (PDF e Excel), sempre com os dados atuais
// ---------------------------------------------------------------------------
export const RELATORIOS = {
  funcionarios: { nome: 'Funcionários e lotações', descricao: 'Vínculos ativos e afastados com estabelecimento, setor, função e GHE atuais.', permissao: 'funcionarios.ler' },
  aso: { nome: 'Controle de ASO periódico', descricao: 'Último ASO de cada trabalhador, vencimento e situação (sem resultados de exames).', permissao: 'saude.ler' },
  treinamentos: { nome: 'Treinamentos exigidos', descricao: 'Treinamentos exigidos pela matriz, validade e situação por trabalhador.', permissao: 'treinamentos.ler' },
  documentos: { nome: 'Programas e documentos', descricao: 'PGR, PCMSO, laudos e demais documentos com versão vigente, prazos e situação.', permissao: 'documentos.ler' },
  acoes: { nome: 'Planos de ação', descricao: 'Ações com origem, responsável, prazo e situação.', permissao: 'acoes.ler' },
  ocorrencias: { nome: 'Ocorrências e acidentes', descricao: 'Acidentes, incidentes e quase acidentes no período, com gravidade e situação.', permissao: 'inspecoes.ler' },
  conformidade: { nome: 'Matriz de conformidade', descricao: 'Requisitos legais com aplicabilidade e avaliação.', permissao: 'conformidade.ler' },
  esocial: { nome: 'Eventos do eSocial', descricao: 'Eventos S-2210, S-2220, S-2240 e S-3000 com situação, prazo e recibo.', permissao: 'esocial.ler' },
  calendario: { nome: 'Calendário de obrigações', descricao: 'Prazos atrasados e dos próximos dias em todos os módulos.', permissao: 'empresas.ler' },
} as const satisfies Record<string, { nome: string; descricao: string; permissao: Permissao }>;
export type TipoRelatorio = keyof typeof RELATORIOS;

export const filtroRelatorioSchema = z.object({
  formato: z.enum(['pdf', 'xlsx']),
  empresaId: z.string().uuid().optional(),
  /** Período (ocorrências e eventos) ou horizonte do calendário. */
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ---------------------------------------------------------------------------
// Assistente de IA: só sugere; uma pessoa aceita ou descarta
// ---------------------------------------------------------------------------
export const MODELOS_IA = {
  'claude-opus-5-5': 'Claude Opus 5.5 (recomendado)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (mais econômico)',
} as const;
export type ModeloIa = keyof typeof MODELOS_IA;

export const iaConfigSchema = z.object({
  ativo: z.boolean(),
  modelo: z.enum(Object.keys(MODELOS_IA) as [ModeloIa, ...ModeloIa[]]),
  /** Só quando trocar a chave; vazio mantém a atual. */
  chave: z.string().trim().max(300).optional().nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v), 'Chave da API da Anthropic (começa com sk-ant-)'),
});

export const TIPOS_SUGESTAO_IA = {
  explicar_rejeicao: 'Explicação de erro ou rejeição do eSocial',
  resumo_pendencias: 'Resumo de pendências da empresa',
} as const;

export const SITUACOES_SUGESTAO = { pendente: 'Aguardando decisão', aceita: 'Aceita', descartada: 'Descartada' } as const;

export const descarteSugestaoSchema = z.object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(500) });

/**
 * Tira do texto o que identifica pessoas antes de enviar ao serviço de IA:
 * CPF, CNPJ, NIS, e-mails e sequências longas de dígitos.
 */
export function anonimizar(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    .replace(/\b\d{9,}\b/g, '[número]');
}
