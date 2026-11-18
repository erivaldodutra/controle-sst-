import { Controller, Get, Inject, Query } from '@nestjs/common';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { Banco } from '../db/banco';
import { Eu, Requer } from '../auth/decoradores';

@Controller()
export class PainelController {
  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  /** Contagens reais da Fase 1. Os indicadores completos entram na Fase 6. */
  @Get('painel/contagens')
  @Requer('empresas.ler')
  contagens(@Eu() u: Usuario, @Query('empresaId') empresaId?: string) {
    const emp = empresaId ? uuidValido(empresaId) : null;
    return this.banco.tx(u.ctx(), async (tx) => {
      const r = await tx.one(
        `SELECT
           (SELECT count(*)::int FROM empresa WHERE ativo AND ($1::uuid IS NULL OR id = $1)) AS empresas,
           (SELECT count(*)::int FROM estabelecimento WHERE ativo AND ($1::uuid IS NULL OR empresa_id = $1)) AS estabelecimentos,
           (SELECT count(*)::int FROM vinculo v WHERE ($1::uuid IS NULL OR v.empresa_id = $1)) AS "vinculosTotal",
           (SELECT count(*)::int FROM vinculo v JOIN vinculo_situacao s ON s.vinculo_id = v.id WHERE s.situacao = 'ativo' AND ($1::uuid IS NULL OR v.empresa_id = $1)) AS ativos,
           (SELECT count(*)::int FROM vinculo v JOIN vinculo_situacao s ON s.vinculo_id = v.id WHERE s.situacao = 'afastado' AND ($1::uuid IS NULL OR v.empresa_id = $1)) AS afastados,
           (SELECT count(*)::int FROM vinculo v JOIN vinculo_situacao s ON s.vinculo_id = v.id WHERE s.situacao = 'desligado' AND ($1::uuid IS NULL OR v.empresa_id = $1)) AS desligados,
           (SELECT count(*)::int FROM vinculo v WHERE v.data_admissao BETWEEN current_date - 30 AND current_date AND ($1::uuid IS NULL OR v.empresa_id = $1)) AS "admissoes30Dias"`,
        [emp],
      );
      return r;
    });
  }

  /** Busca global: funcionários (nome, CPF, matrícula) e empresas (nome, CNPJ). */
  @Get('busca')
  @Requer('empresas.ler')
  busca(@Eu() u: Usuario, @Query('q') q = '') {
    const termo = q.trim();
    if (termo.length < 2) return { empresas: [], funcionarios: [] };
    const dig = termo.replace(/\D/g, '');
    return this.banco.tx(u.ctx(), async (tx) => {
      const empresas = await tx.query(
        `SELECT id, razao_social AS "razaoSocial", nome_fantasia AS "nomeFantasia", inscricao FROM empresa
          WHERE razao_social ILIKE $1 OR nome_fantasia ILIKE $1 OR ($2 <> '' AND inscricao LIKE $2 || '%')
          ORDER BY razao_social LIMIT 8`,
        [`%${termo}%`, dig.length >= 3 ? dig : ''],
      );
      const funcionarios = u.pode('funcionarios.ler')
        ? await tx.query(
            `SELECT DISTINCT ON (f.id) f.id, f.nome, f.cpf, v.matricula, e.razao_social AS empresa
               FROM funcionario f JOIN empresa e ON e.id = f.empresa_id LEFT JOIN vinculo v ON v.funcionario_id = f.id
              WHERE f.nome ILIKE $1 OR v.matricula ILIKE $1 OR ($2 <> '' AND f.cpf LIKE $2 || '%')
              ORDER BY f.id, v.data_admissao DESC LIMIT 12`,
            [`%${termo}%`, dig.length >= 3 ? dig : ''],
          )
        : [];
      return { empresas, funcionarios };
    });
  }

  @Get('auditoria')
  @Requer('auditoria.ler')
  auditoria(@Eu() u: Usuario, @Query() q: Record<string, string>) {
    const limite = Math.min(500, Math.max(1, Number(q.limite) || 100));
    const pagina = Math.max(1, Number(q.pagina) || 1);
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `SELECT a.id, a.tabela, a.registro_id AS "registroId", a.operacao, a.antes, a.depois, a.contexto,
                a.criado_em AS em, us.nome AS usuario, e.razao_social AS empresa
           FROM auditoria a LEFT JOIN usuario us ON us.id = a.usuario_id LEFT JOIN empresa e ON e.id = a.empresa_id
          WHERE ($1::uuid IS NULL OR a.empresa_id = $1) AND ($2::text IS NULL OR a.tabela = $2)
            AND ($3::uuid IS NULL OR a.usuario_id = $3)
          ORDER BY a.id DESC LIMIT $4 OFFSET $5`,
        [q.empresaId ? uuidValido(q.empresaId) : null, q.tabela || null, q.usuarioId ? uuidValido(q.usuarioId) : null, limite, (pagina - 1) * limite],
      ),
    );
  }
}
