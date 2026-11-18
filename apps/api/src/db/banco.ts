import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// DATE volta como texto AAAA-MM-DD, sem conversão de fuso.
types.setTypeParser(1082, (v) => v);

export interface ContextoBanco {
  tenantId: string;
  usuarioId: string | null;
  /** '*' = todas as empresas do tenant; senão a lista de IDs permitidos. */
  empresas: '*' | string[];
  /** Texto livre gravado na auditoria (ex.: "importacao:<id>"). */
  contexto?: string;
}

/** Cliente de uma transação já com o contexto de segurança aplicado. */
export class Tx {
  constructor(private readonly client: PoolClient) {}

  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.client.query<T>(sql, params);
    return r.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}

export class Banco {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
    // Conexões ociosas derrubadas (ex.: banco parado para backup) não podem derrubar o processo.
    this.pool.on('error', () => {});
  }

  /** Executa sem contexto de tenant (apenas funções de autenticação). */
  async semContexto<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(new Tx(client));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Abre uma transação com tenant, usuário e empresas permitidas (lidos pelas políticas RLS). */
  async tx<T>(ctx: ContextoBanco, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.usuario_id', $2, true),
                set_config('app.empresas', $3, true), set_config('app.contexto', $4, true)`,
        [ctx.tenantId, ctx.usuarioId ?? '', ctx.empresas === '*' ? '*' : ctx.empresas.join(','), ctx.contexto ?? ''],
      );
      const r = await fn(new Tx(client));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async fechar() {
    await this.pool.end();
  }
}
