import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  acompanhamentoSchema, aplicabilidadeSchema, BIBLIOTECA_DOCUMENTOS, documentoEdicaoSchema, documentoSchema, documentoTipoSchema,
  mudancaCondicoesSchema, situacaoDocumento, SITUACOES_DOCUMENTO, somarMesesIso, substituicaoDocumentoSchema, versaoSchema,
  type SituacaoDocumento,
} from '@sst/shared';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';
import { conteudoConfere } from '../saude/aso.service';

const erro = (mensagem: string) => new UnprocessableEntityException({ mensagem });
const naoEncontrado = (o = 'Documento') => new NotFoundException({ mensagem: `${o} não encontrado` });

const COLS_TIPO = `id, sigla, nome, base_legal AS "baseLegal", descricao, prazo_revisao_meses AS "prazoRevisaoMeses",
  vencimento_meses AS "vencimentoMeses", monitoramento_meses AS "monitoramentoMeses", reavaliacao_meses AS "reavaliacaoMeses",
  criterio_revisao AS "criterioRevisao", da_biblioteca AS "daBiblioteca", ativo`;

/** Documento com o necessário para calcular a situação. */
const SELECT_DOC = `
  SELECT d.id, d.empresa_id AS "empresaId", e.razao_social AS "empresaNome",
         d.estabelecimento_id AS "estabelecimentoId", es.nome AS "estabelecimentoNome",
         d.tipo_id AS "tipoId", t.sigla AS "tipoSigla", t.nome AS "tipoNome",
         d.identificacao, coalesce(d.base_legal, t.base_legal) AS "baseLegal",
         d.aplicabilidade, d.aplicabilidade_justificativa AS "aplicabilidadeJustificativa", d.aplicabilidade_em AS "aplicabilidadeEm",
         ua.nome AS "aplicabilidadePor",
         d.prazo_revisao_meses AS "prazoRevisaoMeses", d.vencimento_meses AS "vencimentoMeses",
         d.monitoramento_meses AS "monitoramentoMeses", d.reavaliacao_meses AS "reavaliacaoMeses",
         d.criterio_revisao AS "criterioRevisao",
         d.mudanca_condicoes_em AS "mudancaCondicoesEm", d.mudanca_condicoes_motivo AS "mudancaCondicoesMotivo",
         d.substituido_em AS "substituidoEm", d.substituido_por_id AS "substituidoPorId", d.substituicao_motivo AS "substituicaoMotivo",
         sp.identificacao AS "substituidoPorIdentificacao",
         d.observacoes,
         v.id AS "vigenteId", v.numero AS "vigenteNumero", v.data_emissao AS "vigenteEmissao",
         v.data_revisao AS "vigenteRevisao", v.data_vencimento AS "vigenteVencimento", v.data_reavaliacao AS "vigenteReavaliacao",
         v.responsavel_nome AS "vigenteResponsavel", v.arquivo_id AS "vigenteArquivoId",
         EXISTS (SELECT 1 FROM documento_versao r WHERE r.documento_id = d.id AND r.situacao IN ('em_elaboracao','em_revisao')) AS "temRascunho",
         (SELECT max(a.data) FROM documento_acompanhamento a WHERE a.documento_id = d.id) AS "ultimoAcompanhamento"
    FROM documento d
    JOIN empresa e ON e.id = d.empresa_id
    JOIN documento_tipo t ON t.id = d.tipo_id
    LEFT JOIN estabelecimento es ON es.id = d.estabelecimento_id
    LEFT JOIN documento sp ON sp.id = d.substituido_por_id
    LEFT JOIN usuario ua ON ua.id = d.aplicabilidade_por
    LEFT JOIN documento_versao v ON v.documento_id = d.id AND v.situacao = 'vigente'`;

