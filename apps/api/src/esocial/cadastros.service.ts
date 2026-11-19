import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { agenteNocivoSchema, atestadoCatSchema, catSchema, responsavelAmbientalSchema, TIPO_ACIDENTE_OCORRENCIA } from '@sst/shared';
import { z } from 'zod';
import { erro, naoEncontrado } from '../acoes/comum';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';

const COLS_AGENTE = `a.id, a.empresa_id AS "empresaId", a.ghe_id AS "gheId", a.codigo, a.descricao, a.tp_aval AS "tpAval",
  a.int_conc::float8 AS "intConc", a.lim_tol::float8 AS "limTol", a.un_med AS "unMed", a.tec_medicao AS "tecMedicao",
  a.nr_proc_jud AS "nrProcJud", a.utiliz_epc AS "utilizEpc", a.efic_epc AS "eficEpc", a.utiliz_epi AS "utilizEpi",
  a.efic_epi AS "eficEpi", a.epis, a.epi_compl AS "epiCompl", a.inicio, a.fim,
  (SELECT t.descricao FROM esocial_tabela t WHERE t.tabela = 24 AND t.codigo = a.codigo LIMIT 1) AS "nomeTabela"`;

const COLS_RESP = `r.id, r.empresa_id AS "empresaId", r.nome, r.cpf, r.ide_oc AS "ideOc", r.dsc_oc AS "dscOc", r.nr_oc AS "nrOc",
  r.uf_oc AS "ufOc", r.inicio, r.fim`;

