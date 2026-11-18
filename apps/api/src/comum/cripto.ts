import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<cifrado> em base64url. */
export function cifrar(chave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.');
}

export function decifrar(chave: Buffer, valor: string): string {
  const [v, iv, tag, dados] = valor.split('.');
  if (v !== 'v1' || !iv || !tag || !dados) throw new Error('Formato cifrado inválido');
  const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8');
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const tokenAleatorio = () => randomBytes(32).toString('base64url');
