import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

export interface InfoCertificado {
  titular: string;
  documento: string | null;
  emissor: string;
  numeroSerie: string;
  impressaoDigital: string;
  validoDe: Date;
  validoAte: Date;
}

export interface CertificadoAberto extends InfoCertificado {
  chavePem: string;
  certPem: string;
  /** Cadeia que veio no .pfx (intermediárias), para o TLS. */
  cadeiaPem: string[];
}

const nomeCampo = (c: forge.pki.Certificate['subject'], campo: string) =>
  (c.getField(campo)?.value as string | undefined) ?? null;

/** Lê o .pfx (A1). Senha errada ou arquivo inválido viram mensagem clara. */
export function abrirPfx(pfx: Buffer, senha: string): CertificadoAberto {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), senha);
  } catch (e: any) {
    const m = String(e?.message ?? '');
    if (/password|MAC|Invalid/i.test(m)) throw new Error('Senha do certificado incorreta ou arquivo .pfx inválido');
    throw new Error('Não foi possível ler o arquivo. Envie o certificado A1 no formato .pfx ou .p12');
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].filter((b) => b.key);
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert!).filter(Boolean);
  if (!chaves.length || !certs.length) throw new Error('O arquivo não contém certificado com chave privada (precisa ser A1)');
  const chave = chaves[0]!.key as forge.pki.rsa.PrivateKey;
  // O certificado do titular é o que corresponde à chave privada.
  const titular = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));
  if (!titular) throw new Error('A chave privada não corresponde a nenhum certificado do arquivo');
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(titular)).getBytes(), 'binary');
  const cn = nomeCampo(titular.subject, 'CN') ?? '';
  // Padrão ICP-Brasil: "RAZAO SOCIAL:CNPJ" ou "NOME:CPF" no CN.
  const doc = /:(\d{14}|\d{11})$/.exec(cn)?.[1] ?? null;
  return {
    titular: cn.replace(/:(\d{14}|\d{11})$/, '') || cn,
    documento: doc,
    emissor: nomeCampo(titular.issuer, 'CN') ?? nomeCampo(titular.issuer, 'O') ?? 'Desconhecido',
    numeroSerie: titular.serialNumber,
    impressaoDigital: createHash('sha256').update(der).digest('hex'),
    validoDe: titular.validity.notBefore,
    validoAte: titular.validity.notAfter,
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(titular),
    cadeiaPem: certs.filter((c) => c !== titular).map((c) => forge.pki.certificateToPem(c)),
  };
}

/**
 * Assinatura XML-DSig exigida pelo eSocial: envelopada, referência URI="" (documento todo),
 * C14N, RSA-SHA256 e digest SHA-256, com o certificado em KeyInfo.
 */
export function assinar(xml: string, cert: Pick<CertificadoAberto, 'chavePem' | 'certPem'>): string {
  const c14n = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  const sig = new SignedXml({
    privateKey: cert.chavePem,
    publicCert: cert.certPem,
    canonicalizationAlgorithm: c14n,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });
  sig.addReference({
    xpath: '/*', uri: '', isEmptyUri: true, digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', c14n],
  });
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  return sig.getSignedXml();
}
