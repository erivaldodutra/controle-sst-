import { request } from 'node:https';
import * as tls from 'node:tls';
import { ACAO_CONSULTA, ACAO_ENVIO, envelope, falhaSoap } from './xml';

export interface CredencialTls {
  pfx: Buffer;
  senha: string;
  /** Certificados de autoridades a confiar além das públicas (ex.: cadeia ICP-Brasil). */
  ca?: string[];
}

export class FalhaComunicacao extends Error {}

/**
 * Autoridades confiáveis: as públicas do Node mais a cadeia informada pelo usuário na
 * configuração. Sem cadeia informada, usa também as do sistema operacional (no Windows
 * inclui a raiz da ICP-Brasil quando instalada).
 */
function autoridades(extra: string[] = []): string[] {
  if (extra.length) return [...tls.rootCertificates, ...extra];
  const doSistema = (() => {
    try {
      return (tls as any).getCACertificates?.('system') ?? [];
    } catch {
      return [];
    }
  })();
  return [...new Set<string>([...tls.rootCertificates, ...doSistema, ...extra])];
}

/**
 * Chamada SOAP ao webservice do eSocial com o certificado A1 (TLS mútuo).
 * Nenhum resultado é inventado: sem resposta do servidor, é falha de comunicação.
 */
export function chamarWebservice(url: string, operacao: 'envio' | 'consulta', corpo: string, cred: CredencialTls, tempoLimite = 120_000): Promise<string> {
  const dados = Buffer.from(envelope(operacao, corpo), 'utf8');
  return new Promise((ok, falha) => {
    const req = request(url, {
      method: 'POST',
      pfx: cred.pfx,
      passphrase: cred.senha,
      ca: autoridades(cred.ca),
      minVersion: 'TLSv1.2',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${operacao === 'envio' ? ACAO_ENVIO : ACAO_CONSULTA}"`,
        'Content-Length': dados.length,
      },
      timeout: tempoLimite,
    }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (p: Buffer) => partes.push(p));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) return ok(texto);
        const f = falhaSoap(texto);
        falha(new FalhaComunicacao(`O eSocial respondeu HTTP ${status}${f ? `: ${f}` : ''}`));
      });
      res.on('error', (e) => falha(new FalhaComunicacao(`Conexão interrompida: ${e.message}`)));
    });
    req.on('timeout', () => req.destroy(new Error('tempo de resposta esgotado')));
    req.on('error', (e: any) => {
      const codigo = e?.code ? ` (${e.code})` : '';
      let dica = '';
      if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(e?.code ?? '')) dica = ' Verifique a cadeia de certificados da ICP-Brasil na configuração do eSocial.';
      else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/.test(e?.code ?? '')) dica = ' Verifique a conexão com a internet.';
      falha(new FalhaComunicacao(`Não foi possível falar com o eSocial: ${e?.message ?? e}${codigo}.${dica}`));
    });
    req.end(dados);
  });
}
