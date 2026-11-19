import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML } from 'xmllint-wasm';

/** Pasta padrão com os esquemas oficiais (apps/api/esocial). O aplicativo de desktop informa a sua. */
export const PASTA_ESOCIAL = join(__dirname, '..', '..', 'esocial');

export interface ErroValidacao { linha: number | null; mensagem: string }

/**
 * Valida XML contra os esquemas oficiais do eSocial (XSD), que vão junto com o programa
 * e funcionam sem internet.
 */
export class Esquemas {
  private cache = new Map<string, string>();

  constructor(private readonly pasta = PASTA_ESOCIAL) {}

  private ler(rel: string) {
    let c = this.cache.get(rel);
    if (c === undefined) {
      c = readFileSync(join(this.pasta, rel), 'utf8');
      this.cache.set(rel, c);
    }
    return c;
  }

  /** Valida um evento (o XSD do evento inclui tipos.xsd e o esquema da assinatura). */
  validarEvento(xml: string, xsd: string) {
    return this.validar(xml, `eventos/${xsd}`, ['eventos/tipos.xsd', 'eventos/xmldsig-core-schema.xsd']);
  }

  validarLote(xml: string) {
    return this.validar(xml, 'comunicacao/EnvioLoteEventos-v1_1_1.xsd', []);
  }

  private async validar(xml: string, xsd: string, extras: string[]): Promise<ErroValidacao[]> {
    const nome = (p: string) => p.split('/').pop()!;
    const r = await validateXML({
      xml: [{ fileName: 'evento.xml', contents: xml }],
      schema: [{ fileName: nome(xsd), contents: this.ler(xsd) }],
      preload: extras.map((p) => ({ fileName: nome(p), contents: this.ler(p) })),
    });
    if (r.valid) return [];
    return r.errors.map((e) => ({ linha: e.loc?.lineNumber ?? null, mensagem: traduzir(e.message ?? e.rawMessage) }));
  }
}

/** Deixa a mensagem do xmllint mais legível (sem o namespace longo). */
function traduzir(m: string) {
  return m
    .replace(/\{http:\/\/www\.esocial\.gov\.br\/schema\/[^}]+\}/g, '')
    .replace(/^.*?Schemas validity error : /, '')
    .replace(/^Element '([^']+)':/, 'Campo $1:')
    .replace(/This element is not expected\. Expected is( one of)? \( ([^)]+) \)\./, 'campo fora de ordem ou não esperado; esperado: $2.')
    .replace(/Missing child element\(s\)\. Expected is( one of)? \( ([^)]+) \)\./, 'falta o campo $2.')
    .replace(/\[facet 'pattern'\] The value '([^']*)' is not accepted by the pattern '[^']*'\./, `o valor "$1" não está no formato exigido.`)
    .replace(/\[facet '(maxLength|minLength)'\] The value has a length of '(\d+)'; this (exceeds|underruns) the allowed (maximum|minimum) length of '(\d+)'\./,
      'o texto tem $2 caracteres; o limite é $5.')
    .replace(/\[facet 'enumeration'\] The value '([^']*)' is not an element of the set \{([^}]*)\}\./, 'o valor "$1" não é aceito; valores válidos: $2.')
    .trim();
}
