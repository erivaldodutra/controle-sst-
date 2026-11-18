import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { clinicaSchema, exameTipoSchema, medicoCoordenadorSchema, medicoSchema } from '@sst/shared';
import { ZodTypeAny } from 'zod';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';

interface Definicao {
  tabela: string;
  rotulo: string;
  schema: ZodTypeAny;
  /** campo da API -> coluna do banco */
  campos: Record<string, string>;
  ordem: string;
  /** Converte o corpo validado nos valores das colunas, na ordem de `campos`. */
  valores?: (d: any) => unknown[];
  /** Colunas extras devolvidas na leitura. */
  extras?: string;
}

/** Cadastros de saúde do tenant (valem para todas as empresas). */
export const CADASTROS: Record<string, Definicao> = {
  medicos: {
    tabela: 'medico', rotulo: 'Médico', schema: medicoSchema, ordem: 'nome',
    campos: { nome: 'nome', cpf: 'cpf', crm: 'crm', ufCrm: 'uf_crm', email: 'email', telefone: 'telefone', ativo: 'ativo' },
  },
  clinicas: {
    tabela: 'clinica', rotulo: 'Clínica', schema: clinicaSchema, ordem: 'razao_social',
    campos: {
      razaoSocial: 'razao_social', nomeFantasia: 'nome_fantasia', cnpj: 'cnpj', telefone: 'telefone', email: 'email',
      endereco: 'endereco', ativo: 'ativo',
    },
    valores: (d) => [d.razaoSocial, d.nomeFantasia, d.cnpj, d.telefone, d.email,
      JSON.stringify({ municipio: d.municipio, uf: d.uf }), d.ativo],
    extras: `endereco->>'municipio' AS municipio, endereco->>'uf' AS uf`,
  },
  'tipos-exame': {
    tabela: 'exame_tipo', rotulo: 'Tipo de exame', schema: exameTipoSchema, ordem: 'nome',
    campos: { nome: 'nome', codigoEsocial: 'codigo_esocial', descricao: 'descricao', ativo: 'ativo' },
  },
};

export function cadastro(tipo: string): Definicao {
  const d = CADASTROS[tipo];
  if (!d) throw new NotFoundException({ mensagem: 'Cadastro desconhecido' });
  return d;
}

const SELECT_COORDENADORES = `
  SELECT c.id, c.inicio, c.fim, m.id AS "medicoId", m.nome, m.crm, m.uf_crm AS "ufCrm"
    FROM medico_coordenador c JOIN medico m ON m.id = c.medico_id
   WHERE c.empresa_id = $1 ORDER BY c.inicio DESC`;

@Injectable()
export class CadastrosSaudeService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  private select(d: Definicao) {
    const cols = Object.entries(d.campos).map(([api, col]) => `${col} AS "${api}"`);
    return `SELECT id, ${cols.join(', ')}${d.extras ? ', ' + d.extras : ''} FROM ${d.tabela}`;
  }

  private valores(d: Definicao, dados: any) {
    return d.valores ? d.valores(dados) : Object.keys(d.campos).map((k) => dados[k]);
  }

  listar(u: Usuario, tipo: string, incluirInativos: boolean) {
    const d = cadastro(tipo);
    return this.banco.tx(u.ctx(), (tx) => tx.query(`${this.select(d)} WHERE ($1 OR ativo) ORDER BY ${d.ordem}`, [incluirInativos]));
  }

  criar(u: Usuario, tipo: string, corpo: unknown) {
    const d = cadastro(tipo);
    const dados = validar(d.schema, corpo);
    const cols = Object.values(d.campos);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `INSERT INTO ${d.tabela} (tenant_id, criado_por, ${cols.join(', ')})
         VALUES (app.tenant_atual(), app.usuario_atual(), ${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`,
        this.valores(d, dados),
      );
      return tx.one(`${this.select(d)} WHERE id = $1`, [r!.id]);
    });
  }

  atualizar(u: Usuario, tipo: string, id: string, corpo: unknown) {
    const d = cadastro(tipo);
    const dados = validar(d.schema, corpo);
    const sets = Object.values(d.campos).map((c, i) => `${c} = $${i + 2}`);
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.query(`UPDATE ${d.tabela} SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, [id, ...this.valores(d, dados)]);
      if (!r.length) throw new NotFoundException({ mensagem: `${d.rotulo} não encontrado(a)` });
      return tx.one(`${this.select(d)} WHERE id = $1`, [id]);
    });
  }

  // ---- Médico responsável pelo PCMSO, por empresa, com vigência ----

  coordenadores(u: Usuario, empresaId: string) {
    return this.banco.tx(u.ctx(), (tx) => tx.query(SELECT_COORDENADORES, [empresaId]));
  }

  /** Troca o coordenador: encerra o período atual no dia anterior ao novo início e abre outro. */
  definirCoordenador(u: Usuario, empresaId: string, corpo: unknown) {
    u.exigir('saude.editar', empresaId);
    const d = validar(medicoCoordenadorSchema, corpo);
    return this.banco.tx(u.ctx(), async (tx: Tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [empresaId])))
        throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
      if (!(await tx.one('SELECT 1 FROM medico WHERE id = $1 AND ativo', [d.medicoId])))
        throw new NotFoundException({ mensagem: 'Médico não encontrado ou inativo' });
      await tx.query(
        `UPDATE medico_coordenador SET fim = $2::date - 1 WHERE empresa_id = $1 AND fim IS NULL AND inicio < $2::date`,
        [empresaId, d.inicio],
      );
      await tx.query(
        `INSERT INTO medico_coordenador (tenant_id, empresa_id, medico_id, inicio, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, app.usuario_atual())`,
        [empresaId, d.medicoId, d.inicio],
      );
      return tx.query(SELECT_COORDENADORES, [empresaId]);
    });
  }
}
