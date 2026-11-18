import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  cancelamentoSchema, conclusaoTurmaSchema, matrizSchema, participantesSchema, treinamentoSchema, turmaSchema,
} from '@sst/shared';
import { randomInt } from 'node:crypto';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';

const erro = (mensagem: string) => new UnprocessableEntityException({ mensagem });

const SELECT_TREINAMENTO = `
  SELECT id, nome, norma, carga_horaria::float AS "cargaHoraria", carga_horaria_reciclagem::float AS "cargaHorariaReciclagem",
         periodicidade_meses AS "periodicidadeMeses", conteudo_programatico AS "conteudoProgramatico", ativo
    FROM treinamento`;

const SELECT_TURMA = `
  SELECT t.id, t.empresa_id AS "empresaId", t.treinamento_id AS "treinamentoId", tr.nome AS "treinamentoNome", tr.norma,
         t.tipo, t.modalidade, t.data_inicio AS "dataInicio", t.data_fim AS "dataFim", t.carga_horaria::float AS "cargaHoraria",
         t.instrutor_nome AS "instrutorNome", t.instrutor_qualificacao AS "instrutorQualificacao",
         t.responsavel_tecnico AS "responsavelTecnico", t.local, t.situacao, t.observacoes,
         (SELECT count(*)::int FROM turma_participante p WHERE p.turma_id = t.id) AS participantes,
         (SELECT count(*)::int FROM turma_participante p WHERE p.turma_id = t.id AND p.aprovado) AS aprovados
    FROM turma t JOIN treinamento tr ON tr.id = t.treinamento_id`;

/** Código do certificado: 3 blocos de 4 caracteres sem letras ambíguas (O/0, I/1). */
function codigoCertificado() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloco = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join('');
  return `${bloco()}-${bloco()}-${bloco()}`;
}

