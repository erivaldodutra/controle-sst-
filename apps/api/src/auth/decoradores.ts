import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permissao } from '@sst/shared';
import type { Usuario } from '../comum/contexto';

export const PUBLICA = 'rota_publica';
export const PERMISSAO = 'permissao_exigida';

/** Rota acessível sem sessão (login, estado, configuração inicial). */
export const Publica = () => SetMetadata(PUBLICA, true);
/** Exige que o usuário tenha a permissão em ao menos uma empresa. A checagem por empresa é feita no serviço. */
export const Requer = (p: Permissao) => SetMetadata(PERMISSAO, p);

export const Eu = createParamDecorator((_: unknown, ctx: ExecutionContext): Usuario => {
  return ctx.switchToHttp().getRequest().usuario;
});
