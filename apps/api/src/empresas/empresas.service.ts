import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { EmpresaInput, EstabelecimentoInput } from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { Banco } from '../db/banco';

const COLS_EMPRESA = `id, tipo_inscricao AS "tipoInscricao", inscricao, razao_social AS "razaoSocial",
  nome_fantasia AS "nomeFantasia", cnae_principal AS "cnaePrincipal", cnaes_secundarios AS "cnaesSecundarios",
  grau_risco AS "grauRisco", natureza_juridica AS "naturezaJuridica", classificacao_tributaria AS "classificacaoTributaria",
  endereco, responsavel_nome AS "responsavelNome", responsavel_cpf AS "responsavelCpf",
  responsavel_email AS "responsavelEmail", responsavel_telefone AS "responsavelTelefone",
  contato_email AS "contatoEmail", contato_telefone AS "contatoTelefone", observacoes, ativo,
  criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"`;

const COLS_ESTAB = `id, empresa_id AS "empresaId", tipo_inscricao AS "tipoInscricao", inscricao, nome, matriz, cnae,
  grau_risco AS "grauRisco", endereco, observacoes, ativo, criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"`;

const paramsEmpresa = (d: EmpresaInput) => [
  d.tipoInscricao, d.inscricao, d.razaoSocial, d.nomeFantasia, d.cnaePrincipal, d.cnaesSecundarios, d.grauRisco,
  d.naturezaJuridica, d.classificacaoTributaria, JSON.stringify(d.endereco), d.responsavelNome, d.responsavelCpf,
  d.responsavelEmail, d.responsavelTelefone, d.contatoEmail, d.contatoTelefone, d.observacoes,
];

@Injectable()
export class EmpresasService {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  listar(u: Usuario, f: { busca?: string; incluirInativas?: boolean }) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `SELECT ${COLS_EMPRESA},
           (SELECT count(*)::int FROM estabelecimento e WHERE e.empresa_id = empresa.id AND e.ativo) AS "totalEstabelecimentos",
           (SELECT count(*)::int FROM vinculo v WHERE v.empresa_id = empresa.id
              AND (v.data_desligamento IS NULL OR v.data_desligamento >= current_date)) AS "totalFuncionariosAtivos"
         FROM empresa
         WHERE ($1::text IS NULL OR razao_social ILIKE '%' || $1 || '%' OR nome_fantasia ILIKE '%' || $1 || '%' OR inscricao LIKE regexp_replace($1, '\\D', '', 'g') || '%')
           AND ($2 OR ativo)
         ORDER BY razao_social`,
        [f.busca?.trim() || null, !!f.incluirInativas],
      ),
    );
  }

  async obter(u: Usuario, id: string) {
    const e = await this.banco.tx(u.ctx(), (tx) => tx.one(`SELECT ${COLS_EMPRESA} FROM empresa WHERE id = $1`, [id]));
    if (!e) throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
    return e;
  }

  async criar(u: Usuario, d: EmpresaInput) {
    if (!u.podeGlobal('empresas.editar'))
      throw new ForbiddenException({ mensagem: 'Somente usuários com acesso a todas as empresas podem cadastrar empresas' });
    return this.banco.tx(u.ctx(), (tx) =>
      tx.one(
        `INSERT INTO empresa (tenant_id, tipo_inscricao, inscricao, razao_social, nome_fantasia, cnae_principal, cnaes_secundarios,
           grau_risco, natureza_juridica, classificacao_tributaria, endereco, responsavel_nome, responsavel_cpf,
           responsavel_email, responsavel_telefone, contato_email, contato_telefone, observacoes, criado_por)
         VALUES (app.tenant_atual(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17, app.usuario_atual())
         RETURNING ${COLS_EMPRESA}`,
        paramsEmpresa(d),
      ),
    );
  }

  async atualizar(u: Usuario, id: string, d: EmpresaInput) {
    u.exigir('empresas.editar', id);
    const r = await this.banco.tx(u.ctx(), (tx) =>
      tx.one(
        `UPDATE empresa SET tipo_inscricao=$1, inscricao=$2, razao_social=$3, nome_fantasia=$4, cnae_principal=$5,
           cnaes_secundarios=$6, grau_risco=$7, natureza_juridica=$8, classificacao_tributaria=$9, endereco=$10::jsonb,
           responsavel_nome=$11, responsavel_cpf=$12, responsavel_email=$13, responsavel_telefone=$14,
           contato_email=$15, contato_telefone=$16, observacoes=$17
         WHERE id = $18 RETURNING ${COLS_EMPRESA}`,
        [...paramsEmpresa(d), id],
      ),
    );
    if (!r) throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
    return r;
  }

  async definirAtiva(u: Usuario, id: string, ativo: boolean) {
    u.exigir('empresas.editar', id);
    const r = await this.banco.tx(u.ctx(), (tx) => tx.one('UPDATE empresa SET ativo = $2 WHERE id = $1 RETURNING id', [id, ativo]));
    if (!r) throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
  }

  listarEstabelecimentos(u: Usuario, empresaId: string) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(`SELECT ${COLS_ESTAB} FROM estabelecimento WHERE empresa_id = $1 ORDER BY matriz DESC, nome`, [empresaId]),
    );
  }

  async criarEstabelecimento(u: Usuario, empresaId: string, d: EstabelecimentoInput) {
    u.exigir('empresas.editar', empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [empresaId])))
        throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
      return tx.one(
        `INSERT INTO estabelecimento (tenant_id, empresa_id, tipo_inscricao, inscricao, nome, matriz, cnae, grau_risco, endereco, observacoes, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, app.usuario_atual()) RETURNING ${COLS_ESTAB}`,
        [empresaId, d.tipoInscricao, d.inscricao, d.nome, d.matriz, d.cnae, d.grauRisco, JSON.stringify(d.endereco), d.observacoes],
      );
    });
  }

  async atualizarEstabelecimento(u: Usuario, id: string, d: EstabelecimentoInput & { ativo?: boolean }) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const atual = await tx.one('SELECT empresa_id FROM estabelecimento WHERE id = $1', [id]);
      if (!atual) throw new NotFoundException({ mensagem: 'Estabelecimento não encontrado' });
      u.exigir('empresas.editar', atual.empresa_id);
      return tx.one(
        `UPDATE estabelecimento SET tipo_inscricao=$2, inscricao=$3, nome=$4, matriz=$5, cnae=$6, grau_risco=$7,
           endereco=$8::jsonb, observacoes=$9, ativo=coalesce($10, ativo)
         WHERE id = $1 RETURNING ${COLS_ESTAB}`,
        [id, d.tipoInscricao, d.inscricao, d.nome, d.matriz, d.cnae, d.grauRisco, JSON.stringify(d.endereco), d.observacoes, d.ativo ?? null],
      );
    });
  }
}
