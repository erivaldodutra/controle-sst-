import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { asoSchema, cancelamentoSchema, resultadoExameSchema, type AsoInput } from '@sst/shared';
import { createHash } from 'node:crypto';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';

const erro = (mensagem: string) => new UnprocessableEntityException({ mensagem });

export interface FiltroAsos {
  empresaId?: string;
  funcionarioId?: string;
  tipo?: number;
  situacao?: string;
  pagina: number;
  limite: number;
}

/**
 * Situação de cada ASO:
 * cancelado; substituido (há ASO mais novo do mesmo vínculo); sem_vencimento;
 * vencido; vencendo (dentro do maior prazo de alerta); vigente.
 */
const SELECT_ASO = `
  SELECT a.id, a.empresa_id AS "empresaId", a.vinculo_id AS "vinculoId", fn.id AS "funcionarioId",
         fn.nome AS "funcionarioNome", fn.cpf AS "funcionarioCpf", v.matricula,
         a.tipo, a.data_exame AS "dataExame", a.resultado, a.vencimento, a.riscos, a.observacoes,
         a.medico_id AS "medicoId", m.nome AS "medicoNome", m.crm AS "medicoCrm", m.uf_crm AS "medicoUfCrm",
         a.clinica_id AS "clinicaId", c.razao_social AS "clinicaNome",
         a.arquivo_id AS "arquivoId", ar.nome AS "arquivoNome",
         a.cancelado_em AS "canceladoEm", a.motivo_cancelamento AS "motivoCancelamento",
         CASE
           WHEN a.cancelado_em IS NOT NULL THEN 'cancelado'
           WHEN EXISTS (SELECT 1 FROM aso n WHERE n.vinculo_id = a.vinculo_id AND n.cancelado_em IS NULL
                          AND n.tipo NOT IN (4) AND (n.data_exame, n.criado_em) > (a.data_exame, a.criado_em)) THEN 'substituido'
           WHEN a.vencimento IS NULL THEN 'sem_vencimento'
           WHEN a.vencimento < current_date THEN 'vencido'
           WHEN a.vencimento <= current_date + (SELECT max(d) FROM tenant_config t, unnest(t.alertas_dias) d) THEN 'vencendo'
           ELSE 'vigente'
         END AS situacao,
         (a.vencimento - current_date) AS "diasParaVencer"
    FROM aso a
    JOIN vinculo v ON v.id = a.vinculo_id
    JOIN funcionario fn ON fn.id = v.funcionario_id
    JOIN medico m ON m.id = a.medico_id
    LEFT JOIN clinica c ON c.id = a.clinica_id
    LEFT JOIN arquivo ar ON ar.id = a.arquivo_id`;

const TIPOS_ARQUIVO: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
};