const COLS_VERSAO = `v.id, v.numero, v.situacao, v.responsavel_nome AS "responsavelNome", v.responsavel_registro AS "responsavelRegistro",
  v.responsavel_formacao AS "responsavelFormacao", v.data_elaboracao AS "dataElaboracao", v.data_emissao AS "dataEmissao",
  v.inicio_vigencia AS "inicioVigencia", v.data_revisao AS "dataRevisao", v.data_vencimento AS "dataVencimento",
  v.data_reavaliacao AS "dataReavaliacao", v.descricao_alteracoes AS "descricaoAlteracoes", v.observacoes,
  v.arquivo_id AS "arquivoId", ar.nome AS "arquivoNome", ar.tamanho AS "arquivoTamanho",
  v.publicada_em AS "publicadaEm", up.nome AS "publicadaPor", v.substituida_em AS "substituidaEm",
  v.motivo_cancelamento AS "motivoCancelamento", v.criado_em AS "criadoEm"`;

const TIPOS_ARQUIVO: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export interface FiltroDocumentos {
  empresaId?: string;
  tipoId?: string;
  situacao?: string;
}

@Injectable()
export class DocumentosService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  // ---------------------------------------------------------------- tipos

  listarTipos(u: Usuario, inativos: boolean) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(`SELECT ${COLS_TIPO} FROM documento_tipo ${inativos ? '' : 'WHERE ativo'} ORDER BY coalesce(sigla, nome), nome`));
  }

  criarTipo(u: Usuario, corpo: unknown) {
    const d = validar(documentoTipoSchema, corpo);
    return this.banco.tx(u.ctx(), (tx) =>
      tx.one(
        `INSERT INTO documento_tipo (tenant_id, sigla, nome, base_legal, descricao, prazo_revisao_meses, vencimento_meses,
                                     monitoramento_meses, reavaliacao_meses, criterio_revisao, ativo, criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, app.usuario_atual(), app.usuario_atual())
         RETURNING ${COLS_TIPO}`,
        [d.sigla, d.nome, d.baseLegal, d.descricao, d.prazoRevisaoMeses, d.vencimentoMeses, d.monitoramentoMeses,
         d.reavaliacaoMeses, d.criterioRevisao, d.ativo],
      ));
  }

  async atualizarTipo(u: Usuario, id: string, corpo: unknown) {
    const d = validar(documentoTipoSchema, corpo);
    const r = await this.banco.tx(u.ctx(), (tx) =>
      tx.one(
        `UPDATE documento_tipo SET sigla = $2, nome = $3, base_legal = $4, descricao = $5, prazo_revisao_meses = $6,
                vencimento_meses = $7, monitoramento_meses = $8, reavaliacao_meses = $9, criterio_revisao = $10, ativo = $11,
                atualizado_por = app.usuario_atual()
          WHERE id = $1 RETURNING ${COLS_TIPO}`,
        [id, d.sigla, d.nome, d.baseLegal, d.descricao, d.prazoRevisaoMeses, d.vencimentoMeses, d.monitoramentoMeses,
         d.reavaliacaoMeses, d.criterioRevisao, d.ativo],
      ));
    if (!r) throw naoEncontrado('Tipo de documento');
    return r;
  }

  /** Inclui os tipos da biblioteca sugerida que ainda não existem (pelo nome). Nunca altera os existentes. */
  carregarBiblioteca(u: Usuario) {
    return this.banco.tx(u.ctx(), async (tx) => {
      let incluidos = 0;
      for (const t of BIBLIOTECA_DOCUMENTOS) {
        const r = await tx.one(
          `INSERT INTO documento_tipo (tenant_id, sigla, nome, base_legal, prazo_revisao_meses, vencimento_meses,
                                       monitoramento_meses, criterio_revisao, da_biblioteca, criado_por, atualizado_por)
           VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, true, app.usuario_atual(), app.usuario_atual())
           ON CONFLICT (tenant_id, nome) DO NOTHING RETURNING id`,
          [t.sigla, t.nome, t.baseLegal, t.prazoRevisaoMeses ?? null, t.vencimentoMeses ?? null, t.monitoramentoMeses ?? null,
           t.criterioRevisao ?? null],
        );
        if (r) incluidos++;
      }
      return { incluidos };
    });
  }

  // ---------------------------------------------------------------- situação

  private async referencia(tx: Tx) {
    const r = await tx.one(
      `SELECT current_date::text AS hoje, (SELECT max(d) FROM tenant_config c, unnest(c.alertas_dias) d) AS janela`,
    );
    return { hoje: r!.hoje as string, janela: Number(r!.janela ?? 90) };
  }

  private comSituacao(d: any, ref: { hoje: string; janela: number }) {
    const s = situacaoDocumento({
      aplicabilidade: d.aplicabilidade, substituidoEm: d.substituidoEm, mudancaCondicoesEm: d.mudancaCondicoesEm,
      mudancaCondicoesMotivo: d.mudancaCondicoesMotivo, monitoramentoMeses: d.monitoramentoMeses,
      ultimoAcompanhamento: d.ultimoAcompanhamento, temRascunho: d.temRascunho,
      vigente: d.vigenteId ? {
        dataEmissao: d.vigenteEmissao, dataRevisao: d.vigenteRevisao, dataVencimento: d.vigenteVencimento, dataReavaliacao: d.vigenteReavaliacao,
      } : null,
    }, ref.hoje, ref.janela);
    const proximo = s.prazos.filter((p) => p.estado !== 'em_dia').sort((a, b) => a.dias - b.dias)[0]
      ?? [...s.prazos].sort((a, b) => a.dias - b.dias)[0] ?? null;
    return { ...d, ...s, proximoPrazo: proximo };
  }

  /**
   * Situação dos documentos das empresas indicadas, dentro de uma transação já aberta
   * (usada pela matriz de conformidade). O RLS da transação continua valendo.
   */
  async situacoesTx(tx: Tx, empresaIds: string[]) {
    const ref = await this.referencia(tx);
    const linhas = await tx.query(`${SELECT_DOC} WHERE d.empresa_id = ANY($1::uuid[])`, [empresaIds]);
    return linhas.map((d) => this.comSituacao(d, ref)) as {
      id: string; empresaId: string; estabelecimentoId: string | null; tipoId: string; situacao: SituacaoDocumento;
    }[];
  }

  private restricao(u: Usuario, params: unknown[], cond: string[]) {
    const permitidas = u.empresasCom('documentos.ler');
    if (permitidas !== '*') {
      params.push(permitidas);
      cond.push(`d.empresa_id = ANY($${params.length}::uuid[])`);
    }
  }

  async listar(u: Usuario, f: FiltroDocumentos) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (f.empresaId) {
      params.push(f.empresaId);
      cond.push(`d.empresa_id = $${params.length}`);
    }
    if (f.tipoId) {
      params.push(f.tipoId);
      cond.push(`d.tipo_id = $${params.length}`);
    }
    this.restricao(u, params, cond);
    return this.banco.tx(u.ctx(), async (tx) => {
      const ref = await this.referencia(tx);
      const linhas = await tx.query(
        `${SELECT_DOC} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY e.razao_social, coalesce(t.sigla, t.nome), d.identificacao`,
        params,
      );
      const todos = linhas.map((d) => this.comSituacao(d, ref));
      const resumo = Object.fromEntries(Object.keys(SITUACOES_DOCUMENTO).map((k) => [k, 0])) as Record<SituacaoDocumento, number>;
      for (const d of todos) resumo[d.situacao as SituacaoDocumento]++;
      const itens = f.situacao ? todos.filter((d) => d.situacao === f.situacao) : todos;
      return { itens, resumo, alertaDias: ref.janela, hoje: ref.hoje };
    });
  }

  async obter(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), (tx) => this.obterTx(u, tx, id));
  }

  private async obterTx(u: Usuario, tx: Tx, id: string) {
    const d = await tx.one(`${SELECT_DOC} WHERE d.id = $1`, [id]);
    if (!d) throw naoEncontrado();
    u.exigir('documentos.ler', d.empresaId);
    const ref = await this.referencia(tx);
    const versoes = await tx.query(
      `SELECT ${COLS_VERSAO} FROM documento_versao v LEFT JOIN arquivo ar ON ar.id = v.arquivo_id
         LEFT JOIN usuario up ON up.id = v.publicada_por
        WHERE v.documento_id = $1 ORDER BY v.numero DESC`, [id]);
    const acompanhamentos = await tx.query(
      `SELECT a.id, a.data, a.responsavel_nome AS "responsavelNome", a.descricao, a.criado_em AS "criadoEm", uc.nome AS "registradoPor"
         FROM documento_acompanhamento a LEFT JOIN usuario uc ON uc.id = a.criado_por
        WHERE a.documento_id = $1 ORDER BY a.data DESC, a.criado_em DESC`, [id]);
    const substitui = await tx.query(
      `SELECT id, identificacao, substituido_em AS "substituidoEm" FROM documento WHERE substituido_por_id = $1`, [id]);
    return { ...this.comSituacao(d, ref), versoes, acompanhamentos, substitui };
  }

  /** Documento para alteração, travado e com permissão de edição conferida. */
  private async paraEditar(u: Usuario, tx: Tx, id: string) {
    const d = await tx.one('SELECT id, empresa_id, tipo_id, substituido_em FROM documento WHERE id = $1 FOR UPDATE', [id]);
    if (!d) throw naoEncontrado();
    u.exigir('documentos.editar', d.empresa_id);
    return d;
  }

  // ---------------------------------------------------------------- documentos

  async criar(u: Usuario, corpo: unknown) {
    const d = validar(documentoSchema, corpo);
    u.exigir('documentos.editar', d.empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      // Confere sob o RLS do usuário (a chave estrangeira não olha o tenant).
      const tipo = await tx.one(`SELECT ${COLS_TIPO} FROM documento_tipo WHERE id = $1`, [d.tipoId]);
      if (!tipo) throw erro('Tipo de documento não encontrado');
      if (!tipo.ativo) throw erro('Este tipo de documento está desativado');
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [d.empresaId]))) throw erro('Empresa não encontrada');
      const r = d.regras ?? {
        prazoRevisaoMeses: tipo.prazoRevisaoMeses, vencimentoMeses: tipo.vencimentoMeses, monitoramentoMeses: tipo.monitoramentoMeses,
        reavaliacaoMeses: tipo.reavaliacaoMeses, criterioRevisao: tipo.criterioRevisao, baseLegal: null,
      };
      const novo = await tx.one(
        `INSERT INTO documento (tenant_id, empresa_id, estabelecimento_id, tipo_id, identificacao, base_legal, prazo_revisao_meses,
                                vencimento_meses, monitoramento_meses, reavaliacao_meses, criterio_revisao, observacoes,
                                criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, app.usuario_atual(), app.usuario_atual())
         RETURNING id`,
        [d.empresaId, d.estabelecimentoId, d.tipoId, d.identificacao, r.baseLegal, r.prazoRevisaoMeses, r.vencimentoMeses,
         r.monitoramentoMeses, r.reavaliacaoMeses, r.criterioRevisao, d.observacoes],
      );
      return this.obterTx(u, tx, novo!.id);
    });
  }

  async atualizar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(documentoEdicaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.paraEditar(u, tx, id);
      await tx.query(
        `UPDATE documento SET estabelecimento_id = $2, identificacao = $3, observacoes = $4, prazo_revisao_meses = $5,
                vencimento_meses = $6, monitoramento_meses = $7, reavaliacao_meses = $8, criterio_revisao = $9, base_legal = $10,
                atualizado_por = app.usuario_atual()
          WHERE id = $1`,
        [id, d.estabelecimentoId, d.identificacao, d.observacoes, d.prazoRevisaoMeses, d.vencimentoMeses, d.monitoramentoMeses,
         d.reavaliacaoMeses, d.criterioRevisao, d.baseLegal],
      );
      return this.obterTx(u, tx, id);
    });
  }

  async aplicabilidade(u: Usuario, id: string, corpo: unknown) {
    const d = validar(aplicabilidadeSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.paraEditar(u, tx, id);
      await tx.query(
        `UPDATE documento SET aplicabilidade = $2, aplicabilidade_justificativa = $3, aplicabilidade_em = now(),
                aplicabilidade_por = app.usuario_atual(), atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, d.aplicabilidade, d.justificativa],
      );
      return this.obterTx(u, tx, id);
    });
  }

  /** Sinaliza (ou, com corpo nulo, retira) a necessidade de atualização por mudança de condições. */
  async mudancaCondicoes(u: Usuario, id: string, corpo: unknown) {
    const vazio = !corpo || (typeof corpo === 'object' && !Object.keys(corpo).length);
    const d = vazio ? null : validar(mudancaCondicoesSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.paraEditar(u, tx, id);
      await tx.query(
        `UPDATE documento SET mudanca_condicoes_em = $2, mudanca_condicoes_motivo = $3, atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, d?.data ?? null, d?.motivo ?? null],
      );
      return this.obterTx(u, tx, id);
    });
  }

  async substituir(u: Usuario, id: string, corpo: unknown) {
    const d = validar(substituicaoDocumentoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const doc = await this.paraEditar(u, tx, id);
      if (doc.substituido_em) throw erro('Este documento já foi substituído');
      if (d.substitutoId) {
        if (d.substitutoId === id) throw erro('Um documento não pode substituir a si mesmo');
        const s = await tx.one('SELECT empresa_id FROM documento WHERE id = $1', [d.substitutoId]);
        if (!s || s.empresa_id !== doc.empresa_id) throw erro('O documento substituto deve ser da mesma empresa');
      }
      await tx.query(
        `UPDATE documento SET substituido_em = $2, substituicao_motivo = $3, substituido_por_id = $4, atualizado_por = app.usuario_atual()
          WHERE id = $1`,
        [id, d.data, d.motivo, d.substitutoId],
      );
      return this.obterTx(u, tx, id);
    });
  }

  // ---------------------------------------------------------------- versões

  private async versaoParaEditar(u: Usuario, tx: Tx, versaoId: string) {
    const v = await tx.one(
      `SELECT v.id, v.documento_id, v.situacao, v.empresa_id, v.arquivo_id FROM documento_versao v WHERE v.id = $1`, [versaoId]);
    if (!v) throw naoEncontrado('Versão');
    await this.paraEditar(u, tx, v.documento_id);
    const atual = await tx.one('SELECT situacao FROM documento_versao WHERE id = $1 FOR UPDATE', [versaoId]);
    return { ...v, situacao: atual!.situacao as string };
  }

  async criarVersao(u: Usuario, documentoId: string, corpo: unknown) {
    const d = validar(versaoSchema, corpo ?? {});
    return this.banco.tx(u.ctx(), async (tx) => {
      const doc = await this.paraEditar(u, tx, documentoId);
      if (doc.substituido_em) throw erro('Documento substituído não recebe novas versões');
      const r = await tx.one(
        `SELECT coalesce(max(numero), 0) + 1 AS numero, bool_or(situacao = 'vigente') AS "temVigente"
           FROM documento_versao WHERE documento_id = $1`, [documentoId]);
      await tx.query(
        `INSERT INTO documento_versao (tenant_id, empresa_id, documento_id, numero, situacao, responsavel_nome, responsavel_registro,
                                       responsavel_formacao, data_elaboracao, data_emissao, inicio_vigencia, data_revisao,
                                       data_vencimento, data_reavaliacao, descricao_alteracoes, observacoes, criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, app.usuario_atual(), app.usuario_atual())`,
        [doc.empresa_id, documentoId, r!.numero, r!.temVigente ? 'em_revisao' : 'em_elaboracao', d.responsavelNome, d.responsavelRegistro,
         d.responsavelFormacao, d.dataElaboracao, d.dataEmissao, d.inicioVigencia, d.dataRevisao, d.dataVencimento, d.dataReavaliacao,
         d.descricaoAlteracoes, d.observacoes],
      );
      return this.obterTx(u, tx, documentoId);
    });
  }

  /** Rascunho: tudo pode mudar. Vigente: só correção de dados (fica na auditoria). Substituída/cancelada: nada. */
  async atualizarVersao(u: Usuario, versaoId: string, corpo: unknown) {
    const d = validar(versaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const v = await this.versaoParaEditar(u, tx, versaoId);
      if (v.situacao === 'vigente' && (!d.responsavelNome || !d.dataEmissao))
        throw erro('A versão vigente precisa manter o responsável técnico e a data de emissão');
      await tx.query(
        `UPDATE documento_versao SET responsavel_nome = $2, responsavel_registro = $3, responsavel_formacao = $4, data_elaboracao = $5,
                data_emissao = $6, inicio_vigencia = $7, data_revisao = $8, data_vencimento = $9, data_reavaliacao = $10,
                descricao_alteracoes = $11, observacoes = $12, atualizado_por = app.usuario_atual()
          WHERE id = $1`,
        [versaoId, d.responsavelNome, d.responsavelRegistro, d.responsavelFormacao, d.dataElaboracao, d.dataEmissao, d.inicioVigencia,
         d.dataRevisao, d.dataVencimento, d.dataReavaliacao, d.descricaoAlteracoes, d.observacoes],
      );
      return this.obterTx(u, tx, v.documento_id);
    });
  }

  /**
   * Emite o rascunho: vira a versão vigente e a anterior passa a "substituída".
   * Datas de revisão, vencimento e reavaliação não informadas são calculadas pelas regras do documento.
   */
  async publicarVersao(u: Usuario, versaoId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const v0 = await this.versaoParaEditar(u, tx, versaoId);
      if (!['em_elaboracao', 'em_revisao'].includes(v0.situacao)) throw erro('Só uma versão em elaboração ou revisão pode ser emitida');
      const v = await tx.one(
        `SELECT v.responsavel_nome, v.data_emissao, v.data_revisao, v.data_vencimento, v.data_reavaliacao,
                d.prazo_revisao_meses, d.vencimento_meses, d.reavaliacao_meses, d.mudanca_condicoes_em
           FROM documento_versao v JOIN documento d ON d.id = v.documento_id WHERE v.id = $1`, [versaoId]);
      const faltam = [!v.responsavel_nome && 'responsável técnico', !v.data_emissao && 'data de emissão'].filter(Boolean);
      if (faltam.length) throw erro(`Para emitir, informe: ${faltam.join(' e ')}`);
      const calc = (data: string | null, meses: number | null) => data ?? (meses ? somarMesesIso(v.data_emissao, meses) : null);
      const anterior = await tx.one(
        `SELECT id, data_emissao FROM documento_versao WHERE documento_id = $1 AND situacao = 'vigente' FOR UPDATE`, [v0.documento_id]);
      if (anterior && anterior.data_emissao > v.data_emissao)
        throw erro('A emissão da nova versão não pode ser anterior à da versão vigente');
      if (anterior)
        await tx.query(
          `UPDATE documento_versao SET situacao = 'substituida', substituida_em = $2, substituida_por_id = $3, atualizado_por = app.usuario_atual()
            WHERE id = $1`, [anterior.id, v.data_emissao, versaoId]);
      await tx.query(
        `UPDATE documento_versao SET situacao = 'vigente', data_revisao = $2, data_vencimento = $3, data_reavaliacao = $4,
                inicio_vigencia = coalesce(inicio_vigencia, data_emissao), publicada_em = now(), publicada_por = app.usuario_atual(),
                atualizado_por = app.usuario_atual()
          WHERE id = $1`,
        [versaoId, calc(v.data_revisao, v.prazo_revisao_meses), calc(v.data_vencimento, v.vencimento_meses),
         calc(v.data_reavaliacao, v.reavaliacao_meses)],
      );
      // Uma versão emitida depois da mudança de condições atende a atualização pedida.
      if (v.mudanca_condicoes_em && v.mudanca_condicoes_em <= v.data_emissao)
        await tx.query(
          `UPDATE documento SET mudanca_condicoes_em = NULL, mudanca_condicoes_motivo = NULL, atualizado_por = app.usuario_atual() WHERE id = $1`,
          [v0.documento_id]);
      return this.obterTx(u, tx, v0.documento_id);
    });
  }

  async cancelarVersao(u: Usuario, versaoId: string, corpo: unknown) {
    const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(2000) }), corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const v = await this.versaoParaEditar(u, tx, versaoId);
      if (!['em_elaboracao', 'em_revisao'].includes(v.situacao))
        throw erro('Só versões em elaboração ou revisão podem ser canceladas. A vigente é substituída ao emitir outra.');
      await tx.query(
        `UPDATE documento_versao SET situacao = 'cancelada', motivo_cancelamento = $2, atualizado_por = app.usuario_atual() WHERE id = $1`,
        [versaoId, motivo]);
      return this.obterTx(u, tx, v.documento_id);
    });
  }

  async anexar(u: Usuario, versaoId: string, arq?: { originalname: string; mimetype: string; buffer: Buffer }) {
    if (!arq?.buffer?.length) throw new BadRequestException({ mensagem: 'Envie o arquivo do documento' });
    if (!TIPOS_ARQUIVO[arq.mimetype] || !conteudoConfere(arq.buffer, arq.mimetype))
      throw new BadRequestException({ mensagem: 'O arquivo deve ser PDF, JPG ou PNG' });
    return this.banco.tx(u.ctx(), async (tx) => {
      const v = await this.versaoParaEditar(u, tx, versaoId);
      if (!['em_elaboracao', 'em_revisao', 'vigente'].includes(v.situacao)) throw erro('Esta versão não pode mais ser alterada');
      const nome = arq.originalname.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 150) || `documento.${TIPOS_ARQUIVO[arq.mimetype]}`;
      const r = await tx.one(
        `INSERT INTO arquivo (tenant_id, empresa_id, nome, tipo_mime, tamanho, sha256, conteudo, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, app.usuario_atual()) RETURNING id`,
        [v.empresa_id, nome, arq.mimetype, arq.buffer.length, createHash('sha256').update(arq.buffer).digest('hex'), arq.buffer],
      );
      await tx.query('UPDATE documento_versao SET arquivo_id = $2, atualizado_por = app.usuario_atual() WHERE id = $1', [versaoId, r!.id]);
      if (v.arquivo_id) await tx.query('DELETE FROM arquivo WHERE id = $1', [v.arquivo_id]);
      return this.obterTx(u, tx, v.documento_id);
    });
  }

  arquivo(u: Usuario, versaoId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `SELECT v.empresa_id AS "empresaId", ar.nome, ar.tipo_mime AS "tipoMime", ar.conteudo
           FROM documento_versao v JOIN arquivo ar ON ar.id = v.arquivo_id WHERE v.id = $1`, [versaoId]);
      if (!r) throw new NotFoundException({ mensagem: 'Esta versão não tem arquivo anexado' });
      u.exigir('documentos.ler', r.empresaId);
      return r as { nome: string; tipoMime: string; conteudo: Buffer };
    });
  }

  // ---------------------------------------------------------------- acompanhamentos

  async registrarAcompanhamento(u: Usuario, documentoId: string, corpo: unknown) {
    const d = validar(acompanhamentoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const doc = await this.paraEditar(u, tx, documentoId);
      const hoje = (await tx.one('SELECT current_date::text AS h'))!.h;
      if (d.data > hoje) throw erro('O acompanhamento não pode ter data futura');
      await tx.query(
        `INSERT INTO documento_acompanhamento (tenant_id, empresa_id, documento_id, data, responsavel_nome, descricao, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual())`,
        [doc.empresa_id, documentoId, d.data, d.responsavelNome, d.descricao]);
      return this.obterTx(u, tx, documentoId);
    });
  }
}
