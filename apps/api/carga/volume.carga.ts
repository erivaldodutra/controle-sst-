/**
 * Teste de carga com volume realista de um escritório de SST:
 * 30 empresas, 1.000 vínculos em cada (30 mil), ASOs, treinamentos, ações, ocorrências e documentos.
 *
 * Roda num banco descartável criado só para isso (sst_it_carga), apagado no começo de cada execução.
 * Um registro de cada tipo é criado pela API (com todas as validações) e depois replicado no banco
 * para chegar ao volume. Mede o tempo das telas e relatórios mais usados e grava o resultado em
 * carga/resultado.json. Nenhum dado daqui vai para um banco real.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, configurarELogar, cpfTeste, criarEmpresa, prepararAmbiente } from '../test/ambiente';

const EMPRESAS = Number(process.env.CARGA_EMPRESAS ?? 30);
const VINCULOS = Number(process.env.CARGA_VINCULOS ?? 1000);
const ACOES = 100;
const OCORRENCIAS = 50;
const DOCUMENTOS = 12;
/** Limite aceitável para uma tela abrir (ms), no notebook do usuário espera-se algo parecido ou melhor. */
const LIMITE_TELA = 2000;
const LIMITE_RELATORIO = 15000;

let amb: Ambiente;
let adm: Agente;
let tec: Agente;
let dono: Client;
const empresas: { id: string; est: string }[] = [];
const medidas: { nome: string; ms: number; bytes: number; limite: number }[] = [];

const hoje = new Date();
const dia = (delta: number) => new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + delta)).toISOString().slice(0, 10);

const binario = (r: any) => r.buffer(true).parse((res: any, cb: any) => {
  const p: Buffer[] = [];
  res.on('data', (c: Buffer) => p.push(c));
  res.on('end', () => cb(null, Buffer.concat(p)));
});

