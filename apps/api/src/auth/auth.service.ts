import { ForbiddenException, Inject, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { PERFIS_PADRAO, type Permissao } from '@sst/shared';
import { authenticator } from 'otplib';
import { Banco } from '../db/banco';
import { BANCO, CONFIG, type Configuracao } from '../comum/config';
import { Atribuicao, Usuario } from '../comum/contexto';
import { cifrar, decifrar, sha256, tokenAleatorio } from '../comum/cripto';

const MAX_TENTATIVAS = 5;
const BLOQUEIO = '15 minutes';
// Parâmetros Argon2id (OWASP 2024: m=19 MiB, t=2, p=1)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

@Injectable()
export class AuthService {
  constructor(@Inject(BANCO) private readonly banco: Banco, @Inject(CONFIG) private readonly cfg: Configuracao) {}

  private hashFicticioP?: Promise<string>;
  /** Hash usado só para igualar o tempo de resposta quando o e-mail não existe. */
  private hashFicticio() {
    return (this.hashFicticioP ??= hash(tokenAleatorio(), ARGON));
  }

  hashSenha(senha: string) {
    return hash(senha, ARGON);
  }

  async configurado(): Promise<boolean> {
    return this.banco.semContexto(async (tx) => (await tx.one('SELECT app.sistema_configurado() AS ok'))!.ok);
  }

  async configurarSistema(d: { organizacao: string; nome: string; email: string; senha: string }) {
    if (await this.configurado()) throw new ConflictException({ mensagem: 'O sistema já foi configurado' });
    const perfis = Object.entries(PERFIS_PADRAO).map(([codigo, p]) => ({ codigo, nome: p.nome, permissoes: p.permissoes }));
    const senhaHash = await this.hashSenha(d.senha);
    await this.banco.semContexto((tx) =>
      tx.one('SELECT app.configurar_sistema($1, $2, $3, $4, $5::jsonb)', [
        d.organizacao, d.nome, d.email, senhaHash, JSON.stringify(perfis),
      ]),
    );
  }

  /** Devolve o token de sessão em caso de sucesso. */
  async login(email: string, senha: string, codigoMfa: string | undefined, meta: { ip?: string; agente?: string }) {
    const u = await this.banco.semContexto((tx) => tx.one('SELECT * FROM app.login_buscar($1)', [email]));
    const falha = () => new UnauthorizedException({ mensagem: 'E-mail ou senha incorretos' });
    if (!u) {
      // Gasta o mesmo tempo de uma verificação real para não revelar quais e-mails existem.
      await verify(await this.hashFicticio(), senha).catch(() => false);
      throw falha();
    }
    if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
      throw new ForbiddenException({ mensagem: 'Usuário bloqueado temporariamente por excesso de tentativas. Tente novamente em alguns minutos.' });
    }
    const ok = u.ativo && (await verify(u.senha_hash, senha).catch(() => false));
    if (!ok) {
      await this.banco.semContexto((tx) => tx.query('SELECT app.login_registrar_falha($1, $2, $3::interval)', [u.id, MAX_TENTATIVAS, BLOQUEIO]));
      throw falha();
    }
    if (u.mfa_ativo) {
      if (!codigoMfa) throw new UnauthorizedException({ mensagem: 'Informe o código do aplicativo autenticador', mfa: true });
      const segredo = decifrar(this.cfg.chaveDados, u.mfa_segredo);
      if (!authenticator.check(codigoMfa.replace(/\s/g, ''), segredo)) {
        await this.banco.semContexto((tx) => tx.query('SELECT app.login_registrar_falha($1, $2, $3::interval)', [u.id, MAX_TENTATIVAS, BLOQUEIO]));
        throw new UnauthorizedException({ mensagem: 'Código do autenticador incorreto', mfa: true });
      }
    }
    const token = tokenAleatorio();
    await this.banco.tx({ tenantId: u.tenant_id, usuarioId: u.id, empresas: [], contexto: 'login' }, async (tx) => {
      await tx.query('UPDATE usuario SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_acesso_em = now() WHERE id = $1', [u.id]);
      await tx.query(
        `INSERT INTO sessao (tenant_id, usuario_id, token_hash, expira_em, ip, agente)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
        [u.tenant_id, u.id, sha256(token), this.cfg.horasSessao, meta.ip ?? null, meta.agente?.slice(0, 300) ?? null],
      );
    });
    return token;
  }

  async usuarioDaSessao(token: string, registrarUso = true): Promise<Usuario | null> {
    const s = await this.banco.semContexto((tx) => tx.one('SELECT * FROM app.sessao_buscar($1)', [sha256(token)]));
    if (!s) return null;
    return this.banco.tx({ tenantId: s.tenant_id, usuarioId: s.usuario_id, empresas: [] }, async (tx) => {
      const u = await tx.one('SELECT id, nome, email, deve_trocar_senha FROM usuario WHERE id = $1', [s.usuario_id]);
      const rows = await tx.query(
        `SELECT p.codigo, a.empresa_id, coalesce(array_agg(pp.permissao) FILTER (WHERE pp.permissao IS NOT NULL), '{}') AS permissoes
           FROM usuario_atribuicao a
           JOIN perfil p ON p.id = a.perfil_id
           LEFT JOIN perfil_permissao pp ON pp.perfil_id = p.id
          WHERE a.usuario_id = $1
          GROUP BY p.codigo, a.empresa_id`,
        [s.usuario_id],
      );
      if (registrarUso) await tx.query('UPDATE sessao SET ultimo_uso_em = now() WHERE id = $1 AND ultimo_uso_em < now() - interval \'1 minute\'', [s.sessao_id]);
      const atrib: Atribuicao[] = rows.map((r) => ({ perfil: r.codigo, empresaId: r.empresa_id, permissoes: r.permissoes as Permissao[] }));
      return new Usuario(u.id, s.tenant_id, u.nome, u.email, s.sessao_id, u.deve_trocar_senha, atrib);
    });
  }

  async logout(u: Usuario) {
    await this.banco.tx(u.ctx('logout'), (tx) => tx.query('UPDATE sessao SET revogada_em = now() WHERE id = $1', [u.sessaoId]));
  }

  async trocarSenha(u: Usuario, atual: string, nova: string) {
    const row = await this.banco.semContexto((tx) => tx.one('SELECT senha_hash FROM app.login_buscar($1)', [u.email]));
    if (!row || !(await verify(row.senha_hash, atual).catch(() => false)))
      throw new UnauthorizedException({ mensagem: 'Senha atual incorreta' });
    const h = await this.hashSenha(nova);
    await this.banco.tx(u.ctx('troca_senha'), async (tx) => {
      await tx.query('UPDATE usuario SET senha_hash = $2, deve_trocar_senha = false WHERE id = $1', [u.id, h]);
      // Encerra as outras sessões do usuário.
      await tx.query('UPDATE sessao SET revogada_em = now() WHERE usuario_id = $1 AND id <> $2 AND revogada_em IS NULL', [u.id, u.sessaoId]);
    });
  }

  async iniciarMfa(u: Usuario) {
    const segredo = authenticator.generateSecret();
    await this.banco.tx(u.ctx('mfa_inicio'), (tx) =>
      tx.query('UPDATE usuario SET mfa_segredo = $2, mfa_ativo = false WHERE id = $1', [u.id, cifrar(this.cfg.chaveDados, segredo)]),
    );
    return { segredo, uri: authenticator.keyuri(u.email, 'Controle SST', segredo) };
  }

  async confirmarMfa(u: Usuario, codigo: string) {
    await this.banco.tx(u.ctx('mfa_confirmacao'), async (tx) => {
      const r = await tx.one('SELECT mfa_segredo FROM usuario WHERE id = $1', [u.id]);
      if (!r?.mfa_segredo) throw new ConflictException({ mensagem: 'Inicie a configuração do autenticador primeiro' });
      if (!authenticator.check(codigo.replace(/\s/g, ''), decifrar(this.cfg.chaveDados, r.mfa_segredo)))
        throw new UnauthorizedException({ mensagem: 'Código incorreto' });
      await tx.query('UPDATE usuario SET mfa_ativo = true WHERE id = $1', [u.id]);
    });
  }

  async desativarMfa(u: Usuario, senha: string) {
    const row = await this.banco.semContexto((tx) => tx.one('SELECT senha_hash FROM app.login_buscar($1)', [u.email]));
    if (!row || !(await verify(row.senha_hash, senha).catch(() => false)))
      throw new UnauthorizedException({ mensagem: 'Senha incorreta' });
    await this.banco.tx(u.ctx('mfa_desativacao'), (tx) =>
      tx.query('UPDATE usuario SET mfa_ativo = false, mfa_segredo = NULL WHERE id = $1', [u.id]),
    );
  }
}
