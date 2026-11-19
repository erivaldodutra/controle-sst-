import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { cargoSchema, funcaoSchema, gheSchema, setorSchema } from '@sst/shared';
import { ZodTypeAny } from 'zod';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { Banco } from '../db/banco';

interface Definicao {
  tabela: string;
  rotulo: string;
  schema: ZodTypeAny;
  /** campo da API -> coluna do banco */
  campos: Record<string, string>;
  ordem: string;
  porEstabelecimento: boolean;
}

export const TIPOS: Record<string, Definicao> = {
  setores: {
    tabela: 'setor', rotulo: 'Setor', schema: setorSchema, ordem: 'nome', porEstabelecimento: true,
    campos: { estabelecimentoId: 'estabelecimento_id', nome: 'nome', descricao: 'descricao', ativo: 'ativo' },
  },
  cargos: {
    tabela: 'cargo', rotulo: 'Cargo', schema: cargoSchema, ordem: 'nome', porEstabelecimento: false,
    campos: { nome: 'nome', cbo: 'cbo', descricao: 'descricao', ativo: 'ativo' },
  },
  funcoes: {
    tabela: 'funcao', rotulo: 'Função', schema: funcaoSchema, ordem: 'nome', porEstabelecimento: false,
    campos: { nome: 'nome', cbo: 'cbo', descricaoAtividades: 'descricao_atividades', ativo: 'ativo' },
  },
  ghes: {
    tabela: 'ghe', rotulo: 'GHE', schema: gheSchema, ordem: 'codigo', porEstabelecimento: true,
    campos: { estabelecimentoId: 'estabelecimento_id', codigo: 'codigo', nome: 'nome', descricao: 'descricao', ativo: 'ativo' },
  },
};

export function definicao(tipo: string): Definicao {
  const d = TIPOS[tipo];
  if (!d) throw new NotFoundException({ mensagem: 'Tipo de cadastro desconhecido' });
  return d;
}

const p = (i: number) => '$' + i;

@Injectable()
export class EstruturaService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  private select(d: Definicao) {
    const cols = Object.entries(d.campos).map(([api, col]) => `t.${col} AS "${api}"`);
    const extra = d.porEstabelecimento ? ', e.nome AS "estabelecimentoNome"' : '';
    const join = d.porEstabelecimento ? 'JOIN estabelecimento e ON e.id = t.estabelecimento_id' : '';
    return `SELECT t.id, t.empresa_id AS "empresaId", ${cols.join(', ')}${extra},
              (SELECT count(*)::int FROM lotacao l WHERE l.${d.tabela}_id = t.id AND (l.fim IS NULL OR l.fim >= current_date)) AS "totalLotados"
            FROM ${d.tabela} t ${join}`;
  }

  listar(u: Usuario, tipo: string, empresaId: string, f: { estabelecimentoId?: string; incluirInativos?: boolean }) {
    const d = definicao(tipo);
    const filtroEstab = d.porEstabelecimento ? 'AND ($2::uuid IS NULL OR t.estabelecimento_id = $2)' : 'AND ($2::uuid IS NULL)';
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(`${this.select(d)} WHERE t.empresa_id = $1 ${filtroEstab} AND ($3 OR t.ativo) ORDER BY t.${d.ordem}`, [
        empresaId, d.porEstabelecimento ? f.estabelecimentoId ?? null : null, !!f.incluirInativos,
      ]),
    );
  }

  async criar(u: Usuario, tipo: string, empresaId: string, corpo: unknown) {
    const d = definicao(tipo);
    u.exigir('estrutura.editar', empresaId);
    const dados = parse(d, corpo);
    const cols = Object.values(d.campos);
    const valores = Object.keys(d.campos).map((k) => dados[k]);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `INSERT INTO ${d.tabela} (tenant_id, empresa_id, criado_por, ${cols.join(', ')})
         VALUES (app.tenant_atual(), $1, app.usuario_atual(), ${cols.map((_, i) => p(i + 2)).join(', ')}) RETURNING id`,
        [empresaId, ...valores],
      );
      return tx.one(`${this.select(d)} WHERE t.id = $1`, [r.id]);
    });
  }

  async atualizar(u: Usuario, tipo: string, id: string, corpo: unknown) {
    const d = definicao(tipo);
    const dados = parse(d, corpo);
    return this.banco.tx(u.ctx(), async (tx) => {
      const atual = await tx.one(`SELECT empresa_id FROM ${d.tabela} WHERE id = $1`, [id]);
      if (!atual) throw new NotFoundException({ mensagem: `${d.rotulo} não encontrado(a)` });
      u.exigir('estrutura.editar', atual.empresa_id);
      const sets = Object.values(d.campos).map((c, i) => `${c} = ${p(i + 2)}`);
      await tx.query(`UPDATE ${d.tabela} SET ${sets.join(', ')} WHERE id = $1`, [id, ...Object.keys(d.campos).map((k) => dados[k])]);
      return tx.one(`${this.select(d)} WHERE t.id = $1`, [id]);
    });
  }
}

function parse(d: Definicao, corpo: unknown): Record<string, unknown> {
  const r = d.schema.safeParse(corpo);
  if (!r.success)
    throw new BadRequestException({
      mensagem: 'Dados inválidos',
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    });
  return r.data as Record<string, unknown>;
}
