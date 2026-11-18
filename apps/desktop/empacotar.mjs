// Prepara o pacote do aplicativo numa pasta isolada (pacote/):
// 1. junta o processo principal e a API num único arquivo (esbuild);
// 2. instala com npm só os módulos nativos/ESM que ficam fora desse arquivo.
// O instalador é gerado a partir dessa pasta, sem passar pelo monorepo do pnpm.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const aqui = resolve(import.meta.dirname);
const pkg = JSON.parse(readFileSync(resolve(aqui, 'package.json'), 'utf8'));
const pacote = resolve(aqui, 'pacote');

await build({
  entryPoints: [resolve(aqui, 'dist/main.js')],
  outfile: resolve(aqui, 'dist-bundle/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'info',
  // Nativos e ESM ficam fora do arquivo; dependências opcionais do Nest que não usamos também.
  external: [
    'electron',
    ...Object.keys(pkg.dependencies),
    '@embedded-postgres/*',
    'pg-native',
    '@nestjs/microservices', '@nestjs/microservices/*',
    '@nestjs/websockets', '@nestjs/websockets/*',
    'class-validator', 'class-transformer', '@fastify/static',
  ],
});

if (process.argv.includes('--so-bundle')) process.exit(0);

rmSync(pacote, { recursive: true, force: true });
mkdirSync(pacote);
cpSync(resolve(aqui, 'dist-bundle'), resolve(pacote, 'dist-bundle'), { recursive: true });
const b = pkg.build;
writeFileSync(resolve(pacote, 'package.json'), JSON.stringify({
  name: 'controle-sst',
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  main: pkg.main,
  dependencies: pkg.dependencies,
  build: {
    ...b,
    electronVersion: pkg.devDependencies.electron,
    directories: { output: resolve(aqui, 'release'), buildResources: resolve(aqui, 'recursos') },
    extraResources: b.extraResources.map((r) => ({ ...r, from: resolve(aqui, r.from) })),
  },
}, null, 2));
execSync('npm install --omit=dev --no-audit --no-fund', { cwd: pacote, stdio: 'inherit' });
