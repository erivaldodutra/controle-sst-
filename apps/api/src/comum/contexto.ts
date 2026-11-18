import { ForbiddenException } from '@nestjs/common';
import type { Permissao } from '@sst/shared';
import type { ContextoBanco } from '../db/banco';

export interface Atribuicao {
  perfil: string;
  empresaId: string | null;
  permissoes: Permissao[];
}

/** Quem está fazendo a requisição e o que pode fazer. Montado pelo AuthGuard. */
export class Usuario {
  constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly nome: string,
    readonly email: string,
    readonly sessaoId: string,
    readonly deveTrocarSenha: boolean,
    readonly atribuicoes: Atribuicao[],
  ) {}

  /** Empresas visíveis: '*' se alguma atribuição vale para todas. */
  get empresas(): '*' | string[] {
    if (this.atribuicoes.some((a) => a.empresaId === null)) return '*';
    return [...new Set(this.atribuicoes.map((a) => a.empresaId!))];
  }

  pode(p: Permissao, empresaId?: string | null): boolean {
    return this.atribuicoes.some(
      (a) => a.permissoes.includes(p) && (a.empresaId === null || empresaId === undefined || a.empresaId === empresaId),
    );
  }

  /** Permissão válida para todas as empresas (ex.: criar empresa nova). */
  podeGlobal(p: Permissao): boolean {
    return this.atribuicoes.some((a) => a.empresaId === null && a.permissoes.includes(p));
  }

  exigir(p: Permissao, empresaId?: string | null) {
    if (!this.pode(p, empresaId)) throw new ForbiddenException({ mensagem: 'Você não tem permissão para esta ação' });
  }

  ctx(contexto?: string): ContextoBanco {
    return { tenantId: this.tenantId, usuarioId: this.id, empresas: this.empresas, contexto };
  }

  get permissoes(): Permissao[] {
    return [...new Set(this.atribuicoes.flatMap((a) => a.permissoes))];
  }
}
