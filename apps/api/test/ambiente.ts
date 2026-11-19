/**
 * Ambiente de teste: cria um banco descartável, aplica as migrations e sobe a API.
 * Os CPFs/CNPJs gerados aqui só existem nesse banco temporário, que é apagado
 * e recriado a cada arquivo de teste. Nada disso chega a um banco real.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { criarApp } from '../src/app';
import type { Configuracao } from '../src/comum/config';
import { migrar } from '../src/db/migrar';

const HOST = process.env.PGHOST_TESTE ?? 'localhost';
const SUPER = process.env.PG_URL_ADMIN_TESTE ?? `postgres://sst_owner:dev_owner@${HOST}:5432/postgres`;
const OWNER = (db: string) => `postgres://sst_owner:dev_owner@${HOST}:5432/${db}`;
const APP = (db: string) => `postgres://sst_app:dev_app@${HOST}:5432/${db}`;

export async function prepararAmbiente(nome: string, extra: Partial<Configuracao> = {}) {
  const db = `sst_it_${nome}`;
  const adm = new Client({ connectionString: SUPER });
  await adm.connect();
  await adm.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await adm.query(`CREATE DATABASE ${db}`);
  await adm.end();
  await migrar(OWNER(db));
  const { app, banco } = await criarApp({
    config: { urlApp: APP(db), chaveDados: randomBytes(32), horasSessao: 12, cookieSeguro: false, ...extra },
    log: false,
  });
  await app.init();
  const server = app.getHttpServer();
  return {
    app,
    banco,
    db,
    urlDono: OWNER(db),
    urlApp: APP(db),
    /** Agente com cookie de sessão próprio. */
    agente: () => {
      const a = request.agent(server);
      const h = (r: request.Test) => r.set('x-sst', '1');
      return {
        get: (u: string) => a.get(u),
        post: (u: string, b?: object) => h(a.post(u)).send(b ?? {}),
        put: (u: string, b?: object) => h(a.put(u)).send(b ?? {}),
        patch: (u: string, b?: object) => h(a.patch(u)).send(b ?? {}),
        delete: (u: string) => h(a.delete(u)),
        upload: (u: string, campo: string, buf: Buffer, nome: string) => h(a.post(u)).attach(campo, buf, nome),
        raw: a,
      };
    },
    async fechar() {
      await app.close();
      await banco.fechar();
    },
  };
}

export type Ambiente = Awaited<ReturnType<typeof prepararAmbiente>>;
export type Agente = ReturnType<Ambiente['agente']>;

// ---- Geradores de documentos válidos (somente para o banco de teste) ----
let seq = 100000000;
export function cpfTeste(): string {
  const base = String(seq++).padStart(9, '0');
  const dv = (b: string, p: number) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (p - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base, 10);
  return base + d1 + dv(base + d1, 11);
}

let seqCnpj = 10000000;
export function cnpjTeste(filial = 1): string {
  const base = String(seqCnpj++).padStart(8, '0') + String(filial).padStart(4, '0');
  const calc = (b: string) => {
    const pesos = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = b.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i]!, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base);
  return base + d1 + calc(base + d1);
}

export const SENHA_ADMIN = 'SenhaForte2026';

/** Configura o sistema e devolve um agente logado como administrador geral. */
export async function configurarELogar(amb: Ambiente) {
  const a = amb.agente();
  await a.post('/api/auth/configuracao-inicial', {
    organizacao: 'Organização de teste', nome: 'Admin Teste', email: 'admin@teste.local', senha: SENHA_ADMIN,
  }).expect(201);
  await a.post('/api/auth/login', { email: 'admin@teste.local', senha: SENHA_ADMIN }).expect(200);
  return a;
}

export async function criarEmpresa(a: Agente, nome = 'Empresa Teste') {
  const cnpj = cnpjTeste();
  const e = (await a.post('/api/empresas', { tipoInscricao: 1, inscricao: cnpj, razaoSocial: nome, grauRisco: 3 }).expect(201)).body;
  const est = (await a.post(`/api/empresas/${e.id}/estabelecimentos`, {
    tipoInscricao: 1, inscricao: cnpj, nome: `${nome} - Matriz`, matriz: true,
  }).expect(201)).body;
  return { empresa: e, estabelecimento: est };
}
