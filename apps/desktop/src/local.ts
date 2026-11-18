/**
 * Onde ficam os dados do sistema no computador.
 *
 * Os dados ficam na mesma unidade do programa: instalado fora da unidade do Windows
 * (ex.: em E:), os dados vão para "E:\Controle SST - Dados". Instalado no C:, continuam
 * na pasta do usuário do Windows, como nas versões anteriores.
 *
 * A pasta de dados fica fora da pasta do programa de propósito: o desinstalador e as
 * atualizações apagam a pasta do programa inteira.
 */
import { chmodSync, cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { ARQ_PRONTO } from './servidor';

export const NOME_PASTA_DADOS = 'Controle SST - Dados';

export function escolherPastaDados(o: { programa: string; padrao: string; unidadeSistema?: string; windows: boolean }): string {
  if (!o.windows) return o.padrao;
  const raiz = win32.parse(o.programa).root;
  const sistema = `${(o.unidadeSistema || 'C:').replace(/[\\/]+$/, '')}\\`;
  if (!/^[a-z]:\\$/i.test(raiz) || raiz.toUpperCase() === sistema.toUpperCase()) return o.padrao;
  return win32.join(raiz, NOME_PASTA_DADOS);
}

const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * Se a pasta de dados atual ainda não tem banco e um local anterior tem, copia os dados de lá.
 * O local anterior não é apagado: é renomeado com o sufixo "-copiado-<data>".
 * Devolve o local de onde os dados vieram, ou null se não precisou copiar.
 */
export function trazerDadosAnteriores(destino: string, anteriores: (string | null | undefined)[], log?: (m: string) => void): string | null {
  if (existsSync(join(destino, ARQ_PRONTO))) return null;
  const origem = anteriores.find((c): c is string => !!c && c !== destino && existsSync(join(c, ARQ_PRONTO)));
  if (!origem) return null;
  const sufixo = carimbo();
  log?.(`Copiando os dados de ${origem} para ${destino}`);
  // Restos de uma primeira execução incompleta no destino ficam guardados ao lado.
  if (existsSync(destino) && readdirSync(destino).length) renameSync(destino, `${destino}-anterior-${sufixo}`);
  const temp = `${destino}-copiando`;
  rmSync(temp, { recursive: true, force: true });
  cpSync(origem, temp, { recursive: true });
  if (existsSync(join(temp, 'pg'))) chmodSync(join(temp, 'pg'), 0o700);
  if (existsSync(destino)) rmSync(destino, { recursive: true, force: true }); // só pode ser uma pasta vazia aqui
  renameSync(temp, destino);
  try {
    renameSync(origem, `${origem}-copiado-${sufixo}`);
  } catch (e: any) {
    log?.(`Dados copiados, mas a pasta antiga não pôde ser renomeada: ${e?.message}`);
  }
  log?.('Dados copiados');
  return origem;
}
