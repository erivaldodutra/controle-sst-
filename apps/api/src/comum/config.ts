export interface Configuracao {
  urlApp: string;
  /** Chave de 32 bytes (base64) para criptografar segredos e dados sensíveis. */
  chaveDados: Buffer;
  /** Duração da sessão em horas. */
  horasSessao: number;
  /** Cookie com flag Secure (desligado no app local, que roda em http://127.0.0.1). */
  cookieSeguro: boolean;
  /** Pasta com os esquemas oficiais do eSocial (XSD). Padrão: apps/api/esocial. */
  pastaEsocial?: string;
  /** Somente testes automatizados: endereços de um servidor local no lugar dos webservices do governo. */
  enderecosEsocialTeste?: Record<1 | 2, { envio: string; consulta: string }>;
  /** Somente testes automatizados: servidor local no lugar da API da Anthropic. */
  iaBaseUrlTeste?: string;
}

export const CONFIG = Symbol('CONFIG');
export const BANCO = Symbol('BANCO');

export function configDoAmbiente(): Configuracao {
  const urlApp = process.env.DATABASE_URL_APP;
  const chave = process.env.SST_CHAVE_DADOS;
  if (!urlApp) throw new Error('DATABASE_URL_APP não definida');
  if (!chave) throw new Error('SST_CHAVE_DADOS não definida (32 bytes em base64)');
  const chaveDados = Buffer.from(chave, 'base64');
  if (chaveDados.length !== 32) throw new Error('SST_CHAVE_DADOS deve ter 32 bytes');
  return {
    urlApp,
    chaveDados,
    horasSessao: Number(process.env.SST_HORAS_SESSAO ?? 12),
    cookieSeguro: process.env.SST_COOKIE_SEGURO === '1',
    pastaEsocial: process.env.SST_PASTA_ESOCIAL || undefined,
  };
}
