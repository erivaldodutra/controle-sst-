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
  'sistema.configurar': 'Alterar configurações gerais (prazos de alerta)',
  'saude.ler': 'Ver ASOs, aptidão, vencimentos e cadastros de saúde (sem resultados de exames)',
  'saude.editar': 'Registrar e cancelar ASOs; cadastrar médicos, clínicas e tipos de exame',
  'saude.clinico': 'Ver e registrar resultados de exames complementares (dado sensível de saúde)',
  'treinamentos.ler': 'Ver treinamentos, turmas, certificados e matriz de treinamentos',
  'treinamentos.editar': 'Cadastrar treinamentos, turmas, presença, certificados e matriz',
} as const;

/** Dado clínico: nenhum perfil o recebe sem ser de saúde, nem o administrador geral. */
export const PERMISSOES_CLINICAS: Permissao[] = ['saude.clinico'];

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

const LEITURA: Permissao[] = ['empresas.ler', 'estrutura.ler', 'funcionarios.ler', 'saude.ler', 'treinamentos.ler'];

/**
 * Perfis padrão (seção "Perfis e permissões" do plano técnico).
 * Só o perfil MEDICO vê resultado de exame; o ADMIN_GERAL não recebe dado clínico.
 * Permissão nova em perfil padrão precisa entrar também numa migration, para
 * chegar às instalações que já existem (um teste confere).
 */
export const PERFIS_PADRAO: Record<CodigoPerfil, { nome: string; permissoes: Permissao[] }> = {
  ADMIN_GERAL: { nome: 'Administrador geral', permissoes: TODAS_PERMISSOES.filter((p) => !PERMISSOES_CLINICAS.includes(p)) },
  ADMIN_EMPRESA: {
    nome: 'Administrador da empresa',
    permissoes: [...LEITURA, 'empresas.editar', 'estrutura.editar', 'funcionarios.editar', 'funcionarios.importar', 'auditoria.ler',
      'saude.editar', 'treinamentos.editar'],
  },
  ENG_SEGURANCA: { nome: 'Engenheiro de Segurança', permissoes: [...LEITURA, 'estrutura.editar', 'treinamentos.editar'] },
  TEC_SEGURANCA: { nome: 'Técnico de Segurança', permissoes: [...LEITURA, 'estrutura.editar', 'treinamentos.editar'] },
  MEDICO: { nome: 'Médico', permissoes: [...LEITURA, 'saude.editar', 'saude.clinico'] },
  RH: { nome: 'RH', permissoes: [...LEITURA, 'funcionarios.editar', 'funcionarios.importar', 'saude.editar', 'treinamentos.editar'] },
  OPERADOR_ESOCIAL: { nome: 'Operador eSocial', permissoes: [...LEITURA] },
  VISUALIZADOR: { nome: 'Visualizador', permissoes: [...LEITURA] },
};
