import { Inject, Injectable } from '@nestjs/common';
import { AcoesService } from '../acoes/acoes.service';
import { ConformidadeService } from '../acoes/conformidade.service';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { Banco } from '../db/banco';
import { DocumentosService } from '../documentos/documentos.service';
import { VencimentosService } from '../saude/vencimentos.service';

/** Meses (AAAA-MM) do período, do mais antigo para o atual. */
function mesesAte(hoje: string, n: number): string[] {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * Indicadores do painel executivo, todos calculados dos registros atuais.
 * Cada bloco só vem para quem pode ler o módulo.
 */
@Injectable()
export class IndicadoresService {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    private readonly vencimentos: VencimentosService,
    private readonly documentos: DocumentosService,
    private readonly acoes: AcoesService,
    private readonly conformidade: ConformidadeService,
  ) {}

  async indicadores(u: Usuario, f: { empresaId?: string; meses: number }) {
    const emp = f.empresaId ?? null;
    const hoje: string = (await this.banco.tx(u.ctx(), (tx) => tx.one('SELECT current_date::text AS d')))!.d;
    const meses = mesesAte(hoje, f.meses);
    const desde = `${meses[0]}-01`;
    const serie = (linhas: { mes: string; chave: string; n: number }[], chaves: string[]) =>
      meses.map((mes) => ({ mes, ...Object.fromEntries(chaves.map((c) => [c, linhas.find((l) => l.mes === mes && l.chave === c)?.n ?? 0])) }));
    const limite = (p: Parameters<Usuario['empresasCom']>[0]) => { const e = u.empresasCom(p); return e === '*' ? null : e; };
    const r: Record<string, unknown> = { hoje, meses };

    if (u.pode('saude.ler', f.empresaId) || u.pode('treinamentos.ler', f.empresaId)) {
      const v = await this.vencimentos.listar(u, { empresaId: f.empresaId, incluirEmDia: true });
      r.saude = v.resumo;
    }
    if (u.pode('documentos.ler', f.empresaId)) r.documentos = (await this.documentos.listar(u, { empresaId: f.empresaId })).resumo;
    if (u.pode('acoes.ler', f.empresaId)) {
      r.acoes = (await this.acoes.listar(u, { empresaId: f.empresaId })).resumo;
      r.acoesPorMes = await this.banco.tx(u.ctx(), async (tx) => serie(await tx.query(
        `SELECT to_char(criado_em, 'YYYY-MM') AS mes, 'abertas' AS chave, count(*)::int AS n FROM acao
          WHERE criado_em >= $1 AND ($2::uuid IS NULL OR empresa_id = $2) AND ($3::uuid[] IS NULL OR empresa_id = ANY($3)) GROUP BY 1
         UNION ALL
         SELECT to_char(concluida_em, 'YYYY-MM'), 'concluidas', count(*)::int FROM acao
          WHERE concluida_em >= $1 AND ($2::uuid IS NULL OR empresa_id = $2) AND ($3::uuid[] IS NULL OR empresa_id = ANY($3)) GROUP BY 1`,
        [desde, emp, limite('acoes.ler')]), ['abertas', 'concluidas']));
    }
    if (u.pode('inspecoes.ler', f.empresaId)) {
      r.ocorrenciasPorMes = await this.banco.tx(u.ctx(), async (tx) => {
        const p = [desde, emp, limite('inspecoes.ler')];
        const cond = `data_hora >= $1 AND ($2::uuid IS NULL OR empresa_id = $2) AND ($3::uuid[] IS NULL OR empresa_id = ANY($3))`;
        const porMes = serie(await tx.query(
          `SELECT to_char(data_hora, 'YYYY-MM') AS mes,
                  CASE WHEN tipo IN ('acidente_tipico', 'acidente_trajeto', 'doenca_ocupacional') THEN 'acidentes'
                       WHEN tipo IN ('incidente', 'quase_acidente') THEN 'incidentes' ELSE 'outras' END AS chave, count(*)::int AS n
             FROM ocorrencia WHERE ${cond} GROUP BY 1, 2`, p), ['acidentes', 'incidentes', 'outras']);
        const t = await tx.one(
          `SELECT count(*) FILTER (WHERE tipo IN ('acidente_tipico', 'acidente_trajeto', 'doenca_ocupacional'))::int AS acidentes,
                  count(*) FILTER (WHERE houve_afastamento)::int AS "comAfastamento",
                  count(*) FILTER (WHERE gravidade IN ('grave', 'fatal'))::int AS graves,
                  count(*) FILTER (WHERE situacao <> 'encerrada')::int AS abertas,
                  (SELECT (current_date - max(data_hora)::date) FROM ocorrencia
                    WHERE tipo IN ('acidente_tipico', 'doenca_ocupacional') AND houve_afastamento
                      AND ($2::uuid IS NULL OR empresa_id = $2) AND ($3::uuid[] IS NULL OR empresa_id = ANY($3)))::int AS "diasSemAfastamento"
             FROM ocorrencia WHERE ${cond}`, p);
        return { porMes, ...t };
      });
    }
    if (u.pode('esocial.ler', f.empresaId)) {
      r.esocial = await this.banco.tx(u.ctx(), async (tx) => {
        const p = [emp, limite('esocial.ler')];
        const cond = `($1::uuid IS NULL OR empresa_id = $1) AND ($2::uuid[] IS NULL OR empresa_id = ANY($2))`;
        const sit = await tx.query(`SELECT situacao, count(*)::int AS n FROM esocial_evento WHERE ${cond} GROUP BY situacao`, p);
        const proc = serie(await tx.query(
          `SELECT to_char(processado_em, 'YYYY-MM') AS mes, tipo AS chave, count(*)::int AS n FROM esocial_evento
            WHERE situacao IN ('processado', 'excluido') AND processado_em >= $3 AND ${cond} GROUP BY 1, 2`, [...p, desde]),
        ['S-2210', 'S-2220', 'S-2240', 'S-3000']);
        return { porSituacao: Object.fromEntries(sit.map((s) => [s.situacao, s.n])), processadosPorMes: proc };
      });
    }
    if (u.pode('conformidade.ler', f.empresaId)) {
      if (f.empresaId) {
        const m = await this.conformidade.matriz(u, f.empresaId, null);
        r.conformidade = { empresas: [{ id: f.empresaId, razaoSocial: m.empresa.razaoSocial, percentual: m.resumo.percentual }], resumo: m.resumo };
      } else {
        const v = await this.conformidade.visaoEmpresas(u);
        r.conformidade = { empresas: v.empresas.map((e) => ({ id: e.id, razaoSocial: e.razaoSocial, percentual: e.percentual })), classes: v.resumo };
      }
    }
    return r;
  }
}