/** Cadastros que alimentam os eventos: agentes nocivos por GHE, responsáveis ambientais e dados da CAT. */
@Injectable()
export class CadastrosEsocialService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  // ------------------------------------------------------------ tabelas oficiais

  /** Busca nas tabelas oficiais (13, 14, 15, 17, 24, 27) por código ou descrição. */
  tabela(u: Usuario, tabela: number, busca?: string, codigos?: string[]) {
    if (![13, 14, 15, 17, 24, 27].includes(tabela)) throw erro('Tabela não disponível');
    const params: unknown[] = [tabela];
    let filtro = '';
    if (codigos?.length) {
      params.push(codigos);
      filtro = `AND codigo = ANY($2::text[])`;
    } else if (busca) {
      params.push(`%${busca.toLowerCase()}%`);
      filtro = `AND (codigo LIKE $2 OR lower(descricao) LIKE $2 OR translate(lower(descricao), 'áàâãéêíóôõúç', 'aaaaeeiooouc') LIKE translate($2, 'áàâãéêíóôõúç', 'aaaaeeiooouc'))`;
    }
    return this.banco.tx(u.ctx(), (tx) => tx.query(
      `SELECT codigo, descricao, grupo, aplicacao FROM esocial_tabela WHERE tabela = $1 AND fim IS NULL ${filtro} ORDER BY codigo LIMIT 60`, params));
  }

  // ------------------------------------------------------------ agentes nocivos

  listarAgentes(u: Usuario, f: { empresaId?: string; gheId?: string }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (f.empresaId) { params.push(f.empresaId); cond.push(`a.empresa_id = $${params.length}`); }
    if (f.gheId) { params.push(f.gheId); cond.push(`a.ghe_id = $${params.length}`); }
    const perm = u.empresasCom('esocial.ler');
    if (perm !== '*') { params.push(perm); cond.push(`a.empresa_id = ANY($${params.length}::uuid[])`); }
    return this.banco.tx(u.ctx(), (tx) => tx.query(
      `SELECT ${COLS_AGENTE}, g.codigo AS "gheCodigo", g.nome AS "gheNome"
         FROM agente_nocivo a JOIN ghe g ON g.id = a.ghe_id
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
        ORDER BY g.codigo, a.codigo, a.inicio DESC`, params));
  }

  private async conferirCodigo(tx: Tx, tabela: number, codigo: string, rotulo: string) {
    const r = await tx.one('SELECT 1 FROM esocial_tabela WHERE tabela = $1 AND codigo = $2 AND fim IS NULL', [tabela, codigo]);
    if (!r) throw erro(`${rotulo}: código ${codigo} não existe na Tabela ${tabela} do eSocial`);
  }

  private valoresAgente(d: z.infer<typeof agenteNocivoSchema>) {
    return [d.codigo, d.descricao, d.tpAval, d.intConc, d.limTol, d.unMed, d.tecMedicao, d.nrProcJud, d.utilizEpc, d.eficEpc, d.utilizEpi,
      d.eficEpi, d.epis, d.epiCompl, d.inicio, d.fim];
  }

  criarAgente(u: Usuario, body: unknown) {
    const d = validar(agenteNocivoSchema, body);
    return this.banco.tx(u.ctx(), async (tx) => {
      const ghe = await tx.one('SELECT empresa_id FROM ghe WHERE id = $1', [d.gheId]);
      if (!ghe) throw naoEncontrado('GHE');
      u.exigir('esocial.preparar', ghe.empresa_id);
      await this.conferirCodigo(tx, 24, d.codigo, 'Agente nocivo');
      const r = await tx.one(
        `INSERT INTO agente_nocivo (tenant_id, empresa_id, ghe_id, codigo, descricao, tp_aval, int_conc, lim_tol, un_med, tec_medicao, nr_proc_jud,
                                    utiliz_epc, efic_epc, utiliz_epi, efic_epi, epis, epi_compl, inicio, fim, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, app.usuario_atual())
         RETURNING id`, [ghe.empresa_id, d.gheId, ...this.valoresAgente(d)]);
      return tx.one(`SELECT ${COLS_AGENTE} FROM agente_nocivo a WHERE a.id = $1`, [r!.id]);
    });
  }

  atualizarAgente(u: Usuario, id: string, body: unknown) {
    const d = validar(agenteNocivoSchema, body);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await tx.one('SELECT empresa_id, ghe_id FROM agente_nocivo WHERE id = $1 FOR UPDATE', [id]);
      if (!a) throw naoEncontrado('Agente');
      u.exigir('esocial.preparar', a.empresa_id);
      if (a.ghe_id !== d.gheId) throw erro('O GHE do agente não muda; cadastre o agente no outro GHE');
      await this.conferirCodigo(tx, 24, d.codigo, 'Agente nocivo');
      await tx.query(
        `UPDATE agente_nocivo SET codigo = $2, descricao = $3, tp_aval = $4, int_conc = $5, lim_tol = $6, un_med = $7, tec_medicao = $8,
                nr_proc_jud = $9, utiliz_epc = $10, efic_epc = $11, utiliz_epi = $12, efic_epi = $13, epis = $14, epi_compl = $15,
                inicio = $16, fim = $17, atualizado_por = app.usuario_atual()
          WHERE id = $1`, [id, ...this.valoresAgente(d)]);
      return tx.one(`SELECT ${COLS_AGENTE} FROM agente_nocivo a WHERE a.id = $1`, [id]);
    });
  }

  removerAgente(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await tx.one('SELECT empresa_id FROM agente_nocivo WHERE id = $1', [id]);
      if (!a) throw naoEncontrado('Agente');
      u.exigir('esocial.preparar', a.empresa_id);
      await tx.query('DELETE FROM agente_nocivo WHERE id = $1', [id]);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ responsáveis ambientais

  listarResponsaveis(u: Usuario, empresaId: string) {
    u.exigir('esocial.ler', empresaId);
    return this.banco.tx(u.ctx(), (tx) => tx.query(
      `SELECT ${COLS_RESP} FROM responsavel_ambiental r WHERE r.empresa_id = $1 ORDER BY r.fim NULLS FIRST, r.nome`, [empresaId]));
  }

  criarResponsavel(u: Usuario, body: unknown) {
    const d = validar(responsavelAmbientalSchema, body);
    u.exigir('esocial.preparar', d.empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `INSERT INTO responsavel_ambiental (tenant_id, empresa_id, nome, cpf, ide_oc, dsc_oc, nr_oc, uf_oc, inicio, fim, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, app.usuario_atual()) RETURNING id`,
        [d.empresaId, d.nome, d.cpf, d.ideOc, d.dscOc, d.nrOc, d.ufOc, d.inicio, d.fim]);
      return tx.one(`SELECT ${COLS_RESP} FROM responsavel_ambiental r WHERE r.id = $1`, [r!.id]);
    });
  }

  atualizarResponsavel(u: Usuario, id: string, body: unknown) {
    const d = validar(responsavelAmbientalSchema, body);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one('SELECT empresa_id FROM responsavel_ambiental WHERE id = $1 FOR UPDATE', [id]);
      if (!r) throw naoEncontrado('Responsável');
      u.exigir('esocial.preparar', r.empresa_id);
      if (r.empresa_id !== d.empresaId) throw erro('O responsável não muda de empresa');
      await tx.query(
        `UPDATE responsavel_ambiental SET nome = $2, cpf = $3, ide_oc = $4, dsc_oc = $5, nr_oc = $6, uf_oc = $7, inicio = $8, fim = $9,
                atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, d.nome, d.cpf, d.ideOc, d.dscOc, d.nrOc, d.ufOc, d.inicio, d.fim]);
      return tx.one(`SELECT ${COLS_RESP} FROM responsavel_ambiental r WHERE r.id = $1`, [id]);
    });
  }

  // ------------------------------------------------------------ CAT

  /** CATs da ocorrência. O atestado só vem para quem tem acesso clínico na empresa. */
  listarCats(u: Usuario, ocorrenciaId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const o = await tx.one('SELECT empresa_id FROM ocorrencia WHERE id = $1', [ocorrenciaId]);
      if (!o) throw naoEncontrado('Ocorrência');
      u.exigir('esocial.ler', o.empresa_id);
      const clinico = u.pode('saude.clinico', o.empresa_id);
      return tx.query(
        `SELECT c.id, c.ocorrencia_id AS "ocorrenciaId", c.vinculo_id AS "vinculoId", v.matricula, c.tp_cat AS "tpCat", c.dados,
                ${clinico ? 'c.atestado' : 'NULL::jsonb AS atestado'}, (c.atestado IS NOT NULL) AS "temAtestado", c.criado_em AS "criadoEm",
                (SELECT json_build_object('id', e.id, 'situacao', e.situacao, 'nrRecibo', e.nr_recibo)
                   FROM esocial_evento e WHERE e.cat_id = c.id AND e.situacao NOT IN ('cancelado')
                  ORDER BY e.criado_em DESC LIMIT 1) AS evento
           FROM cat c JOIN vinculo v ON v.id = c.vinculo_id
          WHERE c.ocorrencia_id = $1 ORDER BY c.criado_em`, [ocorrenciaId]);
    });
  }

  private async ocorrenciaParaCat(tx: Tx, u: Usuario, ocorrenciaId: string, vinculoId: string) {
    const o = await tx.one(
      `SELECT o.empresa_id, o.tipo, o.funcionario_id, o.houve_afastamento, o.data_hora::date::text AS data
         FROM ocorrencia o WHERE o.id = $1`, [ocorrenciaId]);
    if (!o) throw naoEncontrado('Ocorrência');
    u.exigir('esocial.preparar', o.empresa_id);
    if (!TIPO_ACIDENTE_OCORRENCIA[o.tipo]) throw erro('CAT só para acidente típico, de trajeto ou doença ocupacional');
    if (!o.funcionario_id) throw erro('Informe na ocorrência o funcionário envolvido antes de preencher a CAT');
    const v = await tx.one('SELECT id FROM vinculo WHERE id = $1 AND funcionario_id = $2', [vinculoId, o.funcionario_id]);
    if (!v) throw erro('O vínculo escolhido não é do funcionário da ocorrência');
    return o;
  }

  private async conferirCodigosCat(tx: Tx, d: z.infer<typeof catSchema>) {
    await this.conferirCodigo(tx, 15, d.codSitGeradora, 'Situação geradora');
    await this.conferirCodigo(tx, 13, d.codParteAting, 'Parte atingida');
    const ag = await tx.one(`SELECT 1 FROM esocial_tabela WHERE tabela IN (14, 15) AND codigo = $1 AND fim IS NULL`, [d.codAgntCausador]);
    if (!ag) throw erro(`Agente causador: código ${d.codAgntCausador} não existe nas Tabelas 14 e 15 do eSocial`);
  }

  criarCat(u: Usuario, ocorrenciaId: string, body: unknown) {
    const d = validar(catSchema, body);
    return this.banco.tx(u.ctx(), async (tx) => {
      const o = await this.ocorrenciaParaCat(tx, u, ocorrenciaId, d.vinculoId);
      await this.conferirCodigosCat(tx, d);
      const { vinculoId, tpCat, ...dados } = d;
      const r = await tx.one(
        `INSERT INTO cat (tenant_id, empresa_id, ocorrencia_id, vinculo_id, tp_cat, dados, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual()) RETURNING id`,
        [o.empresa_id, ocorrenciaId, vinculoId, tpCat, dados]);
      return { id: r!.id };
    });
  }

  private async catEditavel(tx: Tx, id: string) {
    const c = await tx.one('SELECT id, empresa_id, ocorrencia_id FROM cat WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw naoEncontrado('CAT');
    const ev = await tx.one(
      `SELECT situacao FROM esocial_evento WHERE cat_id = $1 AND situacao IN ('aprovado', 'enviado', 'processado') LIMIT 1`, [id]);
    if (ev) throw erro('A CAT já foi aprovada ou enviada ao eSocial. Para corrigir, use a retificação do evento S-2210.');
    return c;
  }

  atualizarCat(u: Usuario, id: string, body: unknown) {
    const d = validar(catSchema, body);
    return this.banco.tx(u.ctx(), async (tx) => {
      const c = await this.catEditavel(tx, id);
      await this.ocorrenciaParaCat(tx, u, c.ocorrencia_id, d.vinculoId);
      await this.conferirCodigosCat(tx, d);
      const { vinculoId, tpCat, ...dados } = d;
      await tx.query(`UPDATE cat SET vinculo_id = $2, tp_cat = $3, dados = $4, atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, vinculoId, tpCat, dados]);
      return { id };
    });
  }

  /** Atestado médico (CID, diagnóstico): só com saude.clinico na empresa. */
  gravarAtestado(u: Usuario, id: string, body: unknown) {
    const d = validar(atestadoCatSchema, body);
    return this.banco.tx(u.ctx(), async (tx) => {
      const c = await this.catEditavel(tx, id);
      if (!u.pode('saude.clinico', c.empresa_id) || !u.pode('esocial.preparar', c.empresa_id))
        throw new ForbiddenException({ mensagem: 'O atestado da CAT só pode ser preenchido por quem tem acesso a dados clínicos' });
      await this.conferirCodigo(tx, 17, d.dscLesao, 'Natureza da lesão');
      await tx.query(`UPDATE cat SET atestado = $2, atualizado_por = app.usuario_atual() WHERE id = $1`, [id, d]);
      return { id };
    });
  }
}
