import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const PASTA_MIGRATIONS = join(__dirname, '..', '..', 'migrations');

/**
 * Aplica, em ordem, os arquivos .sql ainda não aplicados. Cada arquivo roda
 * numa transação; se falhar, nada dele fica no banco.
 */
export async function migrar(urlDono: string, pasta = PASTA_MIGRATIONS, log: (m: string) => void = () => {}) {
  const client = new Client({ connectionString: urlDono });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migracao (
      nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    await client.query('SELECT pg_advisory_lock(777001)');
    const feitas = new Set((await client.query('SELECT nome FROM schema_migracao')).rows.map((r) => r.nome));
    const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort();
    for (const arq of arquivos) {
      if (feitas.has(arq)) continue;
      log(`Aplicando ${arq}`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(pasta, arq), 'utf8'));
        await client.query('INSERT INTO schema_migracao (nome) VALUES ($1)', [arq]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migration ${arq}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(777001)').catch(() => {});
    await client.end();
  }
}
