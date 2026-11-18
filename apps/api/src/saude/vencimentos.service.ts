import { Inject, Injectable } from '@nestjs/common';
import { alertasSchema, type Permissao } from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco } from '../db/banco';
import { SQL_EXIGIDOS } from '../treinamentos/treinamentos.service';

/**
 * Controle do ASO periódico de cada vínculo ativo ou afastado: vale o último ASO
 * não cancelado que não seja demissional nem de monitoração pontual.
 * Situação: sem_aso, sem_vencimento, vencido, vencendo, em_dia.
 */
const SQL_ASO_CONTROLE = `
  SELECT * FROM (
    SELECT v.id AS vinculo_id, v.funcionario_id, v.empresa_id, fn.nome AS funcionario_nome, v.matricula,
           ult.id AS aso_id, ult.tipo, ult.data_exame, ult.vencimento,
           CASE
             WHEN ult.id IS NULL THEN 'sem_aso'
             WHEN ult.vencimento IS NULL THEN 'sem_vencimento'
             WHEN ult.vencimento < current_date THEN 'vencido'
             WHEN ult.vencimento <= current_date + (SELECT max(d) FROM tenant_config c, unnest(c.alertas_dias) d) THEN 'vencendo'
             ELSE 'em_dia'
           END AS situacao,
           (ult.vencimento - current_date) AS dias_para_vencer
      FROM vinculo v
      JOIN vinculo_situacao s ON s.vinculo_id = v.id AND s.situacao IN ('ativo', 'afastado')
      JOIN funcionario fn ON fn.id = v.funcionario_id
      LEFT JOIN LATERAL (
        SELECT a.id, a.tipo, a.data_exame, a.vencimento FROM aso a
         WHERE a.vinculo_id = v.id AND a.cancelado_em IS NULL AND a.tipo NOT IN (4, 9)
         ORDER BY a.data_exame DESC, a.criado_em DESC LIMIT 1
      ) ult ON true
  ) x`;

/** Empresas em que o usuário tem a permissão (null = todas). */
function limite(u: Usuario, p: Permissao): string[] | null {
  const e = u.empresasCom(p);
  return e === '*' ? null : e;
}

@Injectable()
export class VencimentosService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  config(u: Usuario) {
    return this.banco.tx(u.ctx(), async (tx) =>
      (await tx.one('SELECT alertas_dias AS "alertasDias" FROM tenant_config'))!,
    );
  }

  salvarConfig(u: Usuario, corpo: unknown) {
    const d = validar(alertasSchema, corpo);
    return this.banco.tx(u.ctx('config_alertas'), async (tx) =>
      (await tx.one('UPDATE tenant_config SET alertas_dias = $1 RETURNING alertas_dias AS "alertasDias"', [d.alertasDias]))!,
    );
  }

  /**
   * Lista de pendências e vencimentos com a faixa de alerta de cada uma:
   * faixa = menor prazo configurado que já foi alcançado (ex.: faltam 20 dias → faixa 30).
   */
  async listar(u: Usuario, f: { empresaId?: string; tipo?: 'aso' | 'treinamento'; incluirEmDia?: boolean }) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const dias: number[] = (await tx.one('SELECT alertas_dias AS d FROM tenant_config'))!.d;
      const faixa = (n: number | null) => (n === null || n < 0 ? null : [...dias].sort((a, b) => a - b).find((d) => n <= d) ?? null);
      const filtro = `WHERE ($1::uuid IS NULL OR x.empresa_id = $1) AND ($2 OR x.situacao NOT IN ('em_dia'))`;
      const itens: any[] = [];
      if (f.tipo !== 'treinamento' && u.pode('saude.ler', f.empresaId)) {
        const r = await tx.query(
          `SELECT x.*, e.razao_social AS empresa FROM (${SQL_ASO_CONTROLE}) x JOIN empresa e ON e.id = x.empresa_id
            ${filtro} AND ($3::uuid[] IS NULL OR x.empresa_id = ANY($3))
            ORDER BY x.dias_para_vencer NULLS FIRST, x.funcionario_nome`,
          [f.empresaId ?? null, !!f.incluirEmDia, limite(u, 'saude.ler')],
        );
        for (const a of r)
          itens.push({
            tipo: 'aso', descricao: 'ASO periódico', funcionarioId: a.funcionario_id, funcionarioNome: a.funcionario_nome,
            matricula: a.matricula, empresaId: a.empresa_id, empresa: a.empresa, referenciaId: a.aso_id,
            vencimento: a.vencimento, diasParaVencer: a.dias_para_vencer, situacao: a.situacao, faixa: faixa(a.dias_para_vencer),
          });
      }
      if (f.tipo !== 'aso' && u.pode('treinamentos.ler', f.empresaId)) {
        const r = await tx.query(
          `SELECT x.*, e.razao_social AS empresa FROM (${SQL_EXIGIDOS}) x JOIN empresa e ON e.id = x.empresa_id
            ${filtro} AND ($3::uuid[] IS NULL OR x.empresa_id = ANY($3))
            ORDER BY x.dias_para_vencer NULLS FIRST, x.funcionario_nome`,
          [f.empresaId ?? null, !!f.incluirEmDia, limite(u, 'treinamentos.ler')],
        );
        for (const t of r)
          itens.push({
            tipo: 'treinamento', descricao: [t.treinamento_nome, t.norma].filter(Boolean).join(' · '),
            funcionarioId: t.funcionario_id, funcionarioNome: t.funcionario_nome, matricula: t.matricula,
            empresaId: t.empresa_id, empresa: t.empresa, referenciaId: t.treinamento_id,
            vencimento: t.validade, diasParaVencer: t.dias_para_vencer, situacao: t.situacao, faixa: faixa(t.dias_para_vencer),
          });
      }
      const resumo: Record<string, Record<string, number>> = {};
      for (const i of itens) {
        resumo[i.tipo] ??= {};
        resumo[i.tipo]![i.situacao] = (resumo[i.tipo]![i.situacao] ?? 0) + 1;
      }
      return { alertasDias: dias, resumo, itens };
    });
  }
}
