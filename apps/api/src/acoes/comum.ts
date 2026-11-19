import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Tx } from '../db/banco';
import { conteudoConfere } from '../saude/aso.service';

export const erro = (mensagem: string) => new UnprocessableEntityException({ mensagem });
export const naoEncontrado = (o: string) => new NotFoundException({ mensagem: `${o} não encontrado` });

/** Próximo código sequencial do tenant, ex.: AC-2026-0001 (a numeração recomeça a cada ano). */
export async function proximoCodigo(tx: Tx, prefixo: string) {
  const ano = (await tx.one(`SELECT extract(year FROM current_date)::int AS a`))!.a as number;
  const r = await tx.one(
    `INSERT INTO contador (tenant_id, nome, valor) VALUES (app.tenant_atual(), $1, 1)
     ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = contador.valor + 1 RETURNING valor`,
    [`${prefixo}-${ano}`],
  );
  return `${prefixo}-${ano}-${String(r!.valor).padStart(4, '0')}`;
}

/** Data de hoje do banco e janela de alerta (maior prazo de alerta configurado). */
export async function referencia(tx: Tx) {
  const r = await tx.one(
    `SELECT current_date::text AS hoje, (SELECT max(d) FROM tenant_config c, unnest(c.alertas_dias) d) AS janela`,
  );
  return { hoje: r!.hoje as string, janela: Number(r!.janela ?? 90) };
}

const TIPOS_ARQUIVO: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export type ArquivoEnviado = { originalname: string; mimetype: string; buffer: Buffer };

export function conferirArquivo(arq?: ArquivoEnviado) {
  if (!arq?.buffer?.length) throw new BadRequestException({ mensagem: 'Envie o arquivo' });
  if (!TIPOS_ARQUIVO[arq.mimetype] || !conteudoConfere(arq.buffer, arq.mimetype))
    throw new BadRequestException({ mensagem: 'O arquivo deve ser PDF, JPG ou PNG' });
  return arq;
}

export async function gravarArquivo(tx: Tx, empresaId: string, arq: ArquivoEnviado, padrao: string) {
  const nome = arq.originalname.replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 150) || `${padrao}.${TIPOS_ARQUIVO[arq.mimetype]}`;
  const r = await tx.one(
    `INSERT INTO arquivo (tenant_id, empresa_id, nome, tipo_mime, tamanho, sha256, conteudo, criado_por)
     VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, app.usuario_atual()) RETURNING id`,
    [empresaId, nome, arq.mimetype, arq.buffer.length, createHash('sha256').update(arq.buffer).digest('hex'), arq.buffer],
  );
  return r!.id as string;
}
