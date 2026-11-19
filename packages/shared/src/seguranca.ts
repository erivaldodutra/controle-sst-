import { z } from 'zod';

// ---------------------------------------------------------------------------
// Segurança da sessão e política de retenção
// ---------------------------------------------------------------------------
export const politicaSchema = z.object({
  inatividadeMinutos: z.number().int().min(5, 'Mínimo de 5 minutos').max(720, 'Máximo de 720 minutos (12 horas)'),
  retencaoAvisosDias: z.number().int().min(30, 'Mínimo de 30 dias').max(3650, 'Máximo de 3.650 dias'),
  retencaoSessoesDias: z.number().int().min(30, 'Mínimo de 30 dias').max(3650, 'Máximo de 3.650 dias'),
});
export type Politica = z.infer<typeof politicaSchema>;

/**
 * Registros com valor legal: nunca são apagados pelo sistema.
 * O prazo mostrado é o mínimo exigido pela norma citada; o sistema guarda por tempo indeterminado.
 */
export const CATEGORIAS_LEGAIS = [
  { chave: 'aso', nome: 'ASO e exames ocupacionais', prazo: '20 anos após o desligamento', base: 'NR-07 (prontuário clínico e ASO)' },
  { chave: 'documento', nome: 'Programas, laudos e versões (PGR, PCMSO, LTCAT...)', prazo: '20 anos (histórico do inventário de riscos)', base: 'NR-01 (histórico do inventário de riscos); Lei 8.213/91 (LTCAT e PPP)' },
  { chave: 'treinamento', nome: 'Treinamentos e certificados', prazo: 'Enquanto durar o vínculo e depois dele, como prova de capacitação', base: 'NR-01 (capacitação) e NRs específicas' },
  { chave: 'ocorrencia', nome: 'Ocorrências, acidentes e CAT', prazo: 'Sem prazo de descarte (prova previdenciária e trabalhista)', base: 'Lei 8.213/91, art. 22; NR-01 (análise de acidentes)' },
  { chave: 'acao', nome: 'Planos de ação, inspeções e evidências', prazo: 'Junto com o PGR a que pertencem', base: 'NR-01 (plano de ação do PGR)' },
  { chave: 'esocial', nome: 'Eventos do eSocial, lotes e recibos', prazo: 'No mínimo 5 anos (prazo de fiscalização)', base: 'Código Tributário Nacional, art. 173; manual do eSocial' },
  { chave: 'auditoria', nome: 'Registro de auditoria', prazo: 'Permanente (não pode ser alterado nem apagado)', base: 'LGPD, art. 37 (registro das operações de tratamento)' },
] as const;
export type CategoriaLegal = (typeof CATEGORIAS_LEGAIS)[number]['chave'];
