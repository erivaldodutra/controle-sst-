import { Inject, Injectable } from '@nestjs/common';
import {
  classificarEmpresa, conformidadeSchema, percentualConformidade, requisitoSchema, situacaoConformidade, SITUACOES_CONFORMIDADE,
  sugerirAplicabilidade, type SituacaoConformidade, type SituacaoDocumento,
} from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';
import { DocumentosService } from '../documentos/documentos.service';
import { erro, naoEncontrado, referencia } from './comum';

const COLS_REQ = `r.id, r.titulo, r.fundamentacao, r.descricao, r.documento_tipo_id AS "documentoTipoId",
  t.sigla AS "documentoTipoSigla", t.nome AS "documentoTipoNome",
  r.sugestao_graus_risco::int[] AS "sugestaoGrausRisco", r.sugestao_cnae_prefixos AS "sugestaoCnaePrefixos",
  r.sugestao_min_empregados AS "sugestaoMinEmpregados", r.ativo`;

const COLS_CONF = `c.id, c.empresa_id AS "empresaId", c.estabelecimento_id AS "estabelecimentoId", c.requisito_id AS "requisitoId",
  c.aplicabilidade, c.aplicabilidade_justificativa AS "justificativa", c.aplicabilidade_em AS "aplicabilidadeEm", ua.nome AS "aplicabilidadePor",
  c.avaliacao, c.avaliacao_em AS "avaliacaoEm", uv.nome AS "avaliadoPor", c.responsavel_nome AS "responsavelNome", c.pendencias,
  c.prazo, c.observacoes`;

type Empresa = { id: string; razaoSocial: string; grauRisco: number | null; cnaes: string[]; empregados: number };

