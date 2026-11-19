import { Inject, Injectable } from '@nestjs/common';
import {
  conclusaoInspecaoSchema, encerramentoOcorrenciaSchema, inspecaoEdicaoSchema, inspecaoItemSchema, inspecaoSchema, investigacaoSchema,
  ocorrenciaEdicaoSchema, ocorrenciaSchema,
} from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';
import { erro, naoEncontrado, proximoCodigo, referencia } from './comum';

const SELECT_INSPECAO = `
  SELECT i.id, i.codigo, i.empresa_id AS "empresaId", e.razao_social AS "empresaNome",
         i.estabelecimento_id AS "estabelecimentoId", es.nome AS "estabelecimentoNome", i.setor_id AS "setorId", s.nome AS "setorNome",
         i.data, i.tipo, i.responsavel_nome AS "responsavelNome", i.escopo, i.conclusao, i.situacao, i.concluida_em AS "concluidaEm",
         (SELECT count(*) FROM inspecao_item x WHERE x.inspecao_id = i.id)::int AS itens,
         (SELECT count(*) FROM inspecao_item x WHERE x.inspecao_id = i.id AND x.resultado = 'nao_conforme')::int AS "naoConformes",
         (SELECT count(*) FROM acao a JOIN inspecao_item x ON x.id = a.inspecao_item_id WHERE x.inspecao_id = i.id)::int AS acoes
    FROM inspecao i
    JOIN empresa e ON e.id = i.empresa_id
    JOIN estabelecimento es ON es.id = i.estabelecimento_id
    LEFT JOIN setor s ON s.id = i.setor_id`;

const SELECT_OCORRENCIA = `
  SELECT o.id, o.codigo, o.empresa_id AS "empresaId", e.razao_social AS "empresaNome",
         o.estabelecimento_id AS "estabelecimentoId", es.nome AS "estabelecimentoNome", o.setor_id AS "setorId", s.nome AS "setorNome",
         o.funcionario_id AS "funcionarioId", f.nome AS "funcionarioNome",
         to_char(o.data_hora, 'YYYY-MM-DD"T"HH24:MI') AS "dataHora",
         o.tipo, o.gravidade, o.local, o.descricao, o.medidas_imediatas AS "medidasImediatas", o.houve_afastamento AS "houveAfastamento",
         o.investigacao, o.investigacao_responsavel AS "investigacaoResponsavel", o.investigacao_concluida_em AS "investigacaoConcluidaEm",
         o.situacao, o.encerrada_em AS "encerradaEm",
         (SELECT count(*) FROM acao a WHERE a.ocorrencia_id = o.id)::int AS acoes
    FROM ocorrencia o
    JOIN empresa e ON e.id = o.empresa_id
    JOIN estabelecimento es ON es.id = o.estabelecimento_id
    LEFT JOIN setor s ON s.id = o.setor_id
    LEFT JOIN funcionario f ON f.id = o.funcionario_id`;

