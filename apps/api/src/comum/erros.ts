import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Traduz erros do PostgreSQL para mensagens úteis e nunca expõe detalhes internos. */
@Catch()
export class FiltroErros implements ExceptionFilter {
  private readonly log = new Logger('Erros');

  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const corpo = e.getResponse();
      res.status(e.getStatus()).json(typeof corpo === 'string' ? { mensagem: corpo } : normalizar(corpo));
      return;
    }
    const pg = traduzirPg(e);
    if (pg) {
      res.status(pg.status).json({ mensagem: pg.mensagem });
      return;
    }
    this.log.error(e?.stack ?? e);
    res.status(500).json({ mensagem: 'Erro interno. A operação não foi gravada.' });
  }
}

function normalizar(c: any) {
  if (c?.mensagem) return c;
  return { mensagem: Array.isArray(c?.message) ? c.message.join('; ') : c?.message ?? 'Erro' };
}

const UNICOS: Record<string, string> = {
  empresa_tenant_id_inscricao_key: 'Já existe uma empresa com este CNPJ/CPF',
  estabelecimento_empresa_id_tipo_inscricao_inscricao_key: 'Já existe um estabelecimento com esta inscrição nesta empresa',
  estabelecimento_uma_matriz: 'Esta empresa já tem um estabelecimento marcado como matriz',
  setor_estabelecimento_id_nome_key: 'Já existe um setor com este nome neste estabelecimento',
  cargo_empresa_id_nome_key: 'Já existe um cargo com este nome nesta empresa',
  funcao_empresa_id_nome_key: 'Já existe uma função com este nome nesta empresa',
  ghe_estabelecimento_id_codigo_key: 'Já existe um GHE com este código neste estabelecimento',
  funcionario_empresa_id_cpf_key: 'Já existe um funcionário com este CPF nesta empresa',
  vinculo_empresa_id_matricula_key: 'Esta matrícula já está em uso nesta empresa',
  usuario_email_uq: 'Já existe um usuário com este e-mail',
  medico_tenant_id_uf_crm_crm_key: 'Já existe um médico com este CRM nesta UF',
  clinica_tenant_id_cnpj_key: 'Já existe uma clínica com este CNPJ',
  exame_tipo_tenant_id_nome_key: 'Já existe um tipo de exame com este nome',
  aso_exame_aso_id_exame_tipo_id_key: 'Exame repetido no mesmo ASO',
  treinamento_tenant_id_nome_key: 'Já existe um treinamento com este nome',
  turma_participante_turma_id_funcionario_id_key: 'Funcionário já está nesta turma',
  matriz_treinamento_empresa_id_treinamento_id_funcao_id_ghe__key: 'Este treinamento já está na matriz para esta função/GHE',
  documento_tipo_tenant_id_nome_key: 'Já existe um tipo de documento com este nome',
  documento_versao_uma_vigente: 'Este documento já tem uma versão vigente',
  documento_versao_um_rascunho: 'Já existe uma versão em elaboração ou revisão deste documento',
  requisito_tenant_id_titulo_key: 'Já existe um requisito com este título',
  conformidade_empresa_id_estabelecimento_id_requisito_id_key: 'Este requisito já foi avaliado para esta empresa ou estabelecimento',
  inspecao_item_inspecao_id_ordem_key: 'Item repetido na inspeção; tente de novo',
};

export function traduzirPg(e: any): { status: number; mensagem: string } | null {
  switch (e?.code) {
    case '23505':
      return { status: 409, mensagem: UNICOS[e.constraint] ?? 'Registro duplicado' };
    case '23503':
      return { status: 422, mensagem: 'Referência inválida: o registro relacionado não existe ou pertence a outra empresa' };
    case '23P01':
      return { status: 409, mensagem: 'O período informado se sobrepõe a outro período já registrado' };
    case '23514':
      return { status: 422, mensagem: 'Valor fora do formato permitido' };
    case '42501':
      return { status: 403, mensagem: 'Acesso negado a este registro' };
    case 'P0001':
      return { status: 409, mensagem: e.message };
    default:
      return null;
  }
}
