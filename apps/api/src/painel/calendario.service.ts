import { Inject, Injectable } from '@nestjs/common';
import {
  CATEGORIAS_ALERTA, estadoPrazo, LISTA_CATEGORIAS, preferenciasSchema, prazoEvento, TIPOS_EVENTO_ESOCIAL, TIPOS_PRAZO,
  type CategoriaAlerta, type ItemCalendario, type TipoPrazo,
} from '@sst/shared';
import { referencia } from '../acoes/comum';
import { AcoesService } from '../acoes/acoes.service';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco } from '../db/banco';
import { DocumentosService } from '../documentos/documentos.service';
import { VencimentosService } from '../saude/vencimentos.service';

/**
 * Calendário de obrigações: junta os prazos que os módulos já controlam (ASO, treinamentos,
 * documentos, ações, eventos do eSocial e certificado digital). Nada é digitado de novo, e cada
 * módulo aplica as próprias permissões.
 */
@Injectable()
export class CalendarioService {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    private readonly vencimentos: VencimentosService,
    private readonly documentos: DocumentosService,
    private readonly acoes: AcoesService,
  ) {}

  async itens(u: Usuario, f: { empresaId?: string; ate?: string }): Promise<{ hoje: string; janela: number; itens: ItemCalendario[] }> {
    const { hoje, janela } = await this.banco.tx(u.ctx(), (tx) => referencia(tx));
    const itens: ItemCalendario[] = [];
    const add = (categoria: CategoriaAlerta, chave: string, data: string | null, i: Omit<ItemCalendario, 'categoria' | 'chave' | 'data' | 'estado' | 'dias'>) => {
      if (!data) return;
      const d = String(data).slice(0, 10);
      itens.push({ categoria, chave: `${categoria}:${chave}:${d}`, data: d, ...estadoPrazo(d, hoje, janela), ...i });
    };

    if (u.pode('saude.ler', f.empresaId) || u.pode('treinamentos.ler', f.empresaId)) {
      const v = await this.vencimentos.listar(u, { empresaId: f.empresaId, incluirEmDia: true });
      for (const x of v.itens)
        add(x.tipo, `${x.tipo === 'aso' ? 'v' : `${x.referenciaId}`}:${x.funcionarioId}:${x.matricula}`, x.vencimento, {
          titulo: `${x.tipo === 'aso' ? 'ASO periódico' : `Treinamento: ${x.descricao}`} de ${x.funcionarioNome}`,
          detalhe: `Matrícula ${x.matricula}`, empresaId: x.empresaId, empresa: x.empresa, link: `/funcionarios/${x.funcionarioId}`,
        });
    }

    if (u.pode('documentos.ler', f.empresaId)) {
      const d = await this.documentos.listar(u, { empresaId: f.empresaId });
      for (const doc of d.itens as any[])
        for (const p of doc.prazos ?? [])
          add('documento', `${doc.id}:${p.tipo}`, p.data, {
            titulo: `${TIPOS_PRAZO[p.tipo as TipoPrazo]}: ${doc.tipoSigla ?? doc.tipoNome} ${doc.identificacao ?? ''}`.trim(),
            detalhe: doc.estabelecimentoNome ?? null, empresaId: doc.empresaId, empresa: doc.empresaNome, link: `/documentos/${doc.id}`,
          });
    }

    if (u.pode('acoes.ler', f.empresaId)) {
      const a = await this.acoes.listar(u, { empresaId: f.empresaId, situacao: 'abertas' });
      for (const x of a.itens as any[])
        add('acao', x.id, x.prazo, {
          titulo: `Ação ${x.codigo}: ${x.descricao}`, detalhe: `Responsável: ${x.responsavelNome}`,
          empresaId: x.empresaId, empresa: x.empresaNome, link: `/acoes/${x.id}`,
        });
    }

    await this.banco.tx(u.ctx(), async (tx) => {
      const filtroEsocial = (alias: string, p: unknown[]) => {
        const c: string[] = [];
        if (f.empresaId) { p.push(f.empresaId); c.push(`${alias}.empresa_id = $${p.length}`); }
        const perm = u.empresasCom('esocial.ler');
        if (perm !== '*') { p.push(perm); c.push(`${alias}.empresa_id = ANY($${p.length}::uuid[])`); }
        return c.length ? `AND ${c.join(' AND ')}` : '';
      };
      if (u.pode('esocial.ler', f.empresaId)) {
        const p: unknown[] = [];
        const evs = await tx.query(
          `SELECT e.id, e.tipo, e.referencia::text AS referencia, e.situacao, e.empresa_id AS "empresaId", em.razao_social AS empresa,
                  f.nome AS funcionario
             FROM esocial_evento e JOIN empresa em ON em.id = e.empresa_id
             LEFT JOIN vinculo v ON v.id = e.vinculo_id LEFT JOIN funcionario f ON f.id = v.funcionario_id
            WHERE e.situacao IN ('invalido', 'pendente', 'aprovado', 'rejeitado') ${filtroEsocial('e', p)}`, p);
        for (const e of evs)
          add('esocial', e.id, prazoEvento(e.tipo, e.referencia), {
            titulo: `${e.tipo} ${TIPOS_EVENTO_ESOCIAL[e.tipo as keyof typeof TIPOS_EVENTO_ESOCIAL] ?? ''}${e.funcionario ? ` de ${e.funcionario}` : ''}`,
            detalhe: e.situacao === 'aprovado' ? 'Aprovado, falta enviar' : e.situacao === 'pendente' ? 'Aguardando aprovação' : 'Com erro ou rejeitado',
            empresaId: e.empresaId, empresa: e.empresa, link: `/esocial/eventos/${e.id}`,
          });
        const p2: unknown[] = [];
        const certs = await tx.query(
          `SELECT c.id, c.titular, c.valido_ate::date::text AS ate, c.empresa_id AS "empresaId", em.razao_social AS empresa
             FROM esocial_certificado c JOIN empresa em ON em.id = c.empresa_id WHERE c.ativo ${filtroEsocial('c', p2)}`, p2);
        for (const c of certs)
          add('certificado', c.id, c.ate, {
            titulo: `Certificado digital A1 vence (${c.titular})`, detalhe: 'Sem certificado válido não é possível assinar nem enviar eventos',
            empresaId: c.empresaId, empresa: c.empresa, link: '/esocial/config',
          });
      }
    });

    const filtrados = f.ate ? itens.filter((i) => i.estado !== 'futuro' || i.data <= f.ate!) : itens;
    filtrados.sort((a, b) => a.data.localeCompare(b.data) || a.titulo.localeCompare(b.titulo));
    return { hoje, janela, itens: filtrados };
  }

  // ------------------------------------------------------------------ notificações

  async preferencias(u: Usuario) {
    const linhas = await this.banco.tx(u.ctx(), (tx) => tx.query('SELECT categoria, ativo FROM preferencia_notificacao'));
    const m = Object.fromEntries(linhas.map((l) => [l.categoria, l.ativo]));
    return { categorias: Object.fromEntries(LISTA_CATEGORIAS.map((c) => [c, m[c] ?? true])) as Record<CategoriaAlerta, boolean> };
  }

  async salvarPreferencias(u: Usuario, corpo: unknown) {
    const d = validar(preferenciasSchema, corpo);
    await this.banco.tx(u.ctx(), async (tx) => {
      for (const [categoria, ativo] of Object.entries(d.categorias))
        await tx.query(
          `INSERT INTO preferencia_notificacao (tenant_id, usuario_id, categoria, ativo) VALUES (app.tenant_atual(), app.usuario_atual(), $1, $2)
           ON CONFLICT (usuario_id, categoria) DO UPDATE SET ativo = $2`, [categoria, ativo]);
    });
    return this.preferencias(u);
  }

  /**
   * Gera os avisos que faltam (prazos atrasados ou dentro da janela, nas categorias ativas)
   * e devolve os do usuário. Roda no contexto do próprio usuário, então respeita as permissões.
   */
  async notificacoes(u: Usuario, f: { todas?: boolean } = {}) {
    const [{ itens }, pref] = await Promise.all([this.itens(u, {}), this.preferencias(u)]);
    const avisos = itens.filter((i) => i.estado !== 'futuro' && pref.categorias[i.categoria]);
    return this.banco.tx(u.ctx(), async (tx) => {
      for (const i of avisos)
        await tx.query(
          `INSERT INTO notificacao (tenant_id, usuario_id, empresa_id, categoria, chave, titulo, detalhe, link, data, estado)
           VALUES (app.tenant_atual(), app.usuario_atual(), $1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (usuario_id, chave) DO NOTHING`,
          [i.empresaId, i.categoria, `${i.chave}:${i.estado}`, i.titulo, i.detalhe, i.link, i.data, i.estado]);
      // Aviso cujo prazo deixou de existir (ASO renovado, ação concluída) sai da lista de não lidas.
      const vivas = avisos.map((i) => `${i.chave}:${i.estado}`);
      await tx.query(`UPDATE notificacao SET lida_em = now() WHERE lida_em IS NULL AND NOT (chave = ANY($1::text[]))`, [vivas]);
      const lista = await tx.query(
        `SELECT n.id, n.categoria, n.titulo, n.detalhe, n.link, n.data::text AS data, n.estado, n.criada_em AS "criadaEm", n.lida_em AS "lidaEm",
                e.razao_social AS empresa
           FROM notificacao n LEFT JOIN empresa e ON e.id = n.empresa_id
          ${f.todas ? '' : 'WHERE n.lida_em IS NULL'}
          ORDER BY n.lida_em IS NULL DESC, n.estado = 'atrasado' DESC, n.data, n.criada_em DESC LIMIT 200`);
      const naoLidas = (await tx.one('SELECT count(*)::int AS n FROM notificacao WHERE lida_em IS NULL'))!.n;
      return { naoLidas, itens: lista, categorias: CATEGORIAS_ALERTA };
    });
  }

  async marcarLida(u: Usuario, id: string | 'todas') {
    await this.banco.tx(u.ctx(), (tx) => id === 'todas'
      ? tx.query('UPDATE notificacao SET lida_em = now() WHERE lida_em IS NULL')
      : tx.query('UPDATE notificacao SET lida_em = coalesce(lida_em, now()) WHERE id = $1', [id]));
    return { ok: true };
  }
}