async function medir(nome: string, a: Agente, url: string, limite = LIMITE_TELA, bin = false) {
  // Primeira chamada aquece o cache do banco; mede a mediana de 3.
  const tempos: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await (bin ? binario(a.get(url)) : a.get(url));
    tempos.push(performance.now() - t0);
    expect(r.status, `${nome}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
    bytes = bin ? (r.body as Buffer).length : JSON.stringify(r.body).length;
  }
  const ms = Math.round(tempos.sort((x, y) => x - y)[1]!);
  medidas.push({ nome, ms, bytes, limite });
  return ms;
}

beforeAll(async () => {
  const t0 = Date.now();
  amb = await prepararAmbiente('carga');
  adm = await configurarELogar(amb);
  dono = new Client({ connectionString: amb.urlDono });
  await dono.connect();
  await adm.post('/api/documentos-tipos/biblioteca').expect(201);
  const tipos = Object.fromEntries((await adm.get('/api/documentos-tipos').expect(200)).body.map((t: any) => [t.sigla, t]));
  const medico = (await adm.post('/api/saude/medicos', { nome: 'Médico Examinador', crm: '123456', ufCrm: 'SP' }).expect(201)).body.id;
  const trein = (await adm.post('/api/treinamentos', { nome: 'NR-35 Trabalho em altura', norma: 'NR-35', cargaHoraria: 8, periodicidadeMeses: 24 }).expect(201)).body.id;

  for (let e = 0; e < EMPRESAS; e++) {
    const { empresa, estabelecimento } = await criarEmpresa(adm, `Empresa Carga ${String(e + 1).padStart(2, '0')}`);
    empresas.push({ id: empresa.id, est: estabelecimento.id });
    const E = empresa.id;
    const funcao = (await adm.post(`/api/empresas/${E}/estrutura/funcoes`, { nome: 'Operador', descricaoAtividades: 'Operar máquinas' }).expect(201)).body.id;
    await adm.post(`/api/empresas/${E}/matriz-treinamentos`, { treinamentoId: trein, funcaoId: funcao }).expect(201);
    // Modelos criados pela API (passam por todas as validações).
    const f = (await adm.post(`/api/empresas/${E}/funcionarios`, {
      pessoa: { nome: 'Modelo da Carga', cpf: cpfTeste() }, matricula: 'M-0', dataAdmissao: dia(-900),
      posicao: { estabelecimentoId: estabelecimento.id, funcaoId: funcao },
    }).expect(201)).body;
    await adm.post('/api/asos', { vinculoId: f.vinculoId, tipo: 1, dataExame: dia(-300), resultado: 1, medicoId: medico, vencimento: dia(65) }).expect(201);
    const turma = (await adm.post(`/api/empresas/${E}/turmas`, {
      treinamentoId: trein, tipo: 'inicial', modalidade: 'presencial', dataInicio: dia(-200), dataFim: dia(-200),
      cargaHoraria: 8, instrutorNome: 'Instrutor', instrutorQualificacao: 'Técnico de segurança', local: 'Sede',
    }).expect(201)).body.id;
    await adm.post('/api/acoes', {
      empresaId: E, estabelecimentoId: estabelecimento.id, origem: 'pgr', perigo: 'Queda de altura', descricao: 'Instalar linha de vida',
      tipo: 'introduzir', prioridade: 'alta', responsavelNome: 'Responsável', dataAbertura: dia(-30), prazo: dia(30),
    }).expect(201);
    await adm.post('/api/ocorrencias', {
      empresaId: E, estabelecimentoId: estabelecimento.id, dataHora: `${dia(-20)}T10:00`, tipo: 'quase_acidente', gravidade: 'sem_lesao',
      local: 'Pátio', descricao: 'Material caiu próximo a um trabalhador',
    }).expect(201);
    for (let d = 0; d < DOCUMENTOS; d++)
      await adm.post('/api/documentos', { empresaId: E, tipoId: (tipos.PGR ?? Object.values(tipos)[0]).id, identificacao: `Documento ${d + 1}` }).expect(201);

    // Replicação para chegar ao volume (CPFs válidos gerados para o banco descartável).
    const cpfs = Array.from({ length: VINCULOS - 1 }, () => cpfTeste());
    await dono.query('BEGIN');
    await dono.query(
      `WITH m AS (SELECT * FROM funcionario WHERE id = $1),
            fs AS (INSERT INTO funcionario (tenant_id, empresa_id, nome, cpf, data_nascimento, sexo)
                   SELECT m.tenant_id, m.empresa_id, 'Trabalhador ' || lpad(n::text, 5, '0'), c, date '1970-01-01' + (n::int * 7 % 12000), CASE WHEN n % 3 = 0 THEN 'F' ELSE 'M' END
                     FROM m, unnest($2::text[]) WITH ORDINALITY AS u(c, n)
                   RETURNING id, tenant_id, empresa_id, nome),
            vs AS (INSERT INTO vinculo (tenant_id, empresa_id, funcionario_id, matricula, data_admissao, data_desligamento, categoria, tipo_contrato)
                   SELECT fs.tenant_id, fs.empresa_id, fs.id, 'C-' || substr(fs.nome, 13), current_date - (300 + (substr(fs.nome, 13)::int * 13 % 3000)),
                          CASE WHEN substr(fs.nome, 13)::int % 10 = 0 THEN current_date - (substr(fs.nome, 13)::int % 200) END, v.categoria, v.tipo_contrato
                     FROM fs, (SELECT * FROM vinculo WHERE id = $3) v
                   RETURNING id, tenant_id, empresa_id, data_admissao)
       INSERT INTO lotacao (tenant_id, empresa_id, vinculo_id, estabelecimento_id, setor_id, cargo_id, funcao_id, ghe_id, inicio, motivo)
       SELECT vs.tenant_id, vs.empresa_id, vs.id, l.estabelecimento_id, l.setor_id, l.cargo_id, l.funcao_id, l.ghe_id, vs.data_admissao, l.motivo
         FROM vs, (SELECT * FROM lotacao WHERE vinculo_id = $3) l`,
      [f.funcionarioId, cpfs, f.vinculoId],
    );
    // Dois ASOs por vínculo (admissional antigo e periódico), com vencimentos espalhados de -60 a +300 dias.
    await dono.query(
      `INSERT INTO aso (tenant_id, empresa_id, vinculo_id, tipo, data_exame, resultado, medico_id, vencimento)
       SELECT v.tenant_id, v.empresa_id, v.id, 1, v.data_admissao, 1, a.medico_id, NULL
         FROM vinculo v, (SELECT * FROM aso WHERE vinculo_id = $2) a WHERE v.empresa_id = $1 AND v.id <> $2
       UNION ALL
       SELECT v.tenant_id, v.empresa_id, v.id, 2, current_date - 365 + (abs(hashtext(v.id::text)) % 360) - 60, 1, a.medico_id,
              current_date + (abs(hashtext(v.id::text)) % 360) - 60
         FROM vinculo v, (SELECT * FROM aso WHERE vinculo_id = $2) a WHERE v.empresa_id = $1 AND v.id <> $2`,
      [E, f.vinculoId],
    );
    // Metade dos trabalhadores fez o treinamento exigido.
    await dono.query(
      `INSERT INTO turma_participante (tenant_id, empresa_id, turma_id, funcionario_id, presente, aprovado, validade)
       SELECT f.tenant_id, f.empresa_id, $2, f.id, true, true, current_date + (abs(hashtext(f.id::text)) % 700) - 200
         FROM funcionario f WHERE f.empresa_id = $1 AND abs(hashtext(f.id::text)) % 2 = 0`,
      [E, turma],
    );
    await dono.query(
      `INSERT INTO acao (tenant_id, empresa_id, codigo, estabelecimento_id, origem, perigo, descricao, tipo, prioridade, responsavel_nome,
                         data_abertura, prazo_inicial, prazo, exige_evidencia, dispensa_justificativa)
       SELECT a.tenant_id, a.empresa_id, 'AC-C' || $3::int || '-' || n, a.estabelecimento_id, a.origem, a.perigo, 'Ação ' || n, a.tipo, a.prioridade, a.responsavel_nome,
              current_date - (n * 7 % 700), current_date - (n * 7 % 700) + 60, current_date - (n * 7 % 700) + 60,
              false, 'Volume do teste de carga'
         FROM (SELECT * FROM acao WHERE empresa_id = $1 LIMIT 1) a, generate_series(1, $2::int) n`,
      [E, ACOES - 1, e],
    );
    // Dois terços das ações já foram concluídas (validadas) 30 dias depois da abertura.
    await dono.query(
      `UPDATE acao SET situacao = 'concluida', concluida_em = data_abertura + 30, validada_por_nome = 'Validador'
        WHERE empresa_id = $1 AND codigo LIKE 'AC-C%' AND substr(descricao, 6)::int % 3 <> 0`,
      [E],
    );
    await dono.query(
      `INSERT INTO ocorrencia (tenant_id, empresa_id, codigo, estabelecimento_id, data_hora, tipo, gravidade, local, descricao, houve_afastamento)
       SELECT o.tenant_id, o.empresa_id, 'OC-C' || $3::int || '-' || n, o.estabelecimento_id, now() - make_interval(days => n * 11 % 700),
              CASE WHEN n % 5 = 0 THEN 'acidente_tipico' ELSE o.tipo END, CASE WHEN n % 5 = 0 THEN 'leve' ELSE o.gravidade END,
              o.local, 'Ocorrência ' || n, n % 25 = 0
         FROM (SELECT * FROM ocorrencia WHERE empresa_id = $1 LIMIT 1) o, generate_series(1, $2::int) n`,
      [E, OCORRENCIAS - 1, e],
    );
    await dono.query('COMMIT');
  }
  await dono.query('ANALYZE');
  tec = amb.agente();
  await adm.post('/api/usuarios', {
    nome: 'Técnico Carga', email: 'tec.carga@teste.local', senhaTemporaria: 'Temporaria123',
    atribuicoes: empresas.slice(0, 5).map((e) => ({ perfil: 'TEC_SEGURANCA', empresaId: e.id })),
  }).expect(201);
  await tec.post('/api/auth/login', { email: 'tec.carga@teste.local', senha: 'Temporaria123' }).expect(200);
  await tec.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'SenhaNova2026x' }).expect(200);
  console.log(`Volume preparado em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}, 900_000);

