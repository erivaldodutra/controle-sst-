import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AdmissaoInput, MovimentacaoInput } from '@sst/shared';
import { z } from 'zod';
import { pessoaSchema, posicaoSchema } from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { Banco, Tx } from '../db/banco';

type Posicao = z.infer<typeof posicaoSchema>;
type Pessoa = z.infer<typeof pessoaSchema>;

export interface FiltroFuncionarios {
  empresaId?: string;
  estabelecimentoId?: string;
  setorId?: string;
  funcaoId?: string;
  gheId?: string;
  situacao?: string;
  busca?: string;
  pagina: number;
  limite: number;
}

const erro = (mensagem: string) => new UnprocessableEntityException({ mensagem });

/** Lotação vigente hoje, ou a última registrada (para desligados). */
const LOTACAO_ATUAL = `
  LEFT JOIN LATERAL (
    SELECT l.* FROM lotacao l WHERE l.vinculo_id = v.id
    ORDER BY (l.inicio <= current_date AND (l.fim IS NULL OR l.fim >= current_date)) DESC, l.inicio DESC LIMIT 1
  ) la ON true
  LEFT JOIN estabelecimento es ON es.id = la.estabelecimento_id
  LEFT JOIN setor se ON se.id = la.setor_id
  LEFT JOIN cargo ca ON ca.id = la.cargo_id
  LEFT JOIN funcao fu ON fu.id = la.funcao_id
  LEFT JOIN ghe gh ON gh.id = la.ghe_id`;

