export class ErroApi extends Error {
  constructor(public status: number, public corpo: any) {
    super(corpo?.mensagem ?? `Erro ${status}`);
  }
  get campos(): Record<string, string> {
    return Object.fromEntries((this.corpo?.campos ?? []).map((c: any) => [c.campo, c.mensagem]));
  }
}

let aoExpirar: (() => void) | null = null;
export const definirAoExpirar = (fn: () => void) => (aoExpirar = fn);

async function req<T>(metodo: string, url: string, corpo?: unknown, fundo = false): Promise<T> {
  const ehForm = corpo instanceof FormData;
  const r = await fetch(`/api${url}`, {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'x-sst': '1', ...(fundo ? { 'x-sst-fundo': '1' } : {}), ...(corpo && !ehForm ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo === undefined ? undefined : ehForm ? corpo : JSON.stringify(corpo),
  });
  const tipo = r.headers.get('content-type') ?? '';
  const dados = tipo.includes('json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && !url.startsWith('/auth/')) aoExpirar?.();
    throw new ErroApi(r.status, dados);
  }
  return dados as T;
}

export const api = {
  get: <T = any>(u: string) => req<T>('GET', u),
  /** Consulta automática: não conta como uso, então não impede o encerramento da sessão por inatividade. */
  fundo: <T = any>(u: string) => req<T>('GET', u, undefined, true),
  post: <T = any>(u: string, b?: unknown) => req<T>('POST', u, b ?? {}),
  put: <T = any>(u: string, b: unknown) => req<T>('PUT', u, b),
  patch: <T = any>(u: string, b: unknown) => req<T>('PATCH', u, b),
  delete: <T = any>(u: string) => req<T>('DELETE', u),
};

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
