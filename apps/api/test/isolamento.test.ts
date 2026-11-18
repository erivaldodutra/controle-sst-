import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, cpfTeste, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let A: Awaited<ReturnType<typeof criarEmpresa>>;
let B: Awaited<ReturnType<typeof criarEmpresa>>;
let funcB: { funcionarioId: string; vinculoId: string };

const admissao = (estabelecimentoId: string, matricula: string) => ({
  pessoa: { nome: `Pessoa ${matricula}`, cpf: cpfTeste() },
  matricula,
  dataAdmissao: '2025-01-10',
  posicao: { estabelecimentoId },
});

beforeAll(async () => {
  amb = await prepararAmbiente('isolamento');
  adm = await configurarELogar(amb);
  A = await criarEmpresa(adm, 'Empresa A');
  B = await criarEmpresa(adm, 'Empresa B');
  await adm.post(`/api/empresas/${A.empresa.id}/funcionarios`, admissao(A.estabelecimento.id, 'A1')).expect(201);
  funcB = (await adm.post(`/api/empresas/${B.empresa.id}/funcionarios`, admissao(B.estabelecimento.id, 'B1')).expect(201)).body;
  await adm.post('/api/usuarios', {
    nome: 'RH da A', email: 'rh.a@teste.local', senhaTemporaria: 'Temporaria123',
    atribuicoes: [{ perfil: 'RH', empresaId: A.empresa.id }],
  }).expect(201);
});
afterAll(async () => amb?.fechar());

async function logarRhA() {
  const a = amb.agente();
  await a.post('/api/auth/login', { email: 'rh.a@teste.local', senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaRhA2026x' }).expect(200);
  return a;
}

describe('isolamento entre empresas', () => {
  let rh: Agente;
  beforeAll(async () => {
    rh = await logarRhA();
  });

  it('usuário da empresa A só enxerga a empresa A', async () => {
    const lista = (await rh.get('/api/empresas').expect(200)).body;
    expect(lista.map((e: any) => e.id)).toEqual([A.empresa.id]);
    await rh.get(`/api/empresas/${B.empresa.id}`).expect(404);
  });

  it('usuário da empresa A não vê nem altera funcionários da empresa B', async () => {
    const f = (await rh.get('/api/funcionarios').expect(200)).body;
    expect(f.itens.every((i: any) => i.empresaId === A.empresa.id)).toBe(true);
    expect(f.total).toBe(1);
    await rh.get(`/api/funcionarios/${funcB.funcionarioId}`).expect(404);
    await rh.post(`/api/vinculos/${funcB.vinculoId}/desligamento`, { data: '2025-05-01' }).expect(404);
    await rh.post(`/api/empresas/${B.empresa.id}/funcionarios`, admissao(B.estabelecimento.id, 'X9')).expect(403);
  });

  it('não consegue usar estabelecimento de outra empresa ao admitir', async () => {
    await rh.post(`/api/empresas/${A.empresa.id}/funcionarios`, admissao(B.estabelecimento.id, 'A2')).expect(422);
  });

  it('não cadastra empresas novas (exige acesso a todas)', async () => {
    await rh.post('/api/empresas', { tipoInscricao: 1, inscricao: '11222333000181', razaoSocial: 'Nova' }).expect(403);
  });

  it('busca global respeita o isolamento', async () => {
    const r = (await rh.get('/api/busca?q=Empresa').expect(200)).body;
    expect(r.empresas.map((e: any) => e.id)).toEqual([A.empresa.id]);
  });
});

describe('isolamento no banco (RLS), independente da API', () => {
  async function comApp<T>(empresas: string, fn: (c: Client) => Promise<T>) {
    const c = new Client({ connectionString: amb.urlApp });
    await c.connect();
    try {
      const dono = new Client({ connectionString: amb.urlDono });
      await dono.connect();
      const t = (await dono.query('SELECT id FROM tenant')).rows[0].id;
      await dono.end();
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.empresas', $2, true)`, [t, empresas]);
      return await fn(c);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  }

  it('sem contexto, o papel da aplicação não lê nada', async () => {
    const c = new Client({ connectionString: amb.urlApp });
    await c.connect();
    const r = await c.query('SELECT count(*)::int AS n FROM funcionario');
    const e = await c.query('SELECT count(*)::int AS n FROM empresa');
    await c.end();
    expect(r.rows[0].n).toBe(0);
    expect(e.rows[0].n).toBe(0);
  });

  it('com a empresa A no contexto, só lê dados de A e não grava em B', async () => {
    await comApp(A.empresa.id, async (c) => {
      const r = await c.query('SELECT DISTINCT empresa_id FROM funcionario');
      expect(r.rows.map((x) => x.empresa_id)).toEqual([A.empresa.id]);
      await expect(
        c.query(`INSERT INTO setor (tenant_id, empresa_id, estabelecimento_id, nome) VALUES (app.tenant_atual(), $1, $2, 'invasao')`, [
          B.empresa.id, B.estabelecimento.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('o papel da aplicação não altera nem apaga auditoria', async () => {
    await comApp('*', async (c) => {
      await expect(c.query('DELETE FROM auditoria')).rejects.toThrow(/permission denied/);
    });
    await comApp('*', async (c) => {
      await expect(c.query(`UPDATE auditoria SET operacao = 'X'`)).rejects.toThrow(/permission denied/);
    });
  });

  it('o papel da aplicação não apaga nem reescreve lotações (só fecha o período)', async () => {
    await comApp('*', async (c) => {
      await expect(c.query('DELETE FROM lotacao')).rejects.toThrow(/permission denied/);
    });
    await comApp('*', async (c) => {
      await expect(c.query(`UPDATE lotacao SET motivo = 'x'`)).rejects.toThrow(/permission denied/);
    });
  });
});
