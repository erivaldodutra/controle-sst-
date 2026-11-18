import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permissao } from '@sst/shared';
import { AuthService } from './auth.service';
import { PERMISSAO, PUBLICA } from './decoradores';

export const COOKIE_SESSAO = 'sst_sessao';

/** Rotas liberadas mesmo quando o usuário precisa trocar a senha. */
const LIBERADAS_TROCA_SENHA = ['/api/auth/eu', '/api/auth/senha', '/api/auth/logout'];

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const alvo = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICA, alvo)) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = req.cookies?.[COOKIE_SESSAO];
    const usuario = token ? await this.auth.usuarioDaSessao(token) : null;
    if (!usuario) throw new UnauthorizedException({ mensagem: 'Sessão expirada. Entre novamente.' });
    if (usuario.deveTrocarSenha && !LIBERADAS_TROCA_SENHA.includes(req.path))
      throw new ForbiddenException({ mensagem: 'Troque sua senha temporária para continuar', trocarSenha: true });
    const p = this.reflector.getAllAndOverride<Permissao>(PERMISSAO, alvo);
    if (p && !usuario.pode(p)) throw new ForbiddenException({ mensagem: 'Você não tem permissão para esta ação' });
    req.usuario = usuario;
    return true;
  }
}
