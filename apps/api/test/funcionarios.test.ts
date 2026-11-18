import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agente, Ambiente, cnpjTeste, configurarELogar, cpfTeste, criarEmpresa, prepararAmbiente } from './ambiente';

let amb: Ambiente;
let adm: Agente;
let E: Awaited<ReturnType<typeof criarEmpresa>>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  amb = await prepararAmbiente('funcionarios');
  adm = await configurarELogar(amb);
  E = await criarEmpresa(adm, 'Indústria Teste');
  const emp = E.empresa.id;
  const est = E.estabelecimento.id;
  ids.filial = (await adm.post(`/api/empresas/${emp}/estabelecimentos`, { tipoInscricao: 1, inscricao: cnpjTeste(2), nome: 'Filial' }).expect(201)).body.id;
  ids.producao = (await adm.post(`/api/empresas/${emp}/estrutura/setores`, { estabelecimentoId: est, nome: 'Produção' }).expect(201)).body.id;
  ids.manutencao = (await adm.post(`/api/empresas/${emp}/estrutura/setores`, { estabelecimentoId: est, nome: 'Manutenção' }).expect(201)).body.id;
  ids.setorFilial = (await adm.post(`/api/empresas/${emp}/estrutura/setores`, { estabelecimentoId: ids.filial, nome: 'Expedição' }).expect(201)).body.id;
  ids.operador = (await adm.post(`/api/empresas/${emp}/estrutura/funcoes`, { nome: 'Operador de máquinas', cbo: '784205' }).expect(201)).body.id;
  ids.mecanico = (await adm.post(`/api/empresas/${emp}/estrutura/funcoes`, { nome: 'Mecânico', cbo: '914405' }).expect(201)).body.id;
  ids.ghe1 = (await adm.post(`/api/empresas/${emp}/estrutura/ghes`, { estabelecimentoId: est, codigo: 'GHE-01', nome: 'Ruído contínuo' }).expect(201)).body.id;
});
afterAll(async () => amb?.fechar());

describe('cadastros de empresa e estrutura', () => {
  it('valida CNPJ e rejeita duplicidade', async () => {
    await adm.post('/api/empresas', { tipoInscricao: 1, inscricao: '11.222.333/0001-80', razaoSocial: 'Inválida' }).expect(400);
    const r = await adm.post('/api/empresas', { tipoInscricao: 1, inscricao: E.empresa.inscricao, razaoSocial: 'Duplicada' }).expect(409);
    expect(r.body.mensagem).toMatch(/Já existe uma empresa/);
  });

  it('permite só uma matriz por empresa', async () => {
    const r = await adm.post(`/api/empresas/${E.empresa.id}/estabelecimentos`, { tipoInscricao: 1, inscricao: cnpjTeste(3), nome: 'Outra', matriz: true }).expect(409);
    expect(r.body.mensagem).toMatch(/matriz/);
  });

  it('lista setores por estabelecimento', async () => {
    const r = (await adm.get(`/api/empresas/${E.empresa.id}/estrutura/setores?estabelecimentoId=${E.estabelecimento.id}`).expect(200)).body;
    expect(r.map((s: any) => s.nome).sort()).toEqual(['Manutenção', 'Produção']);
  });
});