@Injectable()
export class AsoService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  listar(u: Usuario, f: FiltroAsos) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      cond.push(sql.replaceAll('?', '$' + params.length));
    };
    if (f.empresaId) add('a.empresa_id = ?', f.empresaId);
    if (f.funcionarioId) add('fn.id = ?', f.funcionarioId);
    if (f.tipo !== undefined) add('a.tipo = ?', f.tipo);
    if (f.situacao) add('x.situacao = ?', f.situacao);
    const permitidas = u.empresasCom('saude.ler');
    if (permitidas !== '*') add('a.empresa_id = ANY(?::uuid[])', permitidas);
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const base = `FROM (${SELECT_ASO.replace('SELECT a.id,', 'SELECT a.id, fn.id AS fid,')}) x
                  JOIN aso a ON a.id = x.id JOIN funcionario fn ON fn.id = x.fid ${where}`;
    return this.banco.tx(u.ctx(), async (tx) => {
      const total = (await tx.one(`SELECT count(*)::int AS n ${base}`, params))!.n;
      params.push(f.limite, (f.pagina - 1) * f.limite);
      const itens = await tx.query(
        `SELECT x.* ${base} ORDER BY x."dataExame" DESC, x."funcionarioNome"
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { total, pagina: f.pagina, limite: f.limite, itens: itens.map(({ fid, ...r }: any) => r) };
    });
  }

  async obter(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), (tx) => this.obterTx(u, tx, id));
  }

  private async obterTx(u: Usuario, tx: Tx, id: string) {
    const aso = await tx.one(`${SELECT_ASO} WHERE a.id = $1`, [id]);
    if (!aso) throw new NotFoundException({ mensagem: 'ASO não encontrado' });
    u.exigir('saude.ler', aso.empresaId);
    const clinicoVisivel = u.pode('saude.clinico', aso.empresaId);
    // O resultado vem de tabela protegida por RLS: sem permissão clínica, a linha simplesmente não aparece.
    const exames = await tx.query(
      `SELECT e.id, e.exame_tipo_id AS "exameTipoId", t.nome, t.codigo_esocial AS "codigoEsocial",
              e.data_realizacao AS "dataRealizacao", e.ordem, r.resultado, r.observacao
         FROM aso_exame e JOIN exame_tipo t ON t.id = e.exame_tipo_id
         LEFT JOIN aso_exame_resultado r ON r.aso_exame_id = e.id
        WHERE e.aso_id = $1 ORDER BY e.data_realizacao, t.nome`,
      [id],
    );
    return {
      ...aso,
      clinicoVisivel,
      exames: clinicoVisivel ? exames : exames.map(({ resultado, observacao, ...e }: any) => e),
    };
  }

  /** Confere, sob o RLS do usuário, os cadastros referenciados (a chave estrangeira sozinha não olha o tenant). */
  private async conferirReferencias(tx: Tx, d: AsoInput) {
    const v = await tx.one(
      `SELECT v.empresa_id, v.data_admissao, v.data_desligamento FROM vinculo v WHERE v.id = $1`,
      [d.vinculoId],
    );
    if (!v) throw new NotFoundException({ mensagem: 'Vínculo do funcionário não encontrado' });
    if (!(await tx.one('SELECT 1 FROM medico WHERE id = $1', [d.medicoId]))) throw erro('Médico não encontrado');
    if (d.clinicaId && !(await tx.one('SELECT 1 FROM clinica WHERE id = $1', [d.clinicaId]))) throw erro('Clínica não encontrada');
    if (d.exames.length) {
      const n = (await tx.one('SELECT count(*)::int AS n FROM exame_tipo WHERE id = ANY($1::uuid[])', [d.exames.map((e) => e.exameTipoId)]))!.n;
      if (n !== d.exames.length) throw erro('Tipo de exame não encontrado');
    }
    return v as { empresa_id: string; data_admissao: string; data_desligamento: string | null };
  }

  private regras(d: AsoInput, hoje: string) {
    if (d.dataExame > hoje) throw erro('A data do exame não pode ser futura');
    for (const e of d.exames) if (e.dataRealizacao > hoje) throw erro('A data de realização do exame não pode ser futura');
  }

  async criar(u: Usuario, corpo: unknown) {
    const d = validar(asoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const v = await this.conferirReferencias(tx, d);
      u.exigir('saude.editar', v.empresa_id);
      this.regras(d, await hojeTx(tx));
      const r = await tx.one(
        `INSERT INTO aso (tenant_id, empresa_id, vinculo_id, tipo, data_exame, resultado, medico_id, clinica_id,
                          vencimento, riscos, observacoes, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, app.usuario_atual()) RETURNING id`,
        [v.empresa_id, d.vinculoId, d.tipo, d.dataExame, d.resultado, d.medicoId, d.clinicaId, d.vencimento, d.riscos, d.observacoes],
      );
      for (const e of d.exames) await this.inserirExame(tx, r!.id, v.empresa_id, e);
      return this.obterTx(u, tx, r!.id);
    });
  }

  private inserirExame(tx: Tx, asoId: string, empresaId: string, e: AsoInput['exames'][number]) {
    return tx.query(
      `INSERT INTO aso_exame (tenant_id, empresa_id, aso_id, exame_tipo_id, data_realizacao, ordem, criado_por)
       VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual())`,
      [empresaId, asoId, e.exameTipoId, e.dataRealizacao, e.ordem],
    );
  }

  /** Corrige um ASO. Exames mantidos (mesmo tipo) preservam o resultado clínico já lançado. */
  async atualizar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(asoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const atual = await tx.one('SELECT empresa_id, vinculo_id, cancelado_em FROM aso WHERE id = $1 FOR UPDATE', [id]);
      if (!atual) throw new NotFoundException({ mensagem: 'ASO não encontrado' });
      u.exigir('saude.editar', atual.empresa_id);
      if (atual.cancelado_em) throw erro('ASO cancelado não pode ser alterado');
      if (atual.vinculo_id !== d.vinculoId) throw erro('O funcionário do ASO não pode ser trocado. Cancele e registre outro.');
      await this.conferirReferencias(tx, d);
      this.regras(d, await hojeTx(tx));
      await tx.query(
        `UPDATE aso SET tipo = $2, data_exame = $3, resultado = $4, medico_id = $5, clinica_id = $6,
                        vencimento = $7, riscos = $8, observacoes = $9 WHERE id = $1`,
        [id, d.tipo, d.dataExame, d.resultado, d.medicoId, d.clinicaId, d.vencimento, d.riscos, d.observacoes],
      );
      const tipos = d.exames.map((e) => e.exameTipoId);
      await tx.query('DELETE FROM aso_exame WHERE aso_id = $1 AND NOT (exame_tipo_id = ANY($2::uuid[]))', [id, tipos]);
      for (const e of d.exames) {
        const r = await tx.query(
          'UPDATE aso_exame SET data_realizacao = $3, ordem = $4 WHERE aso_id = $1 AND exame_tipo_id = $2 RETURNING id',
          [id, e.exameTipoId, e.dataRealizacao, e.ordem],
        );
        if (!r.length) await this.inserirExame(tx, id, atual.empresa_id, e);
      }
      return this.obterTx(u, tx, id);
    });
  }

  async cancelar(u: Usuario, id: string, corpo: unknown) {
    const { motivo } = validar(cancelamentoSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const atual = await tx.one('SELECT empresa_id, cancelado_em FROM aso WHERE id = $1 FOR UPDATE', [id]);
      if (!atual) throw new NotFoundException({ mensagem: 'ASO não encontrado' });
      u.exigir('saude.editar', atual.empresa_id);
      if (atual.cancelado_em) throw erro('ASO já cancelado');
      await tx.query(
        'UPDATE aso SET cancelado_em = now(), cancelado_por = app.usuario_atual(), motivo_cancelamento = $2 WHERE id = $1',
        [id, motivo],
      );
      return this.obterTx(u, tx, id);
    });
  }

  /** Lança o resultado de um exame complementar. Só com saude.clinico na empresa (o banco também confere). */
  async registrarResultado(u: Usuario, asoExameId: string, corpo: unknown) {
    const d = validar(resultadoExameSchema, corpo);
    return this.banco.tx(u.ctx('resultado_exame'), async (tx) => {
      const ex = await tx.one(
        `SELECT e.empresa_id, a.cancelado_em, a.id AS aso_id FROM aso_exame e JOIN aso a ON a.id = e.aso_id WHERE e.id = $1`,
        [asoExameId],
      );
      if (!ex) throw new NotFoundException({ mensagem: 'Exame não encontrado' });
      u.exigir('saude.clinico', ex.empresa_id);
      if (ex.cancelado_em) throw erro('ASO cancelado não pode ser alterado');
      await tx.query(
        `INSERT INTO aso_exame_resultado (aso_exame_id, tenant_id, empresa_id, resultado, observacao, atualizado_por)
         VALUES ($1, app.tenant_atual(), $2, $3, $4, app.usuario_atual())
         ON CONFLICT (aso_exame_id) DO UPDATE SET resultado = EXCLUDED.resultado, observacao = EXCLUDED.observacao`,
        [asoExameId, ex.empresa_id, d.resultado, d.observacao],
      );
      return this.obterTx(u, tx, ex.aso_id);
    });
  }

  async anexar(u: Usuario, id: string, arq?: { originalname: string; mimetype: string; buffer: Buffer }) {
    if (!arq?.buffer?.length) throw new BadRequestException({ mensagem: 'Envie o arquivo do ASO' });
    if (!TIPOS_ARQUIVO[arq.mimetype] || !conteudoConfere(arq.buffer, arq.mimetype))
      throw new BadRequestException({ mensagem: 'O arquivo deve ser PDF, JPG ou PNG' });
    return this.banco.tx(u.ctx(), async (tx) => {
      const atual = await tx.one('SELECT empresa_id, arquivo_id, cancelado_em FROM aso WHERE id = $1 FOR UPDATE', [id]);
      if (!atual) throw new NotFoundException({ mensagem: 'ASO não encontrado' });
      u.exigir('saude.editar', atual.empresa_id);
      if (atual.cancelado_em) throw erro('ASO cancelado não pode ser alterado');
      const nome = arq.originalname.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 150) || `aso.${TIPOS_ARQUIVO[arq.mimetype]}`;
      const r = await tx.one(
        `INSERT INTO arquivo (tenant_id, empresa_id, nome, tipo_mime, tamanho, sha256, conteudo, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, app.usuario_atual()) RETURNING id`,
        [atual.empresa_id, nome, arq.mimetype, arq.buffer.length, createHash('sha256').update(arq.buffer).digest('hex'), arq.buffer],
      );
      await tx.query('UPDATE aso SET arquivo_id = $2 WHERE id = $1', [id, r!.id]);
      if (atual.arquivo_id) await tx.query('DELETE FROM arquivo WHERE id = $1', [atual.arquivo_id]);
      return this.obterTx(u, tx, id);
    });
  }

  async arquivo(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `SELECT a.empresa_id AS "empresaId", ar.nome, ar.tipo_mime AS "tipoMime", ar.conteudo FROM aso a JOIN arquivo ar ON ar.id = a.arquivo_id WHERE a.id = $1`,
        [id],
      );
      if (!r) throw new NotFoundException({ mensagem: 'Este ASO não tem arquivo anexado' });
      u.exigir('saude.ler', r.empresaId);
      return r as { nome: string; tipoMime: string; conteudo: Buffer };
    });
  }

  /** Dados para o PDF do ASO, incluindo o médico coordenador do PCMSO vigente na data do exame. */
  async dadosPdf(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const aso = await this.obterTx(u, tx, id);
      const extra = await tx.one(
        `SELECT e.razao_social AS "empresaNome", e.tipo_inscricao AS "empresaTipoInscricao", e.inscricao AS "empresaInscricao",
                fu.nome AS funcao, ca.nome AS cargo, se.nome AS setor,
                mc.nome AS "coordenadorNome", mc.crm AS "coordenadorCrm", mc.uf_crm AS "coordenadorUfCrm"
           FROM aso a JOIN empresa e ON e.id = a.empresa_id
           LEFT JOIN LATERAL (SELECT l.* FROM lotacao l WHERE l.vinculo_id = a.vinculo_id AND l.inicio <= a.data_exame
                               ORDER BY l.inicio DESC LIMIT 1) la ON true
           LEFT JOIN funcao fu ON fu.id = la.funcao_id
           LEFT JOIN cargo ca ON ca.id = la.cargo_id
           LEFT JOIN setor se ON se.id = la.setor_id
           LEFT JOIN LATERAL (SELECT m.* FROM medico_coordenador c JOIN medico m ON m.id = c.medico_id
                               WHERE c.empresa_id = a.empresa_id AND c.inicio <= a.data_exame
                                 AND (c.fim IS NULL OR c.fim >= a.data_exame) LIMIT 1) mc ON true
          WHERE a.id = $1`,
        [id],
      );
      return { ...aso, ...extra };
    });
  }
}

async function hojeTx(tx: Tx): Promise<string> {
  return (await tx.one<{ d: string }>('SELECT current_date AS d'))!.d;
}

/** Confere a assinatura do arquivo, não só o tipo declarado pelo navegador. */
export function conteudoConfere(b: Buffer, mime: string) {
  if (mime === 'application/pdf') return b.subarray(0, 5).toString('latin1') === '%PDF-';
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}
