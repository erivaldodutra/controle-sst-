import { BadRequestException } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';

/** Valida o corpo com um schema zod e devolve erros por campo em português. */
export function validar<S extends ZodTypeAny>(schema: S, dados: unknown): z.infer<S> {
  const r = schema.safeParse(dados);
  if (!r.success) {
    throw new BadRequestException({
      mensagem: 'Dados inválidos',
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    });
  }
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidValido(v: string, rotulo = 'id'): string {
  if (!UUID.test(v)) throw new BadRequestException({ mensagem: `${rotulo} inválido` });
  return v;
}