@Injectable()
export class TreinamentosService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  // ---- Biblioteca (vale para todas as empresas) ----

  listarBiblioteca(u: Usuario, incluirInativos: boolean) {
    return this.banco.tx(u.ctx(), (tx) => tx.query(`${SELECT_TREINAMENTO} WHERE ($1 OR ativo) ORDER BY nome`, [incluirInativos]));
  }

  criarTreinamento(u: Usuario, corpo: unknown) {
    const d = validar(treinamentoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `INSERT INTO treinamento (tenant_id, nome, norma, carga_horaria, carga_horaria_reciclagem, periodicidade_meses,
                                  conteudo_programatico, ativo, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, app.usuario_atual()) RETURNING id`,
        [d.nome, d.norma, d.cargaHoraria, d.cargaHorariaReciclagem, d.periodicidadeMeses, d.conteudoProgramatico, d.ativo],
      );
      return tx.one(`${SELECT_TREINAMENTO} WHERE id = $1`, [r!.id]);
    });
  }

  /** Mudança na periodicidade vale para as próximas turmas; validades já gravadas não mudam. */
  atualizarTreinamento(u: Usuario, id: string, corpo: unknown) {
    const d = validar(treinamentoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.query(
        `UPDATE treinamento SET nome = $2, norma = $3, carga_horaria = $4, carga_horaria_reciclagem = $5,
                periodicidade_meses = $6, conteudo_programatico = $7, ativo = $8 WHERE id = $1 RETURNING id`,
        [id, d.nome, d.norma, d.cargaHoraria, d.cargaHorariaReciclagem, d.periodicidadeMeses, d.conteudoProgramatico, d.ativo],
      );
      if (!r.length) throw new NotFoundException({ mensagem: 'Treinamento não encontrado' });
      return tx.one(`${SELECT_TREINAMENTO} WHERE id = $1`, [id]);
    });
  }

  // ---- Turmas ----

  listarTurmas(u: Usuario, f: { empresaId?: string; situacao?: string; treinamentoId?: string }) {
    const permitidas = u.empresasCom('treinamentos.ler');
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `${SELECT_TURMA} WHERE ($1::uuid IS NULL OR t.empresa_id = $1) AND ($2::text IS NULL OR t.situacao = $2)
           AND ($3::uuid IS NULL OR t.treinamento_id = $3) AND ($4::uuid[] IS NULL OR t.empresa_id = ANY($4))
         ORDER BY t.data_inicio DESC LIMIT 500`,
        [f.empresaId ?? null, f.situacao ?? null, f.treinamentoId ?? null, permitidas === '*' ? null : permitidas],
      ),
    );
  }

  obterTurma(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const t = await this.turmaTx(tx, id);
      u.exigir('treinamentos.ler', t.empresaId);
      return t;
    });
  }

  private async turmaTx(tx: Tx, id: string) {
    const turma = await tx.one(`${SELECT_TURMA} WHERE t.id = $1`, [id]);
    if (!turma) throw new NotFoundException({ mensagem: 'Turma não encontrada' });
    const participantes = await tx.query(
      `SELECT p.id, p.funcionario_id AS "funcionarioId", f.nome, f.cpf,
              (SELECT v.matricula FROM vinculo v WHERE v.funcionario_id = f.id ORDER BY v.data_admissao DESC LIMIT 1) AS matricula,
              p.presente, p.aprovado, p.nota::float AS nota, p.validade, p.certificado_codigo AS "certificadoCodigo"
         FROM turma_participante p JOIN funcionario f ON f.id = p.funcionario_id
        WHERE p.turma_id = $1 ORDER BY f.nome`,
      [id],
    );
    return { ...turma, participantesLista: participantes };
  }

  private async turmaParaAlterar(u: Usuario, tx: Tx, id: string) {
    const t = await tx.one('SELECT empresa_id, situacao, data_fim FROM turma WHERE id = $1 FOR UPDATE', [id]);
    if (!t) throw new NotFoundException({ mensagem: 'Turma não encontrada' });
    u.exigir('treinamentos.editar', t.empresa_id);
    if (t.situacao !== 'planejada') throw erro(`Turma ${t.situacao} não pode ser alterada`);
    return t as { empresa_id: string; situacao: string; data_fim: string };
  }

  criarTurma(u: Usuario, empresaId: string, corpo: unknown) {
    u.exigir('treinamentos.editar', empresaId);
    const d = validar(turmaSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [empresaId]))) throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
      if (!(await tx.one('SELECT 1 FROM treinamento WHERE id = $1 AND ativo', [d.treinamentoId]))) throw erro('Treinamento não encontrado ou inativo');
      const r = await tx.one(
        `INSERT INTO turma (tenant_id, empresa_id, treinamento_id, tipo, modalidade, data_inicio, data_fim, carga_horaria,
                            instrutor_nome, instrutor_qualificacao, responsavel_tecnico, local, observacoes, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, app.usuario_atual()) RETURNING id`,
        [empresaId, d.treinamentoId, d.tipo, d.modalidade, d.dataInicio, d.dataFim, d.cargaHoraria, d.instrutorNome,
         d.instrutorQualificacao, d.responsavelTecnico, d.local, d.observacoes],
      );
      return this.turmaTx(tx, r!.id);
    });
  }

  atualizarTurma(u: Usuario, id: string, corpo: unknown) {
    const d = validar(turmaSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.turmaParaAlterar(u, tx, id);
      if (!(await tx.one('SELECT 1 FROM treinamento WHERE id = $1', [d.treinamentoId]))) throw erro('Treinamento não encontrado');
      await tx.query(
        `UPDATE turma SET treinamento_id = $2, tipo = $3, modalidade = $4, data_inicio = $5, data_fim = $6, carga_horaria = $7,
                instrutor_nome = $8, instrutor_qualificacao = $9, responsavel_tecnico = $10, local = $11, observacoes = $12
          WHERE id = $1`,
        [id, d.treinamentoId, d.tipo, d.modalidade, d.dataInicio, d.dataFim, d.cargaHoraria, d.instrutorNome,
         d.instrutorQualificacao, d.responsavelTecnico, d.local, d.observacoes],
      );
      return this.turmaTx(tx, id);
    });
  }

  cancelarTurma(u: Usuario, id: string, corpo: unknown) {
    const { motivo } = validar(cancelamentoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.turmaParaAlterar(u, tx, id);
      await tx.query(
        `UPDATE turma SET situacao = 'cancelada',
                observacoes = concat_ws(E'\\n', observacoes, 'Cancelada: ' || $2) WHERE id = $1`,
        [id, motivo],
      );
      return this.turmaTx(tx, id);
    });
  }

  adicionarParticipantes(u: Usuario, id: string, corpo: unknown) {
    const { funcionarioIds } = validar(participantesSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const t = await this.turmaParaAlterar(u, tx, id);
      const ok = await tx.query('SELECT id FROM funcionario WHERE id = ANY($1::uuid[]) AND empresa_id = $2', [funcionarioIds, t.empresa_id]);
      if (ok.length !== new Set(funcionarioIds).size) throw erro('Funcionário não encontrado nesta empresa');
      await tx.query(
        `INSERT INTO turma_participante (tenant_id, empresa_id, turma_id, funcionario_id, criado_por)
         SELECT app.tenant_atual(), $1, $2, f, app.usuario_atual() FROM unnest($3::uuid[]) f
         ON CONFLICT (turma_id, funcionario_id) DO NOTHING`,
        [t.empresa_id, id, funcionarioIds],
      );
      return this.turmaTx(tx, id);
    });
  }

  removerParticipante(u: Usuario, id: string, participanteId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      await this.turmaParaAlterar(u, tx, id);
      const r = await tx.query('DELETE FROM turma_participante WHERE id = $1 AND turma_id = $2 RETURNING id', [participanteId, id]);
      if (!r.length) throw new NotFoundException({ mensagem: 'Participante não encontrado' });
      return this.turmaTx(tx, id);
    });
  }

  /**
   * Conclui a turma: grava presença e aprovação de todos, calcula a validade
   * (fim da turma + periodicidade do treinamento) e gera o código do certificado.
   */
  concluirTurma(u: Usuario, id: string, corpo: unknown) {
    const d = validar(conclusaoTurmaSchema, corpo);
    return this.banco.tx(u.ctx('conclusao_turma'), async (tx) => {
      const t = await this.turmaParaAlterar(u, tx, id);
      const hoje = (await tx.one<{ d: string }>('SELECT current_date AS d'))!.d;
      if (t.data_fim > hoje) throw erro('A turma só pode ser concluída depois da data de término');
      const ids = (await tx.query<{ id: string }>('SELECT id FROM turma_participante WHERE turma_id = $1', [id])).map((r) => r.id);
      if (!ids.length) throw erro('A turma não tem participantes');
      const informados = new Set(d.participantes.map((p) => p.id));
      if (informados.size !== d.participantes.length || ids.some((i) => !informados.has(i)) || ids.length !== informados.size)
        throw erro('Informe presença e aprovação de todos os participantes da turma');
      for (const p of d.participantes) {
        await tx.query(
          `UPDATE turma_participante p SET presente = $2, aprovado = $3, nota = $4,
                  validade = CASE WHEN $3 THEN (SELECT t.data_fim + make_interval(months => tr.periodicidade_meses)
                                                  FROM turma t JOIN treinamento tr ON tr.id = t.treinamento_id
                                                 WHERE t.id = p.turma_id)::date END,
                  certificado_codigo = CASE WHEN $3 THEN $5 END
            WHERE p.id = $1`,
          [p.id, p.presente, p.aprovado, p.nota, codigoCertificado()],
        );
      }
      await tx.query(`UPDATE turma SET situacao = 'realizada', realizada_em = now() WHERE id = $1`, [id]);
      return this.turmaTx(tx, id);
    });
  }

  /** Dados do certificado de um participante aprovado (NR-1, item 1.7). */
  async dadosCertificado(u: Usuario, participanteId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `SELECT p.empresa_id AS "empresaId", p.certificado_codigo AS codigo, p.validade, f.nome AS "funcionarioNome", f.cpf AS "funcionarioCpf",
                e.razao_social AS "empresaNome", e.inscricao AS "empresaInscricao", e.tipo_inscricao AS "empresaTipoInscricao",
                tr.nome AS "treinamentoNome", tr.norma, tr.conteudo_programatico AS "conteudoProgramatico",
                t.tipo, t.modalidade, t.data_inicio AS "dataInicio", t.data_fim AS "dataFim", t.carga_horaria::float AS "cargaHoraria",
                t.instrutor_nome AS "instrutorNome", t.instrutor_qualificacao AS "instrutorQualificacao",
                t.responsavel_tecnico AS "responsavelTecnico", t.local
           FROM turma_participante p
           JOIN turma t ON t.id = p.turma_id JOIN treinamento tr ON tr.id = t.treinamento_id
           JOIN funcionario f ON f.id = p.funcionario_id JOIN empresa e ON e.id = p.empresa_id
          WHERE p.id = $1`,
        [participanteId],
      );
      if (!r) throw new NotFoundException({ mensagem: 'Participante não encontrado' });
      u.exigir('treinamentos.ler', r.empresaId);
      if (!r.codigo) throw erro('Certificado só existe para participante aprovado em turma concluída');
      return r;
    });
  }

  // ---- Matriz de treinamentos por função e GHE ----

  listarMatriz(u: Usuario, empresaId: string) {
    u.exigir('treinamentos.ler', empresaId);
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `SELECT m.id, m.treinamento_id AS "treinamentoId", tr.nome AS "treinamentoNome", tr.norma,
                tr.periodicidade_meses AS "periodicidadeMeses",
                m.funcao_id AS "funcaoId", fu.nome AS "funcaoNome", m.ghe_id AS "gheId", gh.codigo AS "gheCodigo", gh.nome AS "gheNome"
           FROM matriz_treinamento m JOIN treinamento tr ON tr.id = m.treinamento_id
           LEFT JOIN funcao fu ON fu.id = m.funcao_id LEFT JOIN ghe gh ON gh.id = m.ghe_id
          WHERE m.empresa_id = $1 ORDER BY tr.nome, fu.nome NULLS LAST, gh.codigo`,
        [empresaId],
      ),
    );
  }

  adicionarMatriz(u: Usuario, empresaId: string, corpo: unknown) {
    u.exigir('treinamentos.editar', empresaId);
    const d = validar(matrizSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM treinamento WHERE id = $1', [d.treinamentoId]))) throw erro('Treinamento não encontrado');
      const r = await tx.one(
        `INSERT INTO matriz_treinamento (tenant_id, empresa_id, treinamento_id, funcao_id, ghe_id, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, app.usuario_atual()) RETURNING id`,
        [empresaId, d.treinamentoId, d.funcaoId, d.gheId],
      );
      return { id: r!.id };
    });
  }

  removerMatriz(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const m = await tx.one('SELECT empresa_id FROM matriz_treinamento WHERE id = $1', [id]);
      if (!m) throw new NotFoundException({ mensagem: 'Item da matriz não encontrado' });
      u.exigir('treinamentos.editar', m.empresa_id);
      await tx.query('DELETE FROM matriz_treinamento WHERE id = $1', [id]);
      return { removido: true };
    });
  }

  /** Histórico de treinamentos de um funcionário e situação dos exigidos pela função/GHE atual. */
  async doFuncionario(u: Usuario, funcionarioId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const fn = await tx.one('SELECT empresa_id FROM funcionario WHERE id = $1', [funcionarioId]);
      if (!fn) throw new NotFoundException({ mensagem: 'Funcionário não encontrado' });
      u.exigir('treinamentos.ler', fn.empresa_id);
      const historico = await tx.query(
        `SELECT p.id, tr.nome AS "treinamentoNome", tr.norma, t.id AS "turmaId", t.tipo, t.data_inicio AS "dataInicio",
                t.data_fim AS "dataFim", t.carga_horaria::float AS "cargaHoraria", t.situacao, p.presente, p.aprovado,
                p.validade, p.certificado_codigo AS "certificadoCodigo"
           FROM turma_participante p JOIN turma t ON t.id = p.turma_id JOIN treinamento tr ON tr.id = t.treinamento_id
          WHERE p.funcionario_id = $1 ORDER BY t.data_inicio DESC`,
        [funcionarioId],
      );
      const exigidos = await tx.query(`${SQL_EXIGIDOS} WHERE x.funcionario_id = $1 ORDER BY x.treinamento_nome`, [funcionarioId]);
      return { historico, exigidos };
    });
  }
}

