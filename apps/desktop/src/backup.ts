/**
 * Backup completo e criptografado: banco (pasta do PostgreSQL, com o banco parado
 * para garantir consistência) + segredos necessários para restaurar em outro computador.
 *
 * Formato .sstbak:
 *   "SSTBAK1\n" | sal(16) | iv1(12) | tamanho(4) | segredos cifrados | tag1(16) | iv2(12) | tar.gz cifrado | tag2(16)
 * Chave: scrypt(senha do backup, sal). Cifra: AES-256-GCM.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import * as tar from 'tar';
import type { Segredos } from './servidor';

/** Erro com mensagem para o usuário (a API devolve 409 com o texto). */
const falha = (m: string) => Object.assign(new Error(m), { code: 'P0001' });

const MAGICO = Buffer.from('SSTBAK1\n');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const chave = (senha: string, sal: Buffer) => scryptSync(senha, sal, 32, SCRYPT);

export async function criarBackup(destino: string, pastaPg: string, segredos: Segredos, senha: string) {
  const sal = randomBytes(16);
  const k = chave(senha, sal);
  const iv1 = randomBytes(12);
  const c1 = createCipheriv('aes-256-gcm', k, iv1);
  const { senhaBackup: _, ...semSenhaBackup } = segredos;
  const seg = Buffer.concat([c1.update(JSON.stringify(semSenhaBackup), 'utf8'), c1.final()]);
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(seg.length);
  const iv2 = randomBytes(12);
  const c2 = createCipheriv('aes-256-gcm', k, iv2);

  const tmp = `${destino}.parcial`;
  const saida = createWriteStream(tmp, { mode: 0o600 });
  saida.write(Buffer.concat([MAGICO, sal, iv1, tam, seg, c1.getAuthTag(), iv2]));
  const empacotador = tar.c({ gzip: true, cwd: pastaPg, portable: true }, ['.']) as unknown as NodeJS.ReadableStream;
  await pipeline(empacotador, c2, saida, { end: false });
  await new Promise<void>((ok, erro) => saida.end(c2.getAuthTag(), () => ok()).on('error', erro));
  renameSync(tmp, destino);
}

function lerCabecalho(arquivo: string, senha: string) {
  const fd = openSync(arquivo, 'r');
  try {
    const ler = (pos: number, n: number) => {
      const b = Buffer.alloc(n);
      readSync(fd, b, 0, n, pos);
      return b;
    };
    if (!ler(0, MAGICO.length).equals(MAGICO)) throw falha('O arquivo não é um backup do Controle SST');
    let pos = MAGICO.length;
    const sal = ler(pos, 16); pos += 16;
    const iv1 = ler(pos, 12); pos += 12;
    const tam = ler(pos, 4).readUInt32BE(); pos += 4;
    const seg = ler(pos, tam); pos += tam;
    const tag1 = ler(pos, 16); pos += 16;
    const iv2 = ler(pos, 12); pos += 12;
    const total = statSync(arquivo).size;
    const tag2 = ler(total - 16, 16);
    const k = chave(senha, sal);
    const d1 = createDecipheriv('aes-256-gcm', k, iv1);
    d1.setAuthTag(tag1);
    let segredos: Segredos;
    try {
      segredos = JSON.parse(Buffer.concat([d1.update(seg), d1.final()]).toString('utf8'));
    } catch {
      throw falha('Senha do backup incorreta ou arquivo danificado');
    }
    return { k, iv2, tag2, inicioDados: pos, fimDados: total - 16, segredos };
  } finally {
    closeSync(fd);
  }
}

/**
 * Descriptografa e confere o backup inteiro numa pasta temporária.
 * Só depois de tudo verificado o chamador troca a pasta do banco.
 */
export async function abrirBackup(arquivo: string, senha: string, pastaTemp: string) {
  const h = lerCabecalho(arquivo, senha);
  rmSync(pastaTemp, { recursive: true, force: true });
  mkdirSync(pastaTemp, { recursive: true });
  const d2 = createDecipheriv('aes-256-gcm', h.k, h.iv2);
  d2.setAuthTag(h.tag2);
  const entrada = createReadStream(arquivo, { start: h.inicioDados, end: h.fimDados - 1 });
  try {
    await pipeline(entrada, d2 as unknown as Transform, tar.x({ cwd: pastaTemp }) as unknown as NodeJS.WritableStream);
  } catch {
    rmSync(pastaTemp, { recursive: true, force: true });
    throw falha('O backup está danificado ou foi alterado. Nada foi restaurado.');
  }
  if (!existsSync(join(pastaTemp, 'PG_VERSION'))) {
    rmSync(pastaTemp, { recursive: true, force: true });
    throw falha('O backup não contém um banco de dados válido');
  }
  return h.segredos;
}

/** Mantém apenas os N backups automáticos mais recentes. */
export function podarBackups(pasta: string, manter: number, listar: () => { caminho: string; criadoEm: string }[]) {
  const l = listar().sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  for (const x of l.slice(manter)) rmSync(x.caminho, { force: true });
  void pasta;
}
