import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  acaoEdicaoSchema, acaoSchema, cancelamentoAcaoSchema, comentarioSchema, devolucaoAcaoSchema, dispensaEvidenciaSchema,
  evidenciaSchema, prazoAcao, reprogramacaoSchema, SITUACOES_ACAO, SITUACOES_ACAO_ABERTA, situacaoAcaoSchema, TRANSICOES_ACAO,
  validacaoAcaoSchema, type SituacaoAcao,
} from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';
import { ArquivoEnviado, conferirArquivo, erro, gravarArquivo, naoEncontrado, proximoCodigo, referencia } from './comum';

const SELECT_ACAO = `
  SELECT a.id, a.codigo, a.empresa_id AS "empresaId", e.razao_social AS "empresaNome",
         a.estabelecimento_id AS "estabelecimentoId", es.nome AS "estabelecimentoNome",
         a.setor_id AS "setorId", s.nome AS "setorNome", a.ghe_id AS "gheId", g.codigo || ' - ' || g.nome AS "gheNome",
         a.origem, a.documento_id AS "documentoId", d.identificacao AS "documentoIdentificacao",
         a.inspecao_item_id AS "inspecaoItemId", ii.inspecao_id AS "inspecaoId", i.codigo AS "inspecaoCodigo", ii.descricao AS "inspecaoItem",
         a.ocorrencia_id AS "ocorrenciaId", o.codigo AS "ocorrenciaCodigo",
         a.conformidade_id AS "conformidadeId", r.titulo AS "requisitoTitulo",
         a.perigo, a.descricao, a.justificativa, a.tipo, a.prioridade, a.responsavel_nome AS "responsavelNome",
         a.validador_nome AS "validadorNome", a.data_abertura AS "dataAbertura", a.prazo_inicial AS "prazoInicial", a.prazo,
         a.recursos, a.forma_acompanhamento AS "formaAcompanhamento", a.exige_evidencia AS "exigeEvidencia",
         a.dispensa_justificativa AS "dispensaJustificativa", a.situacao, a.concluida_em AS "concluidaEm",
         a.validada_por_nome AS "validadaPorNome", uv.nome AS "validadaPorUsuario",
         a.cancelada_em AS "canceladaEm", a.cancelamento_motivo AS "cancelamentoMotivo",
         (SELECT count(*) FROM acao_evidencia ev WHERE ev.acao_id = a.id)::int AS evidencias,
         a.criado_em AS "criadoEm", uc.nome AS "criadoPor"
    FROM acao a
    JOIN empresa e ON e.id = a.empresa_id
    LEFT JOIN estabelecimento es ON es.id = a.estabelecimento_id
    LEFT JOIN setor s ON s.id = a.setor_id
    LEFT JOIN ghe g ON g.id = a.ghe_id
    LEFT JOIN documento d ON d.id = a.documento_id
    LEFT JOIN inspecao_item ii ON ii.id = a.inspecao_item_id
    LEFT JOIN inspecao i ON i.id = ii.inspecao_id
    LEFT JOIN ocorrencia o ON o.id = a.ocorrencia_id
    LEFT JOIN conformidade c ON c.id = a.conformidade_id
    LEFT JOIN requisito r ON r.id = c.requisito_id
    LEFT JOIN usuario uv ON uv.id = a.validada_por
    LEFT JOIN usuario uc ON uc.id = a.criado_por`;

export interface FiltroAcoes {
  empresaId?: string;
  situacao?: string;
  origem?: string;
  prioridade?: string;
  documentoId?: string;
  inspecaoId?: string;
  ocorrenciaId?: string;
  conformidadeId?: string;
  busca?: string;
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

@Injectable()
export class AcoesService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  private comPrazo(a: any, ref: { hoje: string; janela: number }) {
    return { ...a, ...prazoAcao(a, ref.hoje, ref.janela) };
  }