afterAll(async () => {
  await dono?.query('ROLLBACK').catch(() => {});
  const volume = dono ? Object.fromEntries(await Promise.all(
    ['empresa', 'funcionario', 'vinculo', 'lotacao', 'aso', 'turma_participante', 'acao', 'ocorrencia', 'documento', 'notificacao', 'auditoria']
      .map(async (t) => [t, (await dono.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n]),
  )) : {};
  const resultado = { executadoEm: new Date().toISOString(), node: process.version, volume, medidas };
  writeFileSync(join(__dirname, 'resultado.json'), JSON.stringify(resultado, null, 2));
  console.table(medidas);
  console.log(volume);
  await dono?.end();
  await amb?.fechar();
});

describe('telas com volume realista', () => {
  it('administrador (todas as empresas)', async () => {
    const E = empresas[0]!.id;
    await medir('Início (contagens)', adm, '/api/painel/contagens');
    await medir('Notificações (1ª geração)', adm, '/api/notificacoes');
    await medir('Notificações', adm, '/api/notificacoes');
    await medir('Calendário (90 dias, como a tela)', adm, `/api/calendario?ate=${dia(90)}`);
    await medir('Calendário (mês atual)', adm, `/api/calendario?ate=${dia(30)}`);
    await medir('Início (resumo de vencimentos)', adm, '/api/vencimentos?todos=1&resumo=1');
    await medir('Indicadores (12 meses)', adm, '/api/indicadores');
    await medir('Indicadores de uma empresa', adm, `/api/indicadores?empresaId=${E}`);
    await medir('Funcionários (página 1)', adm, '/api/funcionarios');
    await medir('Funcionários de uma empresa', adm, `/api/funcionarios?empresaId=${E}`);
    await medir('Busca por nome', adm, '/api/busca?q=Trabalhador%2000123');
    await medir('ASOs (página 1)', adm, '/api/asos');
    await medir('Vencimentos (ASO e treinamentos)', adm, '/api/vencimentos');
    await medir('Ações', adm, '/api/acoes');
    await medir('Ocorrências', adm, '/api/ocorrencias');
    await medir('Documentos', adm, '/api/documentos');
    await medir('Auditoria', adm, '/api/auditoria');
    await medir('Política de retenção', adm, '/api/seguranca/politica');
  });

  it('técnico com 5 empresas (RLS filtrando)', async () => {
    await medir('Técnico: notificações', tec, '/api/notificacoes');
    await medir('Técnico: indicadores', tec, '/api/indicadores');
    await medir('Técnico: vencimentos', tec, '/api/vencimentos');
    await medir('Técnico: funcionários', tec, '/api/funcionarios');
  });

  it('relatórios', async () => {
    const E = empresas[0]!.id;
    await medir('Relatório funcionários (Excel, uma empresa)', adm, `/api/relatorios/funcionarios?formato=xlsx&empresaId=${E}`, LIMITE_RELATORIO, true);
    await medir('Relatório ASO (PDF, uma empresa)', adm, `/api/relatorios/aso?formato=pdf&empresaId=${E}`, LIMITE_RELATORIO, true);
    await medir('Relatório ASO (Excel, todas)', adm, '/api/relatorios/aso?formato=xlsx', LIMITE_RELATORIO, true);
    await medir('Relatório ações (PDF, todas)', adm, '/api/relatorios/acoes?formato=pdf', LIMITE_RELATORIO, true);
    await medir('Relatório treinamentos (Excel, todas)', adm, '/api/relatorios/treinamentos?formato=xlsx', LIMITE_RELATORIO, true);
  });

  it('nenhuma medida passou do limite e nenhuma tela recebe mais de 5 MB', () => {
    const lentas = medidas.filter((m) => m.ms > m.limite);
    expect(lentas, JSON.stringify(lentas)).toEqual([]);
    const pesadas = medidas.filter((m) => !m.nome.startsWith('Relatório') && m.bytes > 5_000_000);
    expect(pesadas, JSON.stringify(pesadas)).toEqual([]);
  });
});