@Injectable()
export class ConformidadeService {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    private readonly documentos: DocumentosService,
  ) {}

  // ---------------------------------------------------------------- requisitos

  listarRequisitos(u: Usuario, inativos: boolean) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(`SELECT ${COLS_REQ} FROM requisito r LEFT JOIN documento_tipo t ON t.id = r.documento_tipo_id
                 ${inativos ? '' : 'WHERE r.ativo'} ORDER BY r.titulo`));
  }

  private async conferirTipo(tx: Tx, tipoId: string | null) {
    if (tipoId && !(await tx.one('SELECT 1 FROM documento_tipo WHERE id = $1', [tipoId]))) throw erro('Tipo de documento não encontrado');
  }

  private obterRequisito(tx: Tx, id: string) {
    return tx.one(`SELECT ${COLS_REQ} FROM requisito r LEFT JOIN documento_tipo t ON t.id = r.documento_tipo_id WHERE r.id = $1`, [id]);
  }

  criarRequisito(u: Usuario, corpo: unknown) {
    const d = validar(requisitoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.conferirTipo(tx, d.documentoTipoId);
      const r = await tx.one(
        `INSERT INTO requisito (tenant_id, titulo, fundamentacao, descricao, documento_tipo_id, sugestao_graus_risco, sugestao_cnae_prefixos,
                                sugestao_min_empregados, ativo, criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, app.usuario_atual(), app.usuario_atual()) RETURNING id`,
        [d.titulo, d.fundamentacao, d.descricao, d.documentoTipoId, d.sugestaoGrausRisco, d.sugestaoCnaePrefixos, d.sugestaoMinEmpregados,
         d.ativo]);
      return this.obterRequisito(tx, r!.id);
    });
  }

  atualizarRequisito(u: Usuario, id: string, corpo: unknown) {
    const d = validar(requisitoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.conferirTipo(tx, d.documentoTipoId);
      const r = await tx.one(
        `UPDATE requisito SET titulo = $2, fundamentacao = $3, descricao = $4, documento_tipo_id = $5, sugestao_graus_risco = $6,
                sugestao_cnae_prefixos = $7, sugestao_min_empregados = $8, ativo = $9, atualizado_por = app.usuario_atual()
          WHERE id = $1 RETURNING id`,
        [id, d.titulo, d.fundamentacao, d.descricao, d.documentoTipoId, d.sugestaoGrausRisco, d.sugestaoCnaePrefixos,
         d.sugestaoMinEmpregados, d.ativo]);
      if (!r) throw naoEncontrado('Requisito');
      return this.obterRequisito(tx, id);
    });
  }

  /**
   * Cria um requisito para cada tipo de documento ativo que ainda não tem requisito.
   * Sem critérios de sugestão: quem decide se aplica é o profissional, empresa por empresa.
   */
  gerarDosTipos(u: Usuario) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const tipos = await tx.query(
        `SELECT t.id, t.sigla, t.nome, t.base_legal FROM documento_tipo t
          WHERE t.ativo AND NOT EXISTS (SELECT 1 FROM requisito r WHERE r.documento_tipo_id = t.id) ORDER BY coalesce(t.sigla, t.nome)`);
      let incluidos = 0;
      for (const t of tipos) {
        const r = await tx.one(
          `INSERT INTO requisito (tenant_id, titulo, fundamentacao, documento_tipo_id, criado_por, atualizado_por)
           VALUES (app.tenant_atual(), $1, $2, $3, app.usuario_atual(), app.usuario_atual())
           ON CONFLICT (tenant_id, titulo) DO NOTHING RETURNING id`,
          [t.sigla ? `${t.sigla} - ${t.nome}` : t.nome, t.base_legal, t.id]);
        if (r) incluidos++;
      }
      return { incluidos };
    });
  }

  // ---------------------------------------------------------------- cálculo

  private async empresas(tx: Tx, ids: string[]): Promise<Empresa[]> {
    return tx.query(
      `SELECT e.id, e.razao_social AS "razaoSocial", e.grau_risco AS "grauRisco",
              array_remove(e.cnae_principal || e.cnaes_secundarios, NULL) AS cnaes,
              (SELECT count(*) FROM vinculo v WHERE v.empresa_id = e.id
                  AND (v.data_desligamento IS NULL OR v.data_desligamento >= current_date))::int AS empregados
         FROM empresa e WHERE e.id = ANY($1::uuid[]) ORDER BY e.razao_social`, [ids]);
  }

  /** Linhas da matriz de cada empresa (ou de um estabelecimento). */
  private async calcular(tx: Tx, empresas: Empresa[], estabelecimentoId: string | null) {
    const ids = empresas.map((e) => e.id);
    const requisitos = await tx.query(
      `SELECT ${COLS_REQ} FROM requisito r LEFT JOIN documento_tipo t ON t.id = r.documento_tipo_id
        WHERE r.ativo OR EXISTS (SELECT 1 FROM conformidade c WHERE c.requisito_id = r.id AND c.empresa_id = ANY($1::uuid[]))
        ORDER BY r.titulo`, [ids]);
    const avaliacoes = await tx.query(
      `SELECT ${COLS_CONF} FROM conformidade c
         LEFT JOIN usuario ua ON ua.id = c.aplicabilidade_por LEFT JOIN usuario uv ON uv.id = c.avaliado_por
        WHERE c.empresa_id = ANY($1::uuid[]) AND c.estabelecimento_id IS NOT DISTINCT FROM $2`, [ids, estabelecimentoId]);
    const docs = (await this.documentos.situacoesTx(tx, ids))
      .filter((d) => !estabelecimentoId || !d.estabelecimentoId || d.estabelecimentoId === estabelecimentoId);
    const acoes = await tx.query(
      `SELECT conformidade_id AS id, count(*)::int AS abertas, count(*) FILTER (WHERE prazo < current_date)::int AS atrasadas
         FROM acao WHERE conformidade_id IS NOT NULL AND empresa_id = ANY($1::uuid[])
          AND situacao NOT IN ('concluida', 'cancelada') GROUP BY conformidade_id`, [ids]);
    const acoesPor = new Map(acoes.map((a) => [a.id, a]));
    const linhas = new Map<string, any[]>();
    for (const e of empresas) {
      linhas.set(e.id, requisitos.map((r) => {
        const c = avaliacoes.find((x) => x.empresaId === e.id && x.requisitoId === r.id);
        const docsReq = r.documentoTipoId ? docs.filter((d) => d.empresaId === e.id && d.tipoId === r.documentoTipoId) : [];
        const aplicabilidade = c?.aplicabilidade ?? 'a_avaliar';
        const s = situacaoConformidade({
          aplicabilidade, porDocumento: !!r.documentoTipoId, documentos: docsReq.map((d) => d.situacao), avaliacao: c?.avaliacao ?? 'nao_avaliado',
        });
        return {
          requisito: r,
          conformidade: c ?? null,
          aplicabilidade,
          ...s,
          documentos: docsReq.map((d: any) => ({ id: d.id, identificacao: d.identificacao, situacao: d.situacao, estabelecimentoNome: d.estabelecimentoNome })),
          sugestao: aplicabilidade === 'a_avaliar' ? sugerirAplicabilidade(r, e) : null,
          acoesAbertas: (c && acoesPor.get(c.id)?.abertas) ?? 0,
          acoesAtrasadas: (c && acoesPor.get(c.id)?.atrasadas) ?? 0,
        };
      }));
    }
    return { linhas, docs };
  }

  private resumo(linhas: { situacao: SituacaoConformidade; proximo: boolean }[]) {
    const r = Object.fromEntries(Object.keys(SITUACOES_CONFORMIDADE).map((k) => [k, 0])) as Record<SituacaoConformidade, number>;
    for (const l of linhas) r[l.situacao]++;
    return { ...r, proximos: linhas.filter((l) => l.proximo).length, percentual: percentualConformidade(linhas.map((l) => l.situacao)) };
  }

  async matriz(u: Usuario, empresaId: string, estabelecimentoId: string | null) {
    u.exigir('conformidade.ler', empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      const [empresa] = await this.empresas(tx, [empresaId]);
      if (!empresa) throw naoEncontrado('Empresa');
      if (estabelecimentoId) {
        const es = await tx.one('SELECT grau_risco, cnae FROM estabelecimento WHERE id = $1 AND empresa_id = $2', [estabelecimentoId, empresaId]);
        if (!es) throw naoEncontrado('Estabelecimento');
        // Para a sugestão, vale o grau de risco e o CNAE do estabelecimento quando informados.
        if (es.grau_risco) empresa.grauRisco = es.grau_risco;
        if (es.cnae) empresa.cnaes = [es.cnae, ...empresa.cnaes];
      }
      const { linhas } = await this.calcular(tx, [empresa], estabelecimentoId);
      const itens = linhas.get(empresaId)!;
      return { empresa, estabelecimentoId, itens, resumo: this.resumo(itens) };
    });
  }

  /** Grava a aplicabilidade e a avaliação de um requisito numa empresa ou estabelecimento. */
  async salvar(u: Usuario, corpo: unknown) {
    const d = validar(conformidadeSchema, corpo);
    u.exigir('conformidade.editar', d.empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM requisito WHERE id = $1', [d.requisitoId]))) throw erro('Requisito não encontrado');
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [d.empresaId]))) throw erro('Empresa não encontrada');
      if (d.avaliacaoEm && d.avaliacaoEm > (await referencia(tx)).hoje) throw erro('A avaliação não pode ter data futura');
      const atual = await tx.one(
        `SELECT id, aplicabilidade, aplicabilidade_justificativa AS j, avaliacao, avaliacao_em AS em FROM conformidade
          WHERE empresa_id = $1 AND estabelecimento_id IS NOT DISTINCT FROM $2 AND requisito_id = $3 FOR UPDATE`,
        [d.empresaId, d.estabelecimentoId, d.requisitoId]);
      const avaliacaoEm = d.avaliacao === 'nao_avaliado' ? null : d.avaliacaoEm;
      const mudouAplic = !atual || atual.aplicabilidade !== d.aplicabilidade || atual.j !== d.justificativa;
      const mudouAval = !atual || atual.avaliacao !== d.avaliacao || atual.em !== avaliacaoEm;
      if (!atual) {
        await tx.query(
          `INSERT INTO conformidade (tenant_id, empresa_id, estabelecimento_id, requisito_id, aplicabilidade, aplicabilidade_justificativa,
                                     aplicabilidade_em, aplicabilidade_por, avaliacao, avaliacao_em, avaliado_por, responsavel_nome,
                                     pendencias, prazo, observacoes, criado_por, atualizado_por)
           VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, now(), app.usuario_atual(), $6, $7,
                   CASE WHEN $6 = 'nao_avaliado' THEN NULL ELSE app.usuario_atual() END, $8, $9, $10, $11,
                   app.usuario_atual(), app.usuario_atual())`,
          [d.empresaId, d.estabelecimentoId, d.requisitoId, d.aplicabilidade, d.justificativa, d.avaliacao, avaliacaoEm,
           d.responsavelNome, d.pendencias, d.prazo, d.observacoes]);
      } else {
        await tx.query(
          `UPDATE conformidade SET aplicabilidade = $2, aplicabilidade_justificativa = $3,
                  aplicabilidade_em = CASE WHEN $4 THEN now() ELSE aplicabilidade_em END,
                  aplicabilidade_por = CASE WHEN $4 THEN app.usuario_atual() ELSE aplicabilidade_por END,
                  avaliacao = $5, avaliacao_em = $6,
                  avaliado_por = CASE WHEN $5 = 'nao_avaliado' THEN NULL WHEN $7 THEN app.usuario_atual() ELSE avaliado_por END,
                  responsavel_nome = $8, pendencias = $9, prazo = $10, observacoes = $11, atualizado_por = app.usuario_atual()
            WHERE id = $1`,
          [atual.id, d.aplicabilidade, d.justificativa, mudouAplic, d.avaliacao, avaliacaoEm, mudouAval, d.responsavelNome, d.pendencias,
           d.prazo, d.observacoes]);
      }
      const r = await tx.one(
        `SELECT id FROM conformidade WHERE empresa_id = $1 AND estabelecimento_id IS NOT DISTINCT FROM $2 AND requisito_id = $3`,
        [d.empresaId, d.estabelecimentoId, d.requisitoId]);
      return { id: r!.id as string };
    });
  }

  /** Visão consolidada: uma linha por empresa, com a matriz da empresa, documentos e ações. */
  async visaoEmpresas(u: Usuario) {
    const permitidas = u.empresasCom('conformidade.ler');
    return this.banco.tx(u.ctx(), async (tx) => {
      const ids = (await tx.query(
        `SELECT id FROM empresa WHERE ativo ${permitidas === '*' ? '' : 'AND id = ANY($1::uuid[])'}`,
        permitidas === '*' ? [] : [permitidas])).map((r) => r.id as string);
      if (!ids.length) return { empresas: [], resumo: { com_vencidos: 0, com_pendencias: 0, prazos_proximos: 0, regular: 0 } };
      const ref = await referencia(tx);
      const empresas = await this.empresas(tx, ids);
      const { linhas, docs } = await this.calcular(tx, empresas, null);
      const acoes = await tx.query(
        `SELECT empresa_id AS id, count(*)::int AS abertas, count(*) FILTER (WHERE prazo < current_date)::int AS atrasadas,
                count(*) FILTER (WHERE prazo >= current_date AND prazo <= current_date + $2::int)::int AS proximas
           FROM acao WHERE empresa_id = ANY($1::uuid[]) AND situacao NOT IN ('concluida', 'cancelada') GROUP BY empresa_id`,
        [ids, ref.janela]);
      const resumo = { com_vencidos: 0, com_pendencias: 0, prazos_proximos: 0, regular: 0 };
      const lista = empresas.map((e) => {
        const l = linhas.get(e.id)!;
        const r = this.resumo(l);
        const ds = docs.filter((d) => d.empresaId === e.id).map((d) => d.situacao as SituacaoDocumento);
        const ac = acoes.find((a) => a.id === e.id) ?? { abertas: 0, atrasadas: 0, proximas: 0 };
        const n = {
          documentosVencidos: ds.filter((s) => s === 'vencido').length,
          documentosPendentes: ds.filter((s) => s === 'pendente').length,
          documentosProximos: ds.filter((s) => s === 'proximo_revisao' || s === 'proximo_vencimento').length,
          acoesAbertas: ac.abertas, acoesAtrasadas: ac.atrasadas, acoesProximas: ac.proximas,
          naoConformes: r.nao_conforme, parciais: r.parcial, aAvaliar: r.a_avaliar, naoAvaliados: r.nao_avaliado,
        };
        const classe = classificarEmpresa(n);
        resumo[classe]++;
        return { id: e.id, razaoSocial: e.razaoSocial, classe, percentual: r.percentual, conformes: r.conforme, aplicaveis:
          r.conforme + r.parcial + r.nao_conforme + r.nao_avaliado, ...n };
      });
      return { empresas: lista, resumo };
    });
  }
}
