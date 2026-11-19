/**
 * Fase 2: ASO, dado clínico protegido, treinamentos, matriz e vencimentos.
 * Banco descartável; nomes e documentos gerados só para o teste.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PERFIS_PADRAO } from '@sst/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, cpfTeste, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let A: Awaited<ReturnType<typeof criarEmpresa>>;
let B: Awaited<ReturnType<typeof criarEmpresa>>;
let funcaoA: string;
let f1: { funcionarioId: string; vinculoId: string };
let f2: { funcionarioId: string; vinculoId: string };
let fB: { funcionarioId: string; vinculoId: string };
let medico: string;
let exameTipo: string;

const hoje = new Date();
const dia = (delta: number) => {
  const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta));
  return d.toISOString().slice(0, 10);
};

async function admitir(empresaId: string, estabelecimentoId: string, matricula: string, funcaoId?: string) {
  return (await adm.post(`/api/empresas/${empresaId}/funcionarios`, {
    pessoa: { nome: `Pessoa ${matricula}`, cpf: cpfTeste() }, matricula, dataAdmissao: dia(-400),
    posicao: { estabelecimentoId, funcaoId },
  }).expect(201)).body;
}

async function novoUsuario(email: string, perfil: string, empresaId: string | null) {
  await adm.post('/api/usuarios', {
    nome: email, email, senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil, empresaId }],
  }).expect(201);
  const a = amb.agente();
  await a.post('/api/auth/login', { email, senha: 'Temporaria123' }).expect(200);
  await a.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  return a;
}

beforeAll(async () => {
  amb = await prepararAmbiente('saude');
  adm = await configurarELogar(amb);
  A = await criarEmpresa(adm, 'Empresa A');
  B = await criarEmpresa(adm, 'Empresa B');
  funcaoA = (await adm.post(`/api/empresas/${A.empresa.id}/estrutura/funcoes`, { nome: 'Eletricista', cbo: '715615' }).expect(201)).body.id;
  f1 = await admitir(A.empresa.id, A.estabelecimento.id, 'A1', funcaoA);
  f2 = await admitir(A.empresa.id, A.estabelecimento.id, 'A2', funcaoA);
  fB = await admitir(B.empresa.id, B.estabelecimento.id, 'B1');
  medico = (await adm.post('/api/saude/medicos', { nome: 'Médica Examinadora', crm: '123456', ufCrm: 'SP' }).expect(201)).body.id;
  exameTipo = (await adm.post('/api/saude/tipos-exame', { nome: 'Audiometria', codigoEsocial: '0281' }).expect(201)).body.id;
}, 60_000);
afterAll(async () => amb?.fechar());

describe('permissões dos perfis', () => {
  it('as migrations 0002 a 0007 dão às instalações existentes as mesmas permissões novas dos perfis padrão', () => {
    const fase1 = new Set(['usuarios.gerenciar', 'auditoria.ler', 'empresas.ler', 'empresas.editar', 'estrutura.ler',
      'estrutura.editar', 'funcionarios.ler', 'funcionarios.editar', 'funcionarios.importar', 'backup.gerenciar']);
    const esperado = Object.entries(PERFIS_PADRAO)
      .flatMap(([codigo, p]) => p.permissoes.filter((x) => !fase1.has(x)).map((x) => `${codigo}:${x}`)).sort();
    const naMigration = ['0002_saude_treinamentos.sql', '0003_programas_documentos.sql', '0004_acoes_conformidade.sql', '0005_esocial.sql', '0007_painel_alertas_ia.sql'].flatMap((arq) => {
      const sql = readFileSync(join(__dirname, '..', 'migrations', arq), 'utf8');
      const bloco = sql.slice(sql.indexOf('JOIN (VALUES'), sql.indexOf(') AS n (codigo, permissao)'));
      return [...bloco.matchAll(/\('([A-Z_]+)', '([a-z.]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
    }).sort();
    expect(naMigration).toEqual(esperado);
  });

  it('administrador geral não recebe permissão clínica', () => {
    expect(PERFIS_PADRAO.ADMIN_GERAL.permissoes).not.toContain('saude.clinico');
    expect(PERFIS_PADRAO.MEDICO.permissoes).toContain('saude.clinico');
  });
});

describe('ASO', () => {
  let asoId: string;

  it('registra ASO com exames e calcula a situação', async () => {
    const r = await adm.post('/api/asos', {
      vinculoId: f1.vinculoId, tipo: 1, dataExame: dia(-10), resultado: 1, medicoId: medico,
      vencimento: dia(20), riscos: 'Ruído contínuo', exames: [{ exameTipoId: exameTipo, dataRealizacao: dia(-11), ordem: 2 }],
    }).expect(201);
    asoId = r.body.id;
    expect(r.body.situacao).toBe('vencendo');
    expect(r.body.exames).toHaveLength(1);
    expect(r.body.clinicoVisivel).toBe(false);
    expect(r.body.exames[0]).not.toHaveProperty('resultado');
  });

  it('recusa data de exame futura e vencimento antes do exame', async () => {
    await adm.post('/api/asos', { vinculoId: f2.vinculoId, tipo: 0, dataExame: dia(3), resultado: 1, medicoId: medico }).expect(422);
    await adm.post('/api/asos', { vinculoId: f2.vinculoId, tipo: 0, dataExame: dia(-3), resultado: 1, medicoId: medico, vencimento: dia(-5) }).expect(400);
  });

  it('gera o PDF do ASO', async () => {
    const r = await adm.get(`/api/asos/${asoId}/pdf`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    }).expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('anexa o ASO assinado só se o conteúdo for mesmo PDF/imagem', async () => {
    await adm.upload(`/api/asos/${asoId}/arquivo`, 'arquivo', Buffer.from('não é pdf'), 'aso.pdf').expect(400);
    const pdf = Buffer.from('%PDF-1.4\n%teste\n');
    const r = await adm.upload(`/api/asos/${asoId}/arquivo`, 'arquivo', pdf, 'aso assinado.pdf').expect(201);
    expect(r.body.arquivoNome).toBe('aso assinado.pdf');
    const d = await adm.get(`/api/asos/${asoId}/arquivo`).expect(200);
    expect(d.headers['content-type']).toContain('application/pdf');
  });

  describe('dado clínico', () => {
    let med: Agente;
    let exameId: string;
    beforeAll(async () => {
      med = await novoUsuario('medico@teste.local', 'MEDICO', A.empresa.id);
      exameId = (await med.get(`/api/asos/${asoId}`).expect(200)).body.exames[0].id;
    });

    it('administrador geral não lança nem vê resultado de exame', async () => {
      await adm.put(`/api/aso-exames/${exameId}/resultado`, { resultado: 2, observacao: 'Perda auditiva' }).expect(403);
    });

    it('médico da empresa lança e vê o resultado', async () => {
      const r = await med.put(`/api/aso-exames/${exameId}/resultado`, { resultado: 2, observacao: 'Perda auditiva' }).expect(200);
      expect(r.body.clinicoVisivel).toBe(true);
      expect(r.body.exames[0]).toMatchObject({ resultado: 2, observacao: 'Perda auditiva' });
      const a = (await adm.get(`/api/asos/${asoId}`).expect(200)).body;
      expect(a.exames[0]).not.toHaveProperty('resultado');
    });

    it('o banco esconde o resultado de quem não tem permissão clínica, mesmo fora da API', async () => {
      const c = new Client({ connectionString: amb.urlApp });
      await c.connect();
      const dono = new Client({ connectionString: amb.urlDono });
      await dono.connect();
      const t = (await dono.query('SELECT id FROM tenant')).rows[0].id;
      await dono.end();
      const contar = async (clinico: string) => {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.empresas', '*', true),
                              set_config('app.empresas_clinico', $2, true)`, [t, clinico]);
        const n = (await c.query('SELECT count(*)::int AS n FROM aso_exame_resultado')).rows[0].n;
        const aud = (await c.query(`SELECT count(*)::int AS n FROM auditoria WHERE tabela = 'aso_exame_resultado'`)).rows[0].n;
        await c.query('ROLLBACK');
        return [n, aud];
      };
      expect(await contar('')).toEqual([0, 0]);
      expect(await contar(A.empresa.id)).toEqual([1, 1]);
      await c.end();
    });

    it('médico de outra empresa não vê o ASO', async () => {
      const outro = await novoUsuario('medico.b@teste.local', 'MEDICO', B.empresa.id);
      await outro.get(`/api/asos/${asoId}`).expect(404);
      await outro.put(`/api/aso-exames/${exameId}/resultado`, { resultado: 1 }).expect(404);
    });
  });

  it('isola ASOs entre empresas', async () => {
    const rhB = await novoUsuario('rh.b@teste.local', 'RH', B.empresa.id);
    const l = (await rhB.get('/api/asos').expect(200)).body;
    expect(l.total).toBe(0);
    await rhB.get(`/api/asos/${asoId}`).expect(404);
    await rhB.post('/api/asos', { vinculoId: f1.vinculoId, tipo: 1, dataExame: dia(-1), resultado: 1, medicoId: medico }).expect(404);
  });

  it('cancela com motivo e não deixa alterar depois', async () => {
    const r = await adm.post(`/api/asos/${asoId}/cancelamento`, { motivo: 'Lançado no funcionário errado' }).expect(201);
    expect(r.body.situacao).toBe('cancelado');
    await adm.put(`/api/asos/${asoId}`, {
      vinculoId: f1.vinculoId, tipo: 1, dataExame: dia(-10), resultado: 1, medicoId: medico,
    }).expect(422);
  });
});

describe('treinamentos', () => {
  let treinamento: string;
  let turma: string;

  it('cadastra treinamento na biblioteca e exige pela função na matriz', async () => {
    treinamento = (await adm.post('/api/treinamentos', {
      nome: 'Segurança em eletricidade', norma: 'NR-10', cargaHoraria: 40, periodicidadeMeses: 24,
    }).expect(201)).body.id;
    await adm.post(`/api/empresas/${A.empresa.id}/matriz-treinamentos`, { treinamentoId: treinamento, funcaoId: funcaoA }).expect(201);
    await adm.post(`/api/empresas/${A.empresa.id}/matriz-treinamentos`, { treinamentoId: treinamento, funcaoId: funcaoA }).expect(409);
    const ex = (await adm.get(`/api/funcionarios/${f1.funcionarioId}/treinamentos`).expect(200)).body.exigidos;
    expect(ex).toEqual([expect.objectContaining({ situacao: 'pendente' })]);
  });

  it('turma: participantes, conclusão, validade pela periodicidade e certificado', async () => {
    turma = (await adm.post(`/api/empresas/${A.empresa.id}/turmas`, {
      treinamentoId: treinamento, tipo: 'inicial', modalidade: 'presencial', dataInicio: dia(-6), dataFim: dia(-2),
      cargaHoraria: 40, instrutorNome: 'Instrutor Teste', instrutorQualificacao: 'Engenheiro eletricista', local: 'Sede',
    }).expect(201)).body.id;
    await adm.post(`/api/turmas/${turma}/participantes`, { funcionarioIds: [fB.funcionarioId] }).expect(422);
    const t = (await adm.post(`/api/turmas/${turma}/participantes`, { funcionarioIds: [f1.funcionarioId, f2.funcionarioId] }).expect(201)).body;
    const [p1, p2] = t.participantesLista.sort((a: any, b: any) => (a.funcionarioId === f1.funcionarioId ? -1 : 1));
    await adm.post(`/api/turmas/${turma}/conclusao`, { participantes: [{ id: p1.id, presente: true, aprovado: true }] }).expect(422);
    await adm.post(`/api/turmas/${turma}/conclusao`, {
      participantes: [{ id: p1.id, presente: true, aprovado: true, nota: 9 }, { id: p2.id, presente: false, aprovado: true }],
    }).expect(400);
    const fim = (await adm.post(`/api/turmas/${turma}/conclusao`, {
      participantes: [{ id: p1.id, presente: true, aprovado: true, nota: 9 }, { id: p2.id, presente: false, aprovado: false }],
    }).expect(201)).body;
    expect(fim.situacao).toBe('realizada');
    const a1 = fim.participantesLista.find((p: any) => p.id === p1.id);
    const d = new Date(dia(-2) + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + 24);
    expect(a1.validade).toBe(d.toISOString().slice(0, 10));
    expect(a1.certificadoCodigo).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(fim.participantesLista.find((p: any) => p.id === p2.id).certificadoCodigo).toBeNull();

    const pdf = await adm.get(`/api/participantes/${p1.id}/certificado`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await adm.get(`/api/participantes/${p2.id}/certificado`).expect(422);
    await adm.post(`/api/turmas/${turma}/participantes`, { funcionarioIds: [f2.funcionarioId] }).expect(422);
  });

  it('situação: aprovado fica em dia, ausente continua pendente', async () => {
    expect((await adm.get(`/api/funcionarios/${f1.funcionarioId}/treinamentos`).expect(200)).body.exigidos[0].situacao).toBe('em_dia');
    expect((await adm.get(`/api/funcionarios/${f2.funcionarioId}/treinamentos`).expect(200)).body.exigidos[0].situacao).toBe('pendente');
  });

  it('não conclui turma que ainda não terminou', async () => {
    const t = (await adm.post(`/api/empresas/${A.empresa.id}/turmas`, {
      treinamentoId: treinamento, tipo: 'reciclagem', modalidade: 'ead', dataInicio: dia(-1), dataFim: dia(5),
      cargaHoraria: 8, instrutorNome: 'Instrutor Teste',
    }).expect(201)).body;
    const c = (await adm.post(`/api/turmas/${t.id}/participantes`, { funcionarioIds: [f2.funcionarioId] }).expect(201)).body;
    await adm.post(`/api/turmas/${t.id}/conclusao`, {
      participantes: [{ id: c.participantesLista[0].id, presente: true, aprovado: true }],
    }).expect(422);
  });

  it('usuário de outra empresa não vê turmas nem a matriz da empresa A', async () => {
    const rhB = amb.agente();
    await rhB.post('/api/auth/login', { email: 'rh.b@teste.local', senha: 'SenhaNova2026x' }).expect(200);
    expect((await rhB.get('/api/turmas').expect(200)).body).toHaveLength(0);
    await rhB.get(`/api/turmas/${turma}`).expect(404);
    await rhB.get(`/api/empresas/${A.empresa.id}/matriz-treinamentos`).expect(403);
  });
});

describe('vencimentos e prazos de alerta', () => {
  it('lista pendências de ASO e treinamento com a faixa de alerta', async () => {
    await adm.post('/api/asos', {
      vinculoId: f2.vinculoId, tipo: 1, dataExame: dia(-5), resultado: 1, medicoId: medico, vencimento: dia(25),
    }).expect(201);
    const r = (await adm.get(`/api/vencimentos?empresaId=${A.empresa.id}`).expect(200)).body;
    expect(r.alertasDias).toEqual([90, 60, 30, 15]);
    const asoF2 = r.itens.find((i: any) => i.tipo === 'aso' && i.funcionarioId === f2.funcionarioId);
    expect(asoF2).toMatchObject({ situacao: 'vencendo', faixa: 30 });
    // O ASO de f1 foi cancelado: volta a constar como sem ASO.
    expect(r.itens.find((i: any) => i.tipo === 'aso' && i.funcionarioId === f1.funcionarioId).situacao).toBe('sem_aso');
    expect(r.itens.find((i: any) => i.tipo === 'treinamento' && i.funcionarioId === f2.funcionarioId).situacao).toBe('pendente');
    expect(r.itens.some((i: any) => i.empresaId === B.empresa.id)).toBe(false);
  });

  it('só quem pode configurar altera os prazos de alerta', async () => {
    const rhB = amb.agente();
    await rhB.post('/api/auth/login', { email: 'rh.b@teste.local', senha: 'SenhaNova2026x' }).expect(200);
    await rhB.put('/api/configuracoes/alertas', { alertasDias: [10] }).expect(403);
    const r = (await adm.put('/api/configuracoes/alertas', { alertasDias: [30, 60, 30] }).expect(200)).body;
    expect(r.alertasDias).toEqual([60, 30]);
  });
});
