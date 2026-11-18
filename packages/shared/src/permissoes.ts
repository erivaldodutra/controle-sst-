/**
 * Catálogo de permissões finas. O código da permissão é gravado no banco
 * (tabela perfil_permissao), então nunca renomeie um código existente.
 */
export const PERMISSOES = {
  'usuarios.gerenciar': 'Criar, editar e bloquear usuários e perfis',
  'auditoria.ler': 'Consultar o registro de auditoria',
  'empresas.ler': 'Ver empresas e estabelecimentos',
  'empresas.editar': 'Cadastrar e editar empresas e estabelecimentos',
  'estrutura.ler': 'Ver setores, cargos, funções e GHE',
  'estrutura.editar': 'Cadastrar e editar setores, cargos, funções e GHE',
  'funcionarios.ler': 'Ver funcionários, vínculos e lotações',
  'funcionarios.editar': 'Cadastrar, movimentar, afastar e desligar funcionários',
  'funcionarios.importar': 'Importar funcionários por planilha Excel',
  'backup.gerenciar': 'Gerar e restaurar backups',
} as const;

export type Permissao = keyof typeof PERMISSOES;
export const TODAS_PERMISSOES = Object.keys(PERMISSOES) as Permissao[];

export type CodigoPerfil =
  | 'ADMIN_GERAL'
  | 'ADMIN_EMPRESA'
  | 'ENG_SEGURANCA'
  | 'TEC_SEGURANCA'
  | 'MEDICO'
  | 'RH'
  | 'OPERADOR_ESOCIAL'
  | 'VISUALIZADOR';

const LEITURA: Permissao[] = ['empresas.ler', 'estrutura.ler', 'funcionarios.ler'];

/**
 * Perfis padrão (seção "Perfis e permissões" do plano técnico).
 * Dados clínicos não fazem parte da Fase 1; o perfil MEDICO ganha essas
 * permissões na Fase 2 e o ADMIN_GERAL não as recebe por padrão.
 */
export const PERFIS_PADRAO: Record<CodigoPerfil, { nome: string; permissoes: Permissao[] }> = {
  ADMIN_GERAL: { nome: 'Administrador geral', permissoes: [...TODAS_PERMISSOES] },
  ADMIN_EMPRESA: {
    nome: 'Administrador da empresa',
    permissoes: [...LEITURA, 'empresas.editar', 'estrutura.editar', 'funcionarios.editar', 'funcionarios.importar', 'auditoria.ler'],
  },
  ENG_SEGURANCA: { nome: 'Engenheiro de Segurança', permissoes: [...LEITURA, 'estrutura.editar'] },
  TEC_SEGURANCA: { nome: 'Técnico de Segurança', permissoes: [...LEITURA, 'estrutura.editar'] },
  MEDICO: { nome: 'Médico', permissoes: [...LEITURA] },
  RH: { nome: 'RH', permissoes: [...LEITURA, 'funcionarios.editar', 'funcionarios.importar'] },
  OPERADOR_ESOCIAL: { nome: 'Operador eSocial', permissoes: [...LEITURA] },
  VISUALIZADOR: { nome: 'Visualizador', permissoes: [...LEITURA] },
};