@Injectable()
export class FuncionariosService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  async listar(u: Usuario, f: FiltroFuncionarios) {
    const params: unknown[] = [];
    const cond: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      cond.push(sql.replace('?', '$' + params.length));
    };
    if (f.empresaId) add('v.empresa_id = ?', f.empresaId);
    if (f.estabelecimentoId) add('la.estabelecimento_id = ?', f.estabelecimentoId);
    if (f.setorId) add('la.setor_id = ?', f.setorId);
    if (f.funcaoId) add('la.funcao_id = ?', f.funcaoId);
    if (f.gheId) add('la.ghe_id = ?', f.gheId);
    if (f.situacao) add('s.situacao = ?', f.situacao);
    if (f.busca?.trim()) {
      const b = f.busca.trim();
      const dig = b.replace(/\D/g, '');
      params.push(`%${b}%`);
      const i = params.length;
      if (dig.length >= 3) {
        params.push(`${dig}%`);
        cond.push(`(fn.nome ILIKE $${i} OR v.matricula ILIKE $${i} OR fn.cpf LIKE $${i + 1})`);
      } else cond.push(`(fn.nome ILIKE $${i} OR v.matricula ILIKE $${i})`);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const base = `FROM vinculo v JOIN funcionario fn ON fn.id = v.funcionario_id
                  JOIN vinculo_situacao s ON s.vinculo_id = v.id ${LOTACAO_ATUAL} ${where}`;
    return this.banco.tx(u.ctx(), async (tx) => {
      const total = (await tx.one(`SELECT count(*)::int AS n ${base}`, params))!.n;
      params.push(f.limite, (f.pagina - 1) * f.limite);
      const itens = await tx.query(
        `SELECT fn.id AS "funcionarioId", v.id AS "vinculoId", v.empresa_id AS "empresaId", fn.nome, fn.cpf,
                v.matricula, v.data_admissao AS "dataAdmissao", v.data_desligamento AS "dataDesligamento", s.situacao,
                es.nome AS "estabelecimento", se.nome AS "setor", ca.nome AS "cargo", fu.nome AS "funcao",
                coalesce(fu.cbo, ca.cbo) AS cbo, gh.codigo AS "ghe"
         ${base} ORDER BY fn.nome, v.data_admissao DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { total, pagina: f.pagina, limite: f.limite, itens };
    });
  }

  async obter(u: Usuario, funcionarioId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const pessoa = await tx.one(
        `SELECT id, empresa_id AS "empresaId", nome, cpf, data_nascimento AS "dataNascimento", sexo, email, telefone,
                criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"
           FROM funcionario WHERE id = $1`,
        [funcionarioId],
      );
      if (!pessoa) throw new NotFoundException({ mensagem: 'Funcionário não encontrado' });
      const vinculos = await tx.query(
        `SELECT v.id, v.matricula, v.data_admissao AS "dataAdmissao", v.data_desligamento AS "dataDesligamento",
                v.motivo_desligamento AS "motivoDesligamento", v.categoria, v.tipo_contrato AS "tipoContrato", v.jornada,
                s.situacao
           FROM vinculo v JOIN vinculo_situacao s ON s.vinculo_id = v.id
          WHERE v.funcionario_id = $1 ORDER BY v.data_admissao DESC`,
        [funcionarioId],
      );
      const ids = vinculos.map((v) => v.id);
      const lotacoes = ids.length
        ? await tx.query(
            `SELECT l.id, l.vinculo_id AS "vinculoId", l.inicio, l.fim, l.motivo,
                    l.estabelecimento_id AS "estabelecimentoId", es.nome AS estabelecimento,
                    l.setor_id AS "setorId", se.nome AS setor, l.cargo_id AS "cargoId", ca.nome AS cargo,
                    l.funcao_id AS "funcaoId", fu.nome AS funcao, coalesce(fu.cbo, ca.cbo) AS cbo,
                    l.ghe_id AS "gheId", gh.codigo || ' - ' || gh.nome AS ghe,
                    l.criado_em AS "registradoEm", us.nome AS "registradoPor"
               FROM lotacao l
               JOIN estabelecimento es ON es.id = l.estabelecimento_id
               LEFT JOIN setor se ON se.id = l.setor_id LEFT JOIN cargo ca ON ca.id = l.cargo_id
               LEFT JOIN funcao fu ON fu.id = l.funcao_id LEFT JOIN ghe gh ON gh.id = l.ghe_id
               LEFT JOIN usuario us ON us.id = l.criado_por
              WHERE l.vinculo_id = ANY($1) ORDER BY l.inicio DESC`,
            [ids],
          )
        : [];
      const afastamentos = ids.length
        ? await tx.query(
            `SELECT id, vinculo_id AS "vinculoId", inicio, fim, motivo FROM afastamento
              WHERE vinculo_id = ANY($1) ORDER BY inicio DESC`,
            [ids],
          )
        : [];
      return {
        ...pessoa,
        vinculos: vinculos.map((v) => ({
          ...v,
          lotacoes: lotacoes.filter((l) => l.vinculoId === v.id),
          afastamentos: afastamentos.filter((a) => a.vinculoId === v.id),
        })),
      };
    });
  }

  /** Confere se setor e GHE pertencem ao estabelecimento informado e se tudo está ativo. */
  private async validarPosicao(tx: Tx, empresaId: string, p: Posicao) {
    const est = await tx.one('SELECT ativo FROM estabelecimento WHERE id = $1 AND empresa_id = $2', [p.estabelecimentoId, empresaId]);
    if (!est) throw erro('Estabelecimento não pertence a esta empresa');
    if (!est.ativo) throw erro('Estabelecimento inativo');
    const checar = async (tabela: string, id: string | null, rotulo: string, doEstab: boolean) => {
      if (!id) return;
      const r = await tx.one(`SELECT ativo${doEstab ? ', estabelecimento_id' : ''} FROM ${tabela} WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
      if (!r) throw erro(`${rotulo} não pertence a esta empresa`);
      if (!r.ativo) throw erro(`${rotulo} está inativo(a)`);
      if (doEstab && r.estabelecimento_id !== p.estabelecimentoId) throw erro(`${rotulo} pertence a outro estabelecimento`);
    };
    await checar('setor', p.setorId, 'Setor', true);
    await checar('ghe', p.gheId, 'GHE', true);
    await checar('cargo', p.cargoId, 'Cargo', false);
    await checar('funcao', p.funcaoId, 'Função', false);
  }

  private async inserirLotacao(tx: Tx, empresaId: string, vinculoId: string, inicio: string, motivo: string, p: Posicao) {
    await tx.query(
      `INSERT INTO lotacao (tenant_id, empresa_id, vinculo_id, estabelecimento_id, setor_id, cargo_id, funcao_id, ghe_id, inicio, motivo, criado_por)
       VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, app.usuario_atual())`,
      [empresaId, vinculoId, p.estabelecimentoId, p.setorId, p.cargoId, p.funcaoId, p.gheId, inicio, motivo],
    );
  }

  /** Admissão: cria (ou reaproveita) a pessoa, o vínculo e a primeira lotação. */
  async admitir(u: Usuario, empresaId: string, d: AdmissaoInput, tx?: Tx) {
    u.exigir('funcionarios.editar', empresaId);
    const executar = async (tx: Tx) => {
      await this.validarPosicao(tx, empresaId, d.posicao);
      let pessoa = await tx.one('SELECT id FROM funcionario WHERE empresa_id = $1 AND cpf = $2', [empresaId, d.pessoa.cpf]);
      if (pessoa) {
        const ativo = await tx.one(
          `SELECT 1 FROM vinculo WHERE funcionario_id = $1 AND (data_desligamento IS NULL OR data_desligamento >= $2)`,
          [pessoa.id, d.dataAdmissao],
        );
        if (ativo) throw new ConflictException({ mensagem: 'Este CPF já tem vínculo ativo nesta empresa na data de admissão' });
        await this.gravarPessoa(tx, pessoa.id, d.pessoa);
      } else {
        pessoa = await tx.one(
          `INSERT INTO funcionario (tenant_id, empresa_id, nome, cpf, data_nascimento, sexo, email, telefone, criado_por)
           VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, app.usuario_atual()) RETURNING id`,
          [empresaId, d.pessoa.nome, d.pessoa.cpf, d.pessoa.dataNascimento, d.pessoa.sexo, d.pessoa.email, d.pessoa.telefone],
        );
      }
      const v = await tx.one(
        `INSERT INTO vinculo (tenant_id, empresa_id, funcionario_id, matricula, data_admissao, categoria, tipo_contrato, jornada, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, app.usuario_atual()) RETURNING id`,
        [empresaId, pessoa!.id, d.matricula, d.dataAdmissao, d.categoria, d.tipoContrato, d.jornada],
      );
      await this.inserirLotacao(tx, empresaId, v!.id, d.dataAdmissao, 'Admissão', d.posicao);
      return { funcionarioId: pessoa!.id as string, vinculoId: v!.id as string };
    };
    return tx ? executar(tx) : this.banco.tx(u.ctx('admissao'), executar);
  }

  private gravarPessoa(tx: Tx, id: string, p: Pessoa) {
    return tx.query(
      `UPDATE funcionario SET nome=$2, cpf=$3, data_nascimento=$4, sexo=$5, email=$6, telefone=$7 WHERE id=$1`,
      [id, p.nome, p.cpf, p.dataNascimento, p.sexo, p.email, p.telefone],
    );
  }

  async atualizarPessoa(u: Usuario, funcionarioId: string, p: Pessoa) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const f = await tx.one('SELECT empresa_id FROM funcionario WHERE id = $1', [funcionarioId]);
      if (!f) throw new NotFoundException({ mensagem: 'Funcionário não encontrado' });
      u.exigir('funcionarios.editar', f.empresa_id);
      await this.gravarPessoa(tx, funcionarioId, p);
    });
  }

  async atualizarVinculo(
    u: Usuario,
    vinculoId: string,
    d: { matricula: string; categoria: string | null; tipoContrato: number | null; jornada: string | null },
  ) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const v = await this.vinculo(tx, vinculoId);
      u.exigir('funcionarios.editar', v.empresa_id);
      await tx.query('UPDATE vinculo SET matricula=$2, categoria=$3, tipo_contrato=$4, jornada=$5 WHERE id=$1', [
        vinculoId, d.matricula, d.categoria, d.tipoContrato, d.jornada,
      ]);
    });
  }

  private async vinculo(tx: Tx, id: string) {
    const v = await tx.one('SELECT id, empresa_id, data_admissao, data_desligamento FROM vinculo WHERE id = $1', [id]);
    if (!v) throw new NotFoundException({ mensagem: 'Vínculo não encontrado' });
    return v;
  }

  /**
   * Transferência de setor, mudança de função, cargo, GHE ou estabelecimento.
   * Fecha a lotação vigente na véspera e abre outra; nada é sobrescrito.
   */
  private async movimentarEm(tx: Tx, u: Usuario, vinculoId: string, d: MovimentacaoInput) {
    const v = await this.vinculo(tx, vinculoId);
    u.exigir('funcionarios.editar', v.empresa_id);
    if (v.data_desligamento && d.inicio > iso(v.data_desligamento)) throw erro('A movimentação é posterior ao desligamento');
    if (d.inicio < iso(v.data_admissao)) throw erro('A movimentação é anterior à admissão');
    const atual = await tx.one(
      `SELECT * FROM lotacao WHERE vinculo_id = $1 ORDER BY inicio DESC LIMIT 1`,
      [vinculoId],
    );
    if (atual) {
      if (d.inicio <= iso(atual.inicio))
        throw erro('A nova lotação precisa começar depois do início da lotação atual. Para corrigir um lançamento, registre uma nova movimentação com a data correta.');
      const mesma = ['estabelecimento_id', 'setor_id', 'cargo_id', 'funcao_id', 'ghe_id'].every(
        (c, i) => atual[c] === [d.posicao.estabelecimentoId, d.posicao.setorId, d.posicao.cargoId, d.posicao.funcaoId, d.posicao.gheId][i],
      );
      if (mesma) throw erro('A nova posição é igual à atual');
      if (atual.fim === null || iso(atual.fim) >= d.inicio)
        await tx.query(`UPDATE lotacao SET fim = $2::date - 1 WHERE id = $1`, [atual.id, d.inicio]);
    }
    await this.validarPosicao(tx, v.empresa_id, d.posicao);
    await this.inserirLotacao(tx, v.empresa_id, vinculoId, d.inicio, d.motivo, d.posicao);
  }

  movimentar(u: Usuario, vinculoId: string, d: MovimentacaoInput) {
    return this.banco.tx(u.ctx('movimentacao'), (tx) => this.movimentarEm(tx, u, vinculoId, d));
  }

  /** Atualização em lote: aplica a mesma movimentação a vários vínculos; ou todos, ou nenhum. */
  movimentarLote(u: Usuario, vinculoIds: string[], d: MovimentacaoInput) {
    return this.banco.tx(u.ctx('movimentacao_lote'), async (tx) => {
      for (const id of vinculoIds) {
        try {
          await this.movimentarEm(tx, u, id, d);
        } catch (e: any) {
          const nome = (await tx.one('SELECT f.nome FROM vinculo v JOIN funcionario f ON f.id = v.funcionario_id WHERE v.id = $1', [id]))?.nome;
          const msg = e?.response?.mensagem ?? e?.message;
          throw erro(`${nome ?? id}: ${msg}. Nenhuma alteração do lote foi gravada.`);
        }
      }
      return { movimentados: vinculoIds.length };
    });
  }

  async afastar(u: Usuario, vinculoId: string, d: { inicio: string; fim: string | null; motivo: string }) {
    return this.banco.tx(u.ctx('afastamento'), async (tx) => {
      const v = await this.vinculo(tx, vinculoId);
      u.exigir('funcionarios.editar', v.empresa_id);
      if (d.inicio < iso(v.data_admissao)) throw erro('O afastamento é anterior à admissão');
      if (v.data_desligamento && d.inicio > iso(v.data_desligamento)) throw erro('O afastamento é posterior ao desligamento');
      return tx.one(
        `INSERT INTO afastamento (tenant_id, empresa_id, vinculo_id, inicio, fim, motivo, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, app.usuario_atual()) RETURNING id`,
        [v.empresa_id, vinculoId, d.inicio, d.fim, d.motivo],
      );
    });
  }

  async encerrarAfastamento(u: Usuario, afastamentoId: string, fim: string) {
    return this.banco.tx(u.ctx('afastamento_fim'), async (tx) => {
      const a = await tx.one('SELECT empresa_id, inicio, fim FROM afastamento WHERE id = $1', [afastamentoId]);
      if (!a) throw new NotFoundException({ mensagem: 'Afastamento não encontrado' });
      u.exigir('funcionarios.editar', a.empresa_id);
      if (a.fim) throw erro('Este afastamento já foi encerrado');
      if (fim < iso(a.inicio)) throw erro('O retorno não pode ser anterior ao início do afastamento');
      await tx.query('UPDATE afastamento SET fim = $2 WHERE id = $1', [afastamentoId, fim]);
    });
  }

  async desligar(u: Usuario, vinculoId: string, data: string, motivo: string | null) {
    return this.banco.tx(u.ctx('desligamento'), async (tx) => {
      const v = await this.vinculo(tx, vinculoId);
      u.exigir('funcionarios.editar', v.empresa_id);
      if (v.data_desligamento) throw erro('Este vínculo já está desligado');
      if (data < iso(v.data_admissao)) throw erro('O desligamento é anterior à admissão');
      const ultima = await tx.one('SELECT id, inicio, fim FROM lotacao WHERE vinculo_id = $1 ORDER BY inicio DESC LIMIT 1', [vinculoId]);
      if (ultima && data < iso(ultima.inicio)) throw erro('O desligamento é anterior à última movimentação registrada');
      if (await tx.one('SELECT 1 FROM afastamento WHERE vinculo_id = $1 AND inicio > $2', [vinculoId, data]))
        throw erro('Há afastamento iniciado depois da data de desligamento. Corrija o afastamento antes de desligar.');
      await tx.query('UPDATE vinculo SET data_desligamento = $2, motivo_desligamento = $3 WHERE id = $1', [vinculoId, data, motivo]);
      if (ultima && (ultima.fim === null || iso(ultima.fim) > data))
        await tx.query('UPDATE lotacao SET fim = $2 WHERE id = $1', [ultima.id, data]);
      await tx.query('UPDATE afastamento SET fim = $2 WHERE vinculo_id = $1 AND (fim IS NULL OR fim > $2)', [vinculoId, data]);
    });
  }

  /** Histórico de alterações do funcionário (auditoria de pessoa, vínculos, lotações e afastamentos). */
  async historico(u: Usuario, funcionarioId: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const f = await tx.one('SELECT id FROM funcionario WHERE id = $1', [funcionarioId]);
      if (!f) throw new NotFoundException({ mensagem: 'Funcionário não encontrado' });
      return tx.query(
        `SELECT a.id, a.tabela, a.operacao, a.antes, a.depois, a.contexto, a.criado_em AS "em", us.nome AS usuario
           FROM auditoria a LEFT JOIN usuario us ON us.id = a.usuario_id
          WHERE (a.tabela = 'funcionario' AND a.registro_id = $1)
             OR (a.tabela IN ('vinculo') AND a.depois->>'funcionario_id' = $1)
             OR (a.tabela IN ('lotacao', 'afastamento') AND (a.depois->>'vinculo_id' IN (SELECT id::text FROM vinculo WHERE funcionario_id = $1::uuid)))
          ORDER BY a.criado_em DESC, a.id DESC LIMIT 500`,
        [funcionarioId],
      );
    });
  }
}

/** pg devolve date como Date em hora local; converte para AAAA-MM-DD sem deslocamento. */
export function iso(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