describe('ciclo de vida do funcionário', () => {
  let funcionarioId: string;
  let vinculoId: string;

  it('admite com lotação inicial', async () => {
    const r = await adm.post(`/api/empresas/${E.empresa.id}/funcionarios`, {
      pessoa: { nome: 'Fulano Teste', cpf: cpfTeste(), dataNascimento: '1990-03-15', sexo: 'M' },
      matricula: '0001', dataAdmissao: '2024-02-01', categoria: '101', tipoContrato: 1, jornada: '44h semanais',
      posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.producao, funcaoId: ids.operador, gheId: ids.ghe1 },
    }).expect(201);
    ({ funcionarioId, vinculoId } = r.body);
  });

  it('recusa setor de outro estabelecimento', async () => {
    const r = await adm.post(`/api/empresas/${E.empresa.id}/funcionarios`, {
      pessoa: { nome: 'Ciclano', cpf: cpfTeste() }, matricula: '0002', dataAdmissao: '2024-02-01',
      posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.setorFilial },
    }).expect(422);
    expect(r.body.mensagem).toMatch(/outro estabelecimento/);
  });

  it('transferência e mudança de função preservam o histórico', async () => {
    await adm.post(`/api/vinculos/${vinculoId}/movimentacoes`, {
      inicio: '2025-01-01', motivo: 'Mudança de função',
      posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.manutencao, funcaoId: ids.mecanico },
    }).expect(201);
    await adm.post(`/api/vinculos/${vinculoId}/movimentacoes`, {
      inicio: '2025-06-01', motivo: 'Transferência para a filial',
      posicao: { estabelecimentoId: ids.filial, setorId: ids.setorFilial, funcaoId: ids.mecanico },
    }).expect(201);
    const f = (await adm.get(`/api/funcionarios/${funcionarioId}`).expect(200)).body;
    const lot = f.vinculos[0].lotacoes;
    expect(lot.map((l: any) => [l.inicio, l.fim, l.setor, l.funcao])).toEqual([
      ['2025-06-01', null, 'Expedição', 'Mecânico'],
      ['2025-01-01', '2025-05-31', 'Manutenção', 'Mecânico'],
      ['2024-02-01', '2024-12-31', 'Produção', 'Operador de máquinas'],
    ]);
    expect(lot[2].ghe).toBe('GHE-01 - Ruído contínuo');
  });

  it('não aceita movimentação retroativa que reescreveria o histórico', async () => {
    await adm.post(`/api/vinculos/${vinculoId}/movimentacoes`, {
      inicio: '2025-03-01', motivo: 'Retroativa', posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.producao },
    }).expect(422);
  });

  it('afastamento muda a situação e não pode se sobrepor', async () => {
    const a = (await adm.post(`/api/vinculos/${vinculoId}/afastamentos`, { inicio: '2025-07-01', motivo: 'Doença' }).expect(201)).body;
    const lista = (await adm.get(`/api/funcionarios?empresaId=${E.empresa.id}&situacao=afastado`).expect(200)).body;
    expect(lista.itens.map((i: any) => i.vinculoId)).toContain(vinculoId);
    await adm.post(`/api/vinculos/${vinculoId}/afastamentos`, { inicio: '2025-07-15', motivo: 'Outro' }).expect(409);
    await adm.post(`/api/afastamentos/${a.id}/encerramento`, { fim: '2025-06-30' }).expect(422);
    await adm.post(`/api/afastamentos/${a.id}/encerramento`, { fim: '2025-07-31' }).expect(201);
    const depois = (await adm.get(`/api/funcionarios?empresaId=${E.empresa.id}&situacao=afastado`).expect(200)).body;
    expect(depois.itens.map((i: any) => i.vinculoId)).not.toContain(vinculoId);
  });

  it('desligamento fecha a lotação e muda a situação', async () => {
    await adm.post(`/api/vinculos/${vinculoId}/desligamento`, { data: '2025-08-31', motivo: 'Pedido de demissão' }).expect(201);
    const f = (await adm.get(`/api/funcionarios/${funcionarioId}`).expect(200)).body;
    expect(f.vinculos[0].situacao).toBe('desligado');
    expect(f.vinculos[0].lotacoes[0].fim).toBe('2025-08-31');
    await adm.post(`/api/vinculos/${vinculoId}/movimentacoes`, {
      inicio: '2025-09-10', motivo: 'Após desligamento', posicao: { estabelecimentoId: E.estabelecimento.id },
    }).expect(422);
  });

  it('readmissão cria novo vínculo para a mesma pessoa', async () => {
    const f = (await adm.get(`/api/funcionarios/${funcionarioId}`).expect(200)).body;
    await adm.post(`/api/empresas/${E.empresa.id}/funcionarios`, {
      pessoa: { nome: f.nome, cpf: f.cpf }, matricula: '0001-R', dataAdmissao: '2026-01-05',
      posicao: { estabelecimentoId: E.estabelecimento.id },
    }).expect(201);
    const g = (await adm.get(`/api/funcionarios/${funcionarioId}`).expect(200)).body;
    expect(g.vinculos).toHaveLength(2);
  });

  it('registra o histórico de alterações com o usuário', async () => {
    const h = (await adm.get(`/api/funcionarios/${funcionarioId}/historico`).expect(200)).body;
    expect(h.length).toBeGreaterThan(5);
    expect(h.every((x: any) => x.usuario === 'Admin Teste')).toBe(true);
  });

  it('movimentação em lote é tudo ou nada', async () => {
    const mk = async (m: string) =>
      (await adm.post(`/api/empresas/${E.empresa.id}/funcionarios`, {
        pessoa: { nome: `Lote ${m}`, cpf: cpfTeste() }, matricula: m, dataAdmissao: '2025-01-01',
        posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.producao },
      }).expect(201)).body.vinculoId;
    const v1 = await mk('L1');
    const v2 = await mk('L2');
    const v3 = await mk('L3');
    await adm.post(`/api/vinculos/${v3}/movimentacoes`, {
      inicio: '2025-10-01', motivo: 'antes', posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.manutencao },
    }).expect(201);
    // v3 já tem lotação começando em 2025-10-01, então o lote com início anterior deve falhar inteiro
    const r = await adm.post('/api/vinculos/movimentacao-em-lote', {
      vinculoIds: [v1, v2, v3], inicio: '2025-09-01', motivo: 'Reestruturação',
      posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.manutencao },
    }).expect(422);
    expect(r.body.mensagem).toMatch(/Nenhuma alteração do lote foi gravada/);
    const l = (await adm.get(`/api/funcionarios?empresaId=${E.empresa.id}&setorId=${ids.manutencao}`).expect(200)).body;
    expect(l.itens.map((i: any) => i.vinculoId)).toEqual([v3]);
    await adm.post('/api/vinculos/movimentacao-em-lote', {
      vinculoIds: [v1, v2], inicio: '2025-09-01', motivo: 'Reestruturação',
      posicao: { estabelecimentoId: E.estabelecimento.id, setorId: ids.manutencao },
    }).expect(201);
  });
});