@Injectable()
export class InspecoesService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  private filtro(u: Usuario, f: { empresaId?: string; situacao?: string }, alias: string) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (f.empresaId) {
      params.push(f.empresaId);
      cond.push(`${alias}.empresa_id = $${params.length}`);
    }
    if (f.situacao) {
      params.push(f.situacao.split(','));
      cond.push(`${alias}.situacao = ANY($${params.length}::text[])`);
    }
    const permitidas = u.empresasCom('inspecoes.ler');
    if (permitidas !== '*') {
      params.push(permitidas);
      cond.push(`${alias}.empresa_id = ANY($${params.length}::uuid[])`);
    }
    return { params, where: cond.length ? `WHERE ${cond.join(' AND ')}` : '' };
  }

  // ---------------------------------------------------------------- inspeções

  listarInspecoes(u: Usuario, f: { empresaId?: string; situacao?: string }) {
    const { params, where } = this.filtro(u, f, 'i');
    return this.banco.tx(u.ctx(), (tx) => tx.query(`${SELECT_INSPECAO} ${where} ORDER BY i.data DESC, i.codigo DESC`, params));
  }

  obterInspecao(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), (tx) => this.inspecaoTx(u, tx, id));
  }

  private async inspecaoTx(u: Usuario, tx: Tx, id: string) {
    const i = await tx.one(`${SELECT_INSPECAO} WHERE i.id = $1`, [id]);
    if (!i) throw naoEncontrado('Inspeção');
    u.exigir('inspecoes.ler', i.empresaId);
    const itens = await tx.query(
      `SELECT x.id, x.ordem, x.descricao, x.resultado, x.observacao, x.setor_id AS "setorId", s.nome AS "setorNome",
              coalesce((SELECT json_agg(json_build_object('id', a.id, 'codigo', a.codigo, 'situacao', a.situacao, 'prazo', a.prazo)
                                        ORDER BY a.codigo)
                          FROM acao a WHERE a.inspecao_item_id = x.id), '[]') AS acoes
         FROM inspecao_item x LEFT JOIN setor s ON s.id = x.setor_id
        WHERE x.inspecao_id = $1 ORDER BY x.ordem`, [id]);
    return { ...i, itensLista: itens };
  }

  private async inspecaoAberta(u: Usuario, tx: Tx, id: string) {
    const i = await tx.one('SELECT id, empresa_id, situacao, data FROM inspecao WHERE id = $1 FOR UPDATE', [id]);
    if (!i) throw naoEncontrado('Inspeção');
    u.exigir('inspecoes.editar', i.empresa_id);
    if (i.situacao !== 'aberta') throw erro('Inspeção concluída não pode ser alterada');
    return i;
  }

  async criarInspecao(u: Usuario, corpo: unknown) {
    const d = validar(inspecaoSchema, corpo);
    u.exigir('inspecoes.editar', d.empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [d.empresaId]))) throw erro('Empresa não encontrada');
      if (d.data > (await referencia(tx)).hoje) throw erro('A inspeção não pode ter data futura');
      const codigo = await proximoCodigo(tx, 'IN');
      const r = await tx.one(
        `INSERT INTO inspecao (tenant_id, empresa_id, codigo, estabelecimento_id, setor_id, data, tipo, responsavel_nome, escopo,
                               criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, app.usuario_atual(), app.usuario_atual()) RETURNING id`,
        [d.empresaId, codigo, d.estabelecimentoId, d.setorId, d.data, d.tipo, d.responsavelNome, d.escopo]);
      return this.inspecaoTx(u, tx, r!.id);
    });
  }

  async atualizarInspecao(u: Usuario, id: string, corpo: unknown) {
    const d = validar(inspecaoEdicaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.inspecaoAberta(u, tx, id);
      if (d.data > (await referencia(tx)).hoje) throw erro('A inspeção não pode ter data futura');
      await tx.query(
        `UPDATE inspecao SET estabelecimento_id = $2, setor_id = $3, data = $4, tipo = $5, responsavel_nome = $6, escopo = $7,
                atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, d.estabelecimentoId, d.setorId, d.data, d.tipo, d.responsavelNome, d.escopo]);
      return this.inspecaoTx(u, tx, id);
    });
  }

  async adicionarItem(u: Usuario, inspecaoId: string, corpo: unknown) {
    const d = validar(inspecaoItemSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const i = await this.inspecaoAberta(u, tx, inspecaoId);
      await tx.query(
        `INSERT INTO inspecao_item (tenant_id, empresa_id, inspecao_id, ordem, descricao, resultado, observacao, setor_id, criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, (SELECT coalesce(max(ordem), 0) + 1 FROM inspecao_item WHERE inspecao_id = $2), $3, $4, $5, $6,
                 app.usuario_atual(), app.usuario_atual())`,
        [i.empresa_id, inspecaoId, d.descricao, d.resultado, d.observacao, d.setorId]);
      return this.inspecaoTx(u, tx, inspecaoId);
    });
  }

  private async itemParaAlterar(u: Usuario, tx: Tx, itemId: string) {
    const x = await tx.one(
      `SELECT x.id, x.inspecao_id, x.resultado, EXISTS (SELECT 1 FROM acao a WHERE a.inspecao_item_id = x.id) AS "temAcao"
         FROM inspecao_item x WHERE x.id = $1`, [itemId]);
    if (!x) throw naoEncontrado('Item de inspeção');
    await this.inspecaoAberta(u, tx, x.inspecao_id);
    return x;
  }

  async atualizarItem(u: Usuario, itemId: string, corpo: unknown) {
    const d = validar(inspecaoItemSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const x = await this.itemParaAlterar(u, tx, itemId);
      if (x.temAcao && d.resultado !== 'nao_conforme') throw erro('Este item já gerou ação; ele continua não conforme');
      await tx.query(
        `UPDATE inspecao_item SET descricao = $2, resultado = $3, observacao = $4, setor_id = $5, atualizado_por = app.usuario_atual()
          WHERE id = $1`, [itemId, d.descricao, d.resultado, d.observacao, d.setorId]);
      return this.inspecaoTx(u, tx, x.inspecao_id);
    });
  }

  async removerItem(u: Usuario, itemId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const x = await this.itemParaAlterar(u, tx, itemId);
      if (x.temAcao) throw erro('Este item já gerou ação e não pode ser removido');
      await tx.query('DELETE FROM inspecao_item WHERE id = $1', [itemId]);
      return this.inspecaoTx(u, tx, x.inspecao_id);
    });
  }

  async concluirInspecao(u: Usuario, id: string, corpo: unknown) {
    const d = validar(conclusaoInspecaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const i = await this.inspecaoAberta(u, tx, id);
      const n = await tx.one('SELECT count(*)::int AS n FROM inspecao_item WHERE inspecao_id = $1', [id]);
      if (!n!.n) throw erro('Registre pelo menos um item verificado antes de concluir');
      if (d.data < i.data) throw erro('A conclusão não pode ser antes da data da inspeção');
      if (d.data > (await referencia(tx)).hoje) throw erro('A conclusão não pode ter data futura');
      await tx.query(
        `UPDATE inspecao SET situacao = 'concluida', concluida_em = $2, conclusao = $3, atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, d.data, d.conclusao]);
      return this.inspecaoTx(u, tx, id);
    });
  }

  // ---------------------------------------------------------------- ocorrências

  listarOcorrencias(u: Usuario, f: { empresaId?: string; situacao?: string }) {
    const { params, where } = this.filtro(u, f, 'o');
    return this.banco.tx(u.ctx(), (tx) => tx.query(`${SELECT_OCORRENCIA} ${where} ORDER BY o.data_hora DESC`, params));
  }

  obterOcorrencia(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), (tx) => this.ocorrenciaTx(u, tx, id));
  }

  private async ocorrenciaTx(u: Usuario, tx: Tx, id: string) {
    const o = await tx.one(`${SELECT_OCORRENCIA} WHERE o.id = $1`, [id]);
    if (!o) throw naoEncontrado('Ocorrência');
    u.exigir('inspecoes.ler', o.empresaId);
    return o;
  }

  private async ocorrenciaAberta(u: Usuario, tx: Tx, id: string) {
    const o = await tx.one('SELECT id, empresa_id, situacao, data_hora::date::text AS dia, investigacao FROM ocorrencia WHERE id = $1 FOR UPDATE', [id]);
    if (!o) throw naoEncontrado('Ocorrência');
    u.exigir('inspecoes.editar', o.empresa_id);
    if (o.situacao === 'encerrada') throw erro('Ocorrência encerrada não pode ser alterada');
    return o;
  }

  private async conferirDataHora(tx: Tx, dataHora: string) {
    const futura = await tx.one(`SELECT $1::timestamptz > now() AS f`, [dataHora]);
    if (futura!.f) throw erro('A ocorrência não pode ter data futura');
  }

  async criarOcorrencia(u: Usuario, corpo: unknown) {
    const d = validar(ocorrenciaSchema, corpo);
    u.exigir('inspecoes.editar', d.empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [d.empresaId]))) throw erro('Empresa não encontrada');
      await this.conferirDataHora(tx, d.dataHora);
      const codigo = await proximoCodigo(tx, 'OC');
      const r = await tx.one(
        `INSERT INTO ocorrencia (tenant_id, empresa_id, codigo, estabelecimento_id, setor_id, funcionario_id, data_hora, tipo, gravidade,
                                 local, descricao, medidas_imediatas, houve_afastamento, criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11, $12,
                 app.usuario_atual(), app.usuario_atual()) RETURNING id`,
        [d.empresaId, codigo, d.estabelecimentoId, d.setorId, d.funcionarioId, d.dataHora, d.tipo, d.gravidade, d.local, d.descricao,
         d.medidasImediatas, d.houveAfastamento]);
      return this.ocorrenciaTx(u, tx, r!.id);
    });
  }

  async atualizarOcorrencia(u: Usuario, id: string, corpo: unknown) {
    const d = validar(ocorrenciaEdicaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.ocorrenciaAberta(u, tx, id);
      await this.conferirDataHora(tx, d.dataHora);
      await tx.query(
        `UPDATE ocorrencia SET estabelecimento_id = $2, setor_id = $3, funcionario_id = $4,
                data_hora = $5::timestamptz, tipo = $6, gravidade = $7, local = $8, descricao = $9,
                medidas_imediatas = $10, houve_afastamento = $11, atualizado_por = app.usuario_atual()
          WHERE id = $1`,
        [id, d.estabelecimentoId, d.setorId, d.funcionarioId, d.dataHora, d.tipo, d.gravidade, d.local, d.descricao, d.medidasImediatas,
         d.houveAfastamento]);
      return this.ocorrenciaTx(u, tx, id);
    });
  }

  async investigacao(u: Usuario, id: string, corpo: unknown) {
    const d = validar(investigacaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const o = await this.ocorrenciaAberta(u, tx, id);
      if (d.concluidaEm) {
        if (d.concluidaEm < o.dia) throw erro('A investigação não pode terminar antes da ocorrência');
        if (d.concluidaEm > (await referencia(tx)).hoje) throw erro('A conclusão da investigação não pode ter data futura');
      }
      await tx.query(
        `UPDATE ocorrencia SET investigacao = $2, investigacao_responsavel = $3, investigacao_concluida_em = $4,
                situacao = 'em_investigacao', atualizado_por = app.usuario_atual()
          WHERE id = $1`, [id, d.investigacao, d.responsavel, d.concluidaEm]);
      return this.ocorrenciaTx(u, tx, id);
    });
  }

  async encerrarOcorrencia(u: Usuario, id: string, corpo: unknown) {
    const d = validar(encerramentoOcorrenciaSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const o = await this.ocorrenciaAberta(u, tx, id);
      const r = await tx.one('SELECT investigacao_concluida_em AS c FROM ocorrencia WHERE id = $1', [id]);
      if (!o.investigacao || !r!.c) throw erro('Conclua e registre a investigação antes de encerrar a ocorrência');
      if (d.data < r!.c) throw erro('O encerramento não pode ser antes da conclusão da investigação');
      if (d.data > (await referencia(tx)).hoje) throw erro('O encerramento não pode ter data futura');
      await tx.query(`UPDATE ocorrencia SET situacao = 'encerrada', encerrada_em = $2, atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, d.data]);
      return this.ocorrenciaTx(u, tx, id);
    });
  }
}