/**
 * Treinamentos exigidos de cada vínculo ativo ou afastado, pela função e pelo GHE
 * da lotação vigente hoje, com a última aprovação e a situação.
 * Situação: pendente (nunca aprovado), vencido, vencendo (dentro do maior prazo de alerta), em_dia.
 */
export const SQL_EXIGIDOS = `
  SELECT * FROM (
    SELECT DISTINCT ON (v.id, m.treinamento_id)
           v.id AS vinculo_id, v.funcionario_id, v.empresa_id, fn.nome AS funcionario_nome, v.matricula,
           m.treinamento_id, tr.nome AS treinamento_nome, tr.norma,
           ult.data_fim AS ultima_conclusao, ult.validade,
           CASE
             WHEN ult.data_fim IS NULL THEN 'pendente'
             WHEN ult.validade IS NULL THEN 'em_dia'
             WHEN ult.validade < current_date THEN 'vencido'
             WHEN ult.validade <= current_date + (SELECT max(d) FROM tenant_config c, unnest(c.alertas_dias) d) THEN 'vencendo'
             ELSE 'em_dia'
           END AS situacao,
           (ult.validade - current_date) AS dias_para_vencer
      FROM vinculo v
      JOIN vinculo_situacao s ON s.vinculo_id = v.id AND s.situacao IN ('ativo', 'afastado')
      JOIN funcionario fn ON fn.id = v.funcionario_id
      JOIN lotacao l ON l.vinculo_id = v.id AND l.inicio <= current_date AND (l.fim IS NULL OR l.fim >= current_date)
      JOIN matriz_treinamento m ON m.empresa_id = v.empresa_id AND (m.funcao_id = l.funcao_id OR m.ghe_id = l.ghe_id)
      JOIN treinamento tr ON tr.id = m.treinamento_id
      LEFT JOIN LATERAL (
        SELECT t.data_fim, p.validade FROM turma_participante p JOIN turma t ON t.id = p.turma_id
         WHERE p.funcionario_id = v.funcionario_id AND t.treinamento_id = m.treinamento_id
           AND t.situacao = 'realizada' AND p.aprovado
         ORDER BY t.data_fim DESC LIMIT 1
      ) ult ON true
     ORDER BY v.id, m.treinamento_id
  ) x`;