describe('importação Excel', () => {
  async function planilha(linhas: (string | Date)[][]) {
    const modelo = await adm.get('/api/importacoes/funcionarios/modelo').expect(200).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(modelo.body);
    const ws = wb.getWorksheet('Funcionários')!;
    linhas.forEach((l) => ws.addRow(l));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('mostra prévia com erros por linha, sem gravar, e grava só na confirmação', async () => {
    const cnpjEst = E.estabelecimento.inscricao;
    const cpfOk1 = cpfTeste();
    const cpfOk2 = cpfTeste();
    const buf = await planilha([
      [cpfOk1, 'Importado Um', '15/04/1985', 'F', '', '', 'IMP1', '02/01/2025', '101', '1', '', cnpjEst, 'Produção', '', 'Operador de máquinas', 'GHE-01'],
      [cpfOk2, 'Importado Dois', '', '', '', '', 'IMP2', new Date(Date.UTC(2025, 0, 3)), '', '', '', 'Indústria Teste - Matriz', '', '', '', ''],
      ['123.456.789-00', 'CPF Errado', '', '', '', '', 'IMP3', '02/01/2025', '', '', '', cnpjEst, '', '', '', ''],
      [cpfTeste(), 'Setor Inexistente', '', '', '', '', 'IMP4', '31/02/2025', '', '', '', cnpjEst, 'Almoxarifado', '', '', ''],
      [cpfTeste(), 'Matrícula Repetida', '', '', '', '', 'IMP1', '02/01/2025', '', '', '', cnpjEst, '', '', '', ''],
    ]);
    const prev = (await adm.upload(`/api/empresas/${E.empresa.id}/importacoes/funcionarios`, 'arquivo', buf, 'func.xlsx').expect(201)).body;
    expect(prev.totalLinhas).toBe(5);
    expect(prev.linhasValidas).toBe(2);
    const porLinha = Object.fromEntries(prev.erros.map((e: any) => [e.linha, e.mensagens.join(' | ')]));
    expect(porLinha[4]).toMatch(/CPF/);
    expect(porLinha[5]).toMatch(/Setor "Almoxarifado"/);
    expect(porLinha[5]).toMatch(/Data de admissão/);
    expect(porLinha[6]).toMatch(/Matrícula repetida/);

    let l = (await adm.get(`/api/funcionarios?empresaId=${E.empresa.id}&busca=Importado`).expect(200)).body;
    expect(l.total).toBe(0);

    expect((await adm.post(`/api/importacoes/${prev.id}/confirmacao`).expect(201)).body).toEqual({ gravados: 2 });
    l = (await adm.get(`/api/funcionarios?empresaId=${E.empresa.id}&busca=Importado`).expect(200)).body;
    expect(l.itens.map((i: any) => [i.nome, i.setor, i.funcao, i.ghe]).sort()).toEqual([
      ['Importado Dois', null, null, null],
      ['Importado Um', 'Produção', 'Operador de máquinas', 'GHE-01'],
    ]);
    await adm.post(`/api/importacoes/${prev.id}/confirmacao`).expect(422);
  });

  it('rejeita arquivo que não é Excel', async () => {
    await adm.upload(`/api/empresas/${E.empresa.id}/importacoes/funcionarios`, 'arquivo', Buffer.from('a;b;c'), 'x.csv').expect(422);
  });
});

describe('permissões por perfil', () => {
  it('visualizador lê mas não altera', async () => {
    await adm.post('/api/usuarios', {
      nome: 'Leitor', email: 'leitor@teste.local', senhaTemporaria: 'Temporaria123', atribuicoes: [{ perfil: 'VISUALIZADOR', empresaId: E.empresa.id }],
    }).expect(201);
    const v = amb.agente();
    await v.post('/api/auth/login', { email: 'leitor@teste.local', senha: 'Temporaria123' }).expect(200);
    await v.post('/api/auth/senha', { atual: 'Temporaria123', nova: 'LeitorSenha2026' }).expect(200);
    await v.get('/api/funcionarios').expect(200);
    await v.post(`/api/empresas/${E.empresa.id}/estrutura/setores`, { estabelecimentoId: E.estabelecimento.id, nome: 'X' }).expect(403);
    await v.get('/api/usuarios').expect(403);
    await v.get('/api/auditoria').expect(403);
  });

  it('não deixa o sistema sem administrador geral', async () => {
    const eu = (await adm.get('/api/auth/eu').expect(200)).body;
    await adm.put(`/api/usuarios/${eu.id}`, {
      nome: 'Admin Teste', email: 'admin@teste.local', ativo: true, atribuicoes: [{ perfil: 'VISUALIZADOR', empresaId: null }],
    }).expect(422);
  });
});
