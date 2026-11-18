import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { Banco, Tx } from '../db/banco';
import { AuthService } from '../auth/auth.service';

interface DadosUsuario {
  nome: string;
  email: string;
  ativo: boolean;
  atribuicoes: { perfil: string; empresaId: string | null }[];
}

@Injectable()
export class UsuariosService {
  constructor(@Inject(BANCO) private readonly banco: Banco, private readonly auth: AuthService) {}

  /** Só quem gerencia usuários em todas as empresas pode dar acesso global ou perfil de administrador geral. */
  private conferirEscopo(u: Usuario, atrib: DadosUsuario['atribuicoes']) {
    for (const a of atrib) {
      if (a.empresaId === null || a.perfil === 'ADMIN_GERAL') {
        if (!u.podeGlobal('usuarios.gerenciar'))
          throw new ForbiddenException({ mensagem: 'Somente o administrador geral concede acesso a todas as empresas' });
      } else u.exigir('usuarios.gerenciar', a.empresaId);
    }
  }

  listar(u: Usuario) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `SELECT us.id, us.nome, us.email, us.ativo, us.mfa_ativo AS "mfaAtivo", us.ultimo_acesso_em AS "ultimoAcessoEm",
                us.bloqueado_ate > now() AS bloqueado,
                coalesce(json_agg(json_build_object('perfil', p.codigo, 'perfilNome', p.nome, 'empresaId', a.empresa_id,
                         'empresaNome', e.razao_social) ORDER BY p.nome) FILTER (WHERE a.id IS NOT NULL), '[]') AS atribuicoes
           FROM usuario us
           LEFT JOIN usuario_atribuicao a ON a.usuario_id = us.id
           LEFT JOIN perfil p ON p.id = a.perfil_id
           LEFT JOIN empresa e ON e.id = a.empresa_id
          GROUP BY us.id ORDER BY us.nome`,
      ),
    );
  }

  perfis(u: Usuario) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `SELECT p.codigo, p.nome, coalesce(array_agg(pp.permissao ORDER BY pp.permissao) FILTER (WHERE pp.permissao IS NOT NULL), '{}') AS permissoes
           FROM perfil p LEFT JOIN perfil_permissao pp ON pp.perfil_id = p.id GROUP BY p.id ORDER BY p.nome`,
      ),
    );
  }

  private async gravarAtribuicoes(tx: Tx, usuarioId: string, atrib: DadosUsuario['atribuicoes']) {
    await tx.query('DELETE FROM usuario_atribuicao WHERE usuario_id = $1', [usuarioId]);
    for (const a of atrib) {
      const p = await tx.one('SELECT id FROM perfil WHERE codigo = $1', [a.perfil]);
      if (!p) throw new UnprocessableEntityException({ mensagem: `Perfil ${a.perfil} não existe` });
      if (a.empresaId && !(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [a.empresaId])))
        throw new UnprocessableEntityException({ mensagem: 'Empresa da atribuição não encontrada' });
      await tx.query(
        `INSERT INTO usuario_atribuicao (tenant_id, usuario_id, perfil_id, empresa_id) VALUES (app.tenant_atual(), $1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [usuarioId, p.id, a.empresaId],
      );
    }
  }

  async criar(u: Usuario, d: DadosUsuario & { senhaTemporaria: string }) {
    this.conferirEscopo(u, d.atribuicoes);
    const h = await this.auth.hashSenha(d.senhaTemporaria);
    return this.banco.tx(u.ctx('usuario_novo'), async (tx) => {
      const r = await tx.one(
        `INSERT INTO usuario (tenant_id, nome, email, senha_hash, ativo, deve_trocar_senha, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, true, app.usuario_atual()) RETURNING id`,
        [d.nome, d.email, h, d.ativo],
      );
      await this.gravarAtribuicoes(tx, r!.id, d.atribuicoes);
      return { id: r!.id };
    });
  }

  private async atribuicoesAtuais(tx: Tx, id: string) {
    return tx.query(
      `SELECT p.codigo AS perfil, a.empresa_id AS "empresaId" FROM usuario_atribuicao a JOIN perfil p ON p.id = a.perfil_id WHERE a.usuario_id = $1`,
      [id],
    );
  }

  async atualizar(u: Usuario, id: string, d: DadosUsuario) {
    if (id === u.id && !d.ativo) throw new UnprocessableEntityException({ mensagem: 'Você não pode desativar o próprio usuário' });
    return this.banco.tx(u.ctx('usuario_edicao'), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM usuario WHERE id = $1', [id]))) throw new NotFoundException({ mensagem: 'Usuário não encontrado' });
      // Precisa poder gerenciar tanto o acesso que existe quanto o que está sendo dado.
      this.conferirEscopo(u, [...(await this.atribuicoesAtuais(tx, id)), ...d.atribuicoes]);
      await tx.query('UPDATE usuario SET nome = $2, email = $3, ativo = $4 WHERE id = $1', [id, d.nome, d.email, d.ativo]);
      await this.gravarAtribuicoes(tx, id, d.atribuicoes);
      await this.garantirAdministrador(tx);
      if (!d.ativo) await tx.query('UPDATE sessao SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [id]);
    });
  }

  /** Impede que o sistema fique sem nenhum administrador geral ativo. */
  private async garantirAdministrador(tx: Tx) {
    const r = await tx.one(
      `SELECT count(*)::int AS n FROM usuario_atribuicao a JOIN perfil p ON p.id = a.perfil_id JOIN usuario us ON us.id = a.usuario_id
        WHERE p.codigo = 'ADMIN_GERAL' AND a.empresa_id IS NULL AND us.ativo`,
    );
    if (!r || r.n === 0) throw new UnprocessableEntityException({ mensagem: 'É preciso manter ao menos um administrador geral ativo' });
  }

  async redefinirSenha(u: Usuario, id: string, senhaTemporaria: string) {
    const h = await this.auth.hashSenha(senhaTemporaria);
    await this.banco.tx(u.ctx('senha_redefinida'), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM usuario WHERE id = $1', [id]))) throw new NotFoundException({ mensagem: 'Usuário não encontrado' });
      this.conferirEscopo(u, await this.atribuicoesAtuais(tx, id));
      await tx.query(
        `UPDATE usuario SET senha_hash = $2, deve_trocar_senha = true, tentativas_falhas = 0, bloqueado_ate = NULL,
                mfa_ativo = false, mfa_segredo = NULL WHERE id = $1`,
        [id, h],
      );
      await tx.query('UPDATE sessao SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [id]);
    });
  }
}