  async listar(u: Usuario, f: FiltroAcoes) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      cond.push(sql.replace('?', `$${params.length}`));
    };
    if (f.empresaId) add('a.empresa_id = ?', f.empresaId);
    if (f.origem) add('a.origem = ?', f.origem);
    if (f.prioridade) add('a.prioridade = ?', f.prioridade);
    if (f.documentoId) add('a.documento_id = ?', f.documentoId);
    if (f.inspecaoId) add('ii.inspecao_id = ?', f.inspecaoId);
    if (f.ocorrenciaId) add('a.ocorrencia_id = ?', f.ocorrenciaId);
    if (f.conformidadeId) add('a.conformidade_id = ?', f.conformidadeId);
    if (f.busca) add(`(a.codigo ILIKE ? OR a.descricao ILIKE $${params.length + 1} OR a.responsavel_nome ILIKE $${params.length + 1})`, `%${f.busca}%`);
    const permitidas = u.empresasCom('acoes.ler');
    if (permitidas !== '*') add('a.empresa_id = ANY(?::uuid[])', permitidas);
    return this.banco.tx(u.ctx(), async (tx) => {
      const ref = await referencia(tx);
      const linhas = await tx.query(
        `${SELECT_ACAO} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
          ORDER BY (a.situacao IN ('concluida','cancelada')), a.prazo, a.codigo`,
        params,
      );
      const todas = linhas.map((a) => this.comPrazo(a, ref));
      const resumo: Record<string, number> = Object.fromEntries(Object.keys(SITUACOES_ACAO).map((k) => [k, 0]));
      resumo.abertas = resumo.atrasadas = resumo.proximas = resumo.reprogramadas = 0;
      for (const a of todas) {
        resumo[a.situacao]!++;
        if (SITUACOES_ACAO_ABERTA.includes(a.situacao)) resumo.abertas!++;
        if (a.estado === 'atrasado') resumo.atrasadas!++;
        if (a.estado === 'proximo') resumo.proximas!++;
        if (a.reprogramada && a.estado !== 'encerrada') resumo.reprogramadas!++;
      }
      const s = f.situacao;
      const itens = !s ? todas
        : s === 'abertas' ? todas.filter((a) => a.estado !== 'encerrada')
        : s === 'atrasadas' ? todas.filter((a) => a.estado === 'atrasado')
        : s === 'proximas' ? todas.filter((a) => a.estado === 'proximo')
        : s === 'reprogramadas' ? todas.filter((a) => a.reprogramada && a.estado !== 'encerrada')
        : todas.filter((a) => s.split(',').includes(a.situacao));
      return { itens, resumo, hoje: ref.hoje, alertaDias: ref.janela };
    });
  }

  obter(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), (tx) => this.obterTx(u, tx, id));
  }

  private async obterTx(u: Usuario, tx: Tx, id: string) {
    const a = await tx.one(`${SELECT_ACAO} WHERE a.id = $1`, [id]);
    if (!a) throw naoEncontrado('Ação');
    u.exigir('acoes.ler', a.empresaId);
    const ref = await referencia(tx);
    const evidencias = await tx.query(
      `SELECT ev.id, ev.tipo, ev.descricao, ev.data, ar.nome AS "arquivoNome", ar.tamanho AS "arquivoTamanho", ar.tipo_mime AS "tipoMime",
              ev.criado_em AS "criadoEm", uc.nome AS "registradoPor"
         FROM acao_evidencia ev JOIN arquivo ar ON ar.id = ev.arquivo_id LEFT JOIN usuario uc ON uc.id = ev.criado_por
        WHERE ev.acao_id = $1 ORDER BY ev.data DESC, ev.criado_em DESC`, [id]);
    const historico = await tx.query(
      `SELECT h.id, h.evento, h.descricao, h.dados, h.criado_em AS "criadoEm", uc.nome AS usuario
         FROM acao_historico h LEFT JOIN usuario uc ON uc.id = h.criado_por
        WHERE h.acao_id = $1 ORDER BY h.criado_em DESC, h.id`, [id]);
    return { ...this.comPrazo(a, ref), evidenciasLista: evidencias, historico };
  }

  private historico(tx: Tx, a: { id: string; empresa_id: string }, evento: string, descricao: string, dados: object = {}) {
    return tx.query(
      `INSERT INTO acao_historico (tenant_id, empresa_id, acao_id, evento, descricao, dados, criado_por)
       VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual())`,
      [a.empresa_id, a.id, evento, descricao, JSON.stringify(dados)],
    );
  }

  /** Ação travada para alteração. Concluída ou cancelada não muda (o banco também impede). */
  private async paraAlterar(u: Usuario, tx: Tx, id: string, permissao: 'acoes.editar' | 'acoes.validar' = 'acoes.editar', aberta = true) {
    const a = await tx.one(
      `SELECT id, empresa_id, codigo, situacao, data_abertura, prazo, exige_evidencia FROM acao WHERE id = $1 FOR UPDATE`, [id]);
    if (!a) throw naoEncontrado('Ação');
    u.exigir(permissao, a.empresa_id);
    if (aberta && !SITUACOES_ACAO_ABERTA.includes(a.situacao))
      throw erro(`Ação ${a.codigo} já está ${a.situacao === 'concluida' ? 'concluída' : 'cancelada'} e não pode ser alterada`);
    return a as { id: string; empresa_id: string; codigo: string; situacao: SituacaoAcao; data_abertura: string; prazo: string; exige_evidencia: boolean };
  }

  async criar(u: Usuario, corpo: unknown) {
    const d = validar(acaoSchema, corpo);
    u.exigir('acoes.editar', d.empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [d.empresaId]))) throw erro('Empresa não encontrada');
      // Vínculos de origem: conferidos sob o RLS do usuário; a chave composta garante a mesma empresa.
      if (d.inspecaoItemId) {
        const it = await tx.one('SELECT resultado, empresa_id FROM inspecao_item WHERE id = $1', [d.inspecaoItemId]);
        if (!it || it.empresa_id !== d.empresaId) throw erro('Item de inspeção não encontrado nesta empresa');
        if (it.resultado !== 'nao_conforme') throw erro('Só item não conforme gera ação');
      }
      const codigo = await proximoCodigo(tx, 'AC');
      const r = await tx.one(
        `INSERT INTO acao (tenant_id, empresa_id, codigo, estabelecimento_id, setor_id, ghe_id, origem, documento_id, inspecao_item_id,
                           ocorrencia_id, conformidade_id, perigo, descricao, justificativa, tipo, prioridade, responsavel_nome,
                           validador_nome, data_abertura, prazo_inicial, prazo, recursos, forma_acompanhamento, exige_evidencia,
                           dispensa_justificativa, criado_por, atualizado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19, $20, $21,
                 $22, $23, app.usuario_atual(), app.usuario_atual())
         RETURNING id, empresa_id`,
        [d.empresaId, codigo, d.estabelecimentoId, d.setorId, d.gheId, d.origem, d.documentoId, d.inspecaoItemId, d.ocorrenciaId,
         d.conformidadeId, d.perigo, d.descricao, d.justificativa, d.tipo, d.prioridade, d.responsavelNome, d.validadorNome,
         d.dataAbertura, d.prazo, d.recursos, d.formaAcompanhamento, d.exigeEvidencia, d.exigeEvidencia ? null : d.dispensaJustificativa],
      );
      await this.historico(tx, r!, 'aberta', `Ação aberta com prazo em ${dataBr(d.prazo)}`, { prazo: d.prazo });
      if (!d.exigeEvidencia) await this.historico(tx, r!, 'dispensa', `Evidência dispensada: ${d.dispensaJustificativa}`);
      return this.obterTx(u, tx, r!.id);
    });
  }

  async atualizar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(acaoEdicaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id);
      await tx.query(
        `UPDATE acao SET estabelecimento_id = $2, setor_id = $3, ghe_id = $4, perigo = $5, descricao = $6, justificativa = $7, tipo = $8,
                prioridade = $9, responsavel_nome = $10, validador_nome = $11, recursos = $12, forma_acompanhamento = $13,
                atualizado_por = app.usuario_atual()
          WHERE id = $1`,
        [id, d.estabelecimentoId, d.setorId, d.gheId, d.perigo, d.descricao, d.justificativa, d.tipo, d.prioridade, d.responsavelNome,
         d.validadorNome, d.recursos, d.formaAcompanhamento],
      );
      await this.historico(tx, a, 'editada', 'Dados da ação alterados');
      return this.obterTx(u, tx, id);
    });
  }

  async mudarSituacao(u: Usuario, id: string, corpo: unknown) {
    const d = validar(situacaoAcaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id);
      if (!TRANSICOES_ACAO[a.situacao].includes(d.situacao))
        throw erro(`Não é possível passar de "${SITUACOES_ACAO[a.situacao]}" para "${SITUACOES_ACAO[d.situacao]}"`);
      await tx.query(`UPDATE acao SET situacao = $2, atualizado_por = app.usuario_atual() WHERE id = $1`, [id, d.situacao]);
      await this.historico(tx, a, 'situacao',
        `${SITUACOES_ACAO[a.situacao]} → ${SITUACOES_ACAO[d.situacao]}${d.comentario ? `: ${d.comentario}` : ''}`,
        { de: a.situacao, para: d.situacao });
      return this.obterTx(u, tx, id);
    });
  }

  /** Muda o prazo; a justificativa fica no histórico e o prazo inicial é preservado. */
  async reprogramar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(reprogramacaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id);
      if (d.prazo === a.prazo) throw erro('O novo prazo é igual ao atual');
      if (d.prazo < a.data_abertura) throw erro('O prazo não pode ser antes da abertura da ação');
      await tx.query(`UPDATE acao SET prazo = $2, atualizado_por = app.usuario_atual() WHERE id = $1`, [id, d.prazo]);
      await this.historico(tx, a, 'reprogramada', `Prazo de ${dataBr(a.prazo)} para ${dataBr(d.prazo)}: ${d.justificativa}`,
        { de: a.prazo, para: d.prazo, justificativa: d.justificativa });
      return this.obterTx(u, tx, id);
    });
  }

  async dispensa(u: Usuario, id: string, corpo: unknown) {
    const d = validar(dispensaEvidenciaSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id);
      if (a.situacao === 'em_validacao') throw erro('A ação está em validação; peça a devolução antes de mudar a exigência de evidência');
      await tx.query(
        `UPDATE acao SET exige_evidencia = $2, dispensa_justificativa = $3, atualizado_por = app.usuario_atual() WHERE id = $1`,
        [id, !d.dispensar, d.dispensar ? d.justificativa : null]);
      await this.historico(tx, a, 'dispensa', d.dispensar ? `Evidência dispensada: ${d.justificativa}` : 'Evidência voltou a ser exigida');
      return this.obterTx(u, tx, id);
    });
  }

  async adicionarEvidencia(u: Usuario, id: string, corpo: unknown, arq?: ArquivoEnviado) {
    const d = validar(evidenciaSchema, corpo);
    conferirArquivo(arq);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id);
      const hoje = (await referencia(tx)).hoje;
      if (d.data > hoje) throw erro('A evidência não pode ter data futura');
      const arquivoId = await gravarArquivo(tx, a.empresa_id, arq!, 'evidencia');
      await tx.query(
        `INSERT INTO acao_evidencia (tenant_id, empresa_id, acao_id, tipo, descricao, data, arquivo_id, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, app.usuario_atual())`,
        [a.empresa_id, id, d.tipo, d.descricao, d.data, arquivoId]);
      await this.historico(tx, a, 'evidencia', `Evidência anexada: ${d.descricao}`, { tipo: d.tipo, data: d.data });
      return this.obterTx(u, tx, id);
    });
  }

  arquivoEvidencia(u: Usuario, evidenciaId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `SELECT ev.empresa_id AS "empresaId", ar.nome, ar.tipo_mime AS "tipoMime", ar.conteudo
           FROM acao_evidencia ev JOIN arquivo ar ON ar.id = ev.arquivo_id WHERE ev.id = $1`, [evidenciaId]);
      if (!r) throw new NotFoundException({ mensagem: 'Evidência não encontrada' });
      u.exigir('acoes.ler', r.empresaId);
      return r as { nome: string; tipoMime: string; conteudo: Buffer };
    });
  }

  /** Validação (acoes.validar): conclui a ação que está em validação. */
  async validar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(validacaoAcaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id, 'acoes.validar');
      if (a.situacao !== 'em_validacao') throw erro('Só ação em validação pode ser concluída');
      const hoje = (await referencia(tx)).hoje;
      if (d.data > hoje) throw erro('A conclusão não pode ter data futura');
      if (d.data < a.data_abertura) throw erro('A conclusão não pode ser antes da abertura');
      await this.historico(tx, a, 'concluida', `Validada e concluída por ${d.validadorNome}${d.parecer ? `: ${d.parecer}` : ''}`,
        { data: d.data });
      await tx.query(
        `UPDATE acao SET situacao = 'concluida', concluida_em = $2, validada_por = app.usuario_atual(), validada_por_nome = $3,
                atualizado_por = app.usuario_atual()
          WHERE id = $1`, [id, d.data, d.validadorNome]);
      return this.obterTx(u, tx, id);
    });
  }

  async devolver(u: Usuario, id: string, corpo: unknown) {
    const d = validar(devolucaoAcaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id, 'acoes.validar');
      if (a.situacao !== 'em_validacao') throw erro('Só ação em validação pode ser devolvida');
      await tx.query(`UPDATE acao SET situacao = 'em_andamento', atualizado_por = app.usuario_atual() WHERE id = $1`, [id]);
      await this.historico(tx, a, 'devolvida', `Devolvida para o responsável: ${d.motivo}`);
      return this.obterTx(u, tx, id);
    });
  }

  /** Cancelar exige quem valida: evita que uma ação atrasada some do controle sem revisão. */
  async cancelar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(cancelamentoAcaoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await this.paraAlterar(u, tx, id, 'acoes.validar');
      if (d.data < a.data_abertura) throw erro('O cancelamento não pode ser antes da abertura');
      await this.historico(tx, a, 'cancelada', `Cancelada: ${d.motivo}`, { data: d.data });
      await tx.query(
        `UPDATE acao SET situacao = 'cancelada', cancelada_em = $2, cancelamento_motivo = $3, atualizado_por = app.usuario_atual()
          WHERE id = $1`, [id, d.data, d.motivo]);
      return this.obterTx(u, tx, id);
    });
  }

  /** Comentário entra no histórico, inclusive em ação encerrada. */
  async comentar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(comentarioSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const a = await tx.one('SELECT id, empresa_id FROM acao WHERE id = $1', [id]);
      if (!a) throw naoEncontrado('Ação');
      if (!u.pode('acoes.editar', a.empresa_id) && !u.pode('acoes.validar', a.empresa_id))
        throw new ForbiddenException({ mensagem: 'Você não tem permissão para esta ação' });
      await this.historico(tx, a, 'comentario', d.texto);
      return this.obterTx(u, tx, id);
    });
  }
}
