import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { admissaoSchema, somenteDigitos, type AdmissaoInput } from '@sst/shared';
import ExcelJS from 'exceljs';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { Banco, Tx } from '../db/banco';
import { FuncionariosService } from '../funcionarios/funcionarios.service';

/** Colunas do modelo de importação, na ordem da planilha. */
export const COLUNAS = [
  { chave: 'cpf', titulo: 'CPF', obrigatoria: true },
  { chave: 'nome', titulo: 'Nome completo', obrigatoria: true },
  { chave: 'dataNascimento', titulo: 'Data de nascimento', obrigatoria: false },
  { chave: 'sexo', titulo: 'Sexo (M/F)', obrigatoria: false },
  { chave: 'email', titulo: 'E-mail', obrigatoria: false },
  { chave: 'telefone', titulo: 'Telefone', obrigatoria: false },
  { chave: 'matricula', titulo: 'Matrícula', obrigatoria: true },
  { chave: 'dataAdmissao', titulo: 'Data de admissão', obrigatoria: true },
  { chave: 'categoria', titulo: 'Categoria eSocial (3 dígitos)', obrigatoria: false },
  { chave: 'tipoContrato', titulo: 'Tipo de contrato (1, 2 ou 3)', obrigatoria: false },
  { chave: 'jornada', titulo: 'Jornada', obrigatoria: false },
  { chave: 'estabelecimento', titulo: 'Estabelecimento (CNPJ/CAEPF/CNO ou nome)', obrigatoria: true },
  { chave: 'setor', titulo: 'Setor (nome)', obrigatoria: false },
  { chave: 'cargo', titulo: 'Cargo (nome)', obrigatoria: false },
  { chave: 'funcao', titulo: 'Função (nome)', obrigatoria: false },
  { chave: 'ghe', titulo: 'GHE (código)', obrigatoria: false },
] as const;

const MAX_LINHAS = 5000;

export interface ErroLinha {
  linha: number;
  mensagens: string[];
}

function textoCelula(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return dataIso(v);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('result' in v) return textoCelula(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
  }
  return String(v).trim();
}

/** Excel guarda datas em UTC sem fuso; usa os componentes UTC. */
function dataIso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Aceita AAAA-MM-DD ou DD/MM/AAAA. Devolve null se vazio, 'invalida' se não reconhecer. */
function normalizarData(s: string): string | null | 'invalida' {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 'invalida';
  const [, d, mes, a] = m;
  const iso = `${a}-${mes!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  return isNaN(dt.getTime()) || dataIso(dt) !== iso ? 'invalida' : iso;
}

const chaveNome = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

@Injectable()
export class ImportacaoService {
  constructor(@Inject(BANCO) private readonly banco: Banco, private readonly funcionarios: FuncionariosService) {}

  async modelo(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Funcionários');
    ws.columns = COLUNAS.map((c) => ({ header: c.titulo, key: c.chave, width: Math.max(16, c.titulo.length + 2) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const inst = wb.addWorksheet('Instruções');
    inst.columns = [{ width: 110 }];
    [
      'Preencha uma linha por funcionário a partir da linha 2 da aba "Funcionários". Não altere os títulos.',
      'Colunas obrigatórias: CPF, Nome completo, Matrícula, Data de admissão e Estabelecimento.',
      'Datas: DD/MM/AAAA ou células de data do Excel.',
      'Estabelecimento, setor, cargo, função e GHE precisam estar cadastrados antes da importação.',
      'Nenhum dado é gravado no envio: o sistema mostra uma prévia com os erros de cada linha e só grava após a sua confirmação.',
      'Na confirmação, ou todas as linhas válidas são gravadas, ou nenhuma.',
    ].forEach((t) => inst.addRow([t]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Lê a planilha, valida tudo e guarda a prévia. Não grava funcionários. */
  async previa(u: Usuario, empresaId: string, nomeArquivo: string, conteudo: Buffer) {
    u.exigir('funcionarios.importar', empresaId);
    u.exigir('funcionarios.editar', empresaId);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(conteudo as any);
    } catch {
      throw new UnprocessableEntityException({ mensagem: 'Arquivo não é uma planilha Excel (.xlsx) válida' });
    }
    const ws = wb.getWorksheet('Funcionários') ?? wb.worksheets[0];
    if (!ws) throw new UnprocessableEntityException({ mensagem: 'Planilha vazia' });
    const cab = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => chaveNome(textoCelula(v)));
    const indice: Record<string, number> = {};
    for (const c of COLUNAS) {
      const i = cab.indexOf(chaveNome(c.titulo));
      if (i < 0 && c.obrigatoria)
        throw new UnprocessableEntityException({ mensagem: `Coluna "${c.titulo}" não encontrada. Use o modelo de importação.` });
      if (i >= 0) indice[c.chave] = i + 1;
    }

    return this.banco.tx(u.ctx('importacao_previa'), async (tx) => {
      if (!(await tx.one('SELECT 1 FROM empresa WHERE id = $1', [empresaId])))
        throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
      const ref = await this.referencias(tx, empresaId);
      const erros: ErroLinha[] = [];
      const validas: { linha: number; dados: AdmissaoInput }[] = [];
      const cpfsArquivo = new Map<string, number>();
      const matriculasArquivo = new Map<string, number>();
      let total = 0;

      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const val = (k: string) => (indice[k] ? textoCelula(row.getCell(indice[k]!).value) : '');
        if (COLUNAS.every((c) => !val(c.chave))) continue;
        total++;
        if (total > MAX_LINHAS) throw new UnprocessableEntityException({ mensagem: `Limite de ${MAX_LINHAS} linhas por importação` });
        const msgs: string[] = [];

        const est = ref.estab(val('estabelecimento'));
        if (!est) msgs.push(`Estabelecimento "${val('estabelecimento')}" não cadastrado nesta empresa`);
        const busca = (mapa: Map<string, { id: string; estab?: string }>, k: string, rotulo: string) => {
          const v = val(k);
          if (!v) return null;
          const item = mapa.get(chaveNome(v));
          if (!item) {
            msgs.push(`${rotulo} "${v}" não cadastrado(a)`);
            return null;
          }
          if (item.estab && est && item.estab !== est) msgs.push(`${rotulo} "${v}" pertence a outro estabelecimento`);
          return item.id;
        };
        const setorId = est ? busca(ref.setores.get(est) ?? new Map(), 'setor', 'Setor') : null;
        const gheId = est ? busca(ref.ghes.get(est) ?? new Map(), 'ghe', 'GHE') : null;
        const cargoId = busca(ref.cargos, 'cargo', 'Cargo');
        const funcaoId = busca(ref.funcoes, 'funcao', 'Função');

        const nasc = normalizarData(val('dataNascimento'));
        const adm = normalizarData(val('dataAdmissao'));
        if (nasc === 'invalida') msgs.push('Data de nascimento inválida');
        if (adm === 'invalida' || adm === null) msgs.push('Data de admissão ausente ou inválida');
        const tc = val('tipoContrato');

        const parsed = admissaoSchema.safeParse({
          pessoa: {
            nome: val('nome'), cpf: val('cpf'), dataNascimento: nasc === 'invalida' ? null : nasc,
            sexo: val('sexo').toUpperCase() || null, email: val('email') || null, telefone: val('telefone') || null,
          },
          matricula: val('matricula'),
          dataAdmissao: adm === 'invalida' ? null : adm,
          categoria: val('categoria') || null,
          tipoContrato: tc ? Number(tc) : null,
          jornada: val('jornada') || null,
          posicao: { estabelecimentoId: est ?? '00000000-0000-0000-0000-000000000000', setorId, cargoId, funcaoId, gheId },
        });
        if (!parsed.success) {
          for (const i of parsed.error.issues) {
            const campo = i.path.join('.');
            if (campo === 'dataAdmissao' || campo === 'posicao.estabelecimentoId') continue; // já reportados
            msgs.push(`${rotuloCampo(campo)}: ${i.message}`);
          }
        }
        const cpf = somenteDigitos(val('cpf'));
        const mat = val('matricula');
        if (cpf && cpfsArquivo.has(cpf)) msgs.push(`CPF repetido na planilha (linha ${cpfsArquivo.get(cpf)})`);
        if (mat && matriculasArquivo.has(mat)) msgs.push(`Matrícula repetida na planilha (linha ${matriculasArquivo.get(mat)})`);
        if (cpf) cpfsArquivo.set(cpf, r);
        if (mat) matriculasArquivo.set(mat, r);
        if (mat && ref.matriculas.has(mat)) msgs.push('Matrícula já cadastrada nesta empresa');
        if (cpf && ref.cpfsAtivos.has(cpf)) msgs.push('CPF já tem vínculo ativo nesta empresa');

        if (msgs.length || !parsed.success) erros.push({ linha: r, mensagens: msgs });
        else validas.push({ linha: r, dados: parsed.data });
      }
      if (total === 0) throw new UnprocessableEntityException({ mensagem: 'Nenhuma linha preenchida na planilha' });

      const imp = await tx.one(
        `INSERT INTO importacao (tenant_id, empresa_id, tipo, arquivo_nome, situacao, total_linhas, linhas_validas, erros, linhas, criado_por)
         VALUES (app.tenant_atual(), $1, 'funcionarios', $2, 'pre_visualizada', $3, $4, $5::jsonb, $6::jsonb, app.usuario_atual())
         RETURNING id`,
        [empresaId, nomeArquivo.slice(0, 200), total, validas.length, JSON.stringify(erros), JSON.stringify(validas)],
      );
      return {
        id: imp!.id,
        totalLinhas: total,
        linhasValidas: validas.length,
        erros,
        amostra: validas.slice(0, 20).map((v) => ({ linha: v.linha, nome: v.dados.pessoa.nome, cpf: v.dados.pessoa.cpf, matricula: v.dados.matricula, dataAdmissao: v.dados.dataAdmissao })),
      };
    });
  }

  private async referencias(tx: Tx, empresaId: string) {
    const ests = await tx.query('SELECT id, inscricao, nome FROM estabelecimento WHERE empresa_id = $1 AND ativo', [empresaId]);
    const porEstab = async (tabela: string, col: string) => {
      const m = new Map<string, Map<string, { id: string; estab: string }>>();
      for (const r of await tx.query(`SELECT id, estabelecimento_id, ${col} AS k FROM ${tabela} WHERE empresa_id = $1 AND ativo`, [empresaId])) {
        if (!m.has(r.estabelecimento_id)) m.set(r.estabelecimento_id, new Map());
        m.get(r.estabelecimento_id)!.set(chaveNome(r.k), { id: r.id, estab: r.estabelecimento_id });
      }
      return m;
    };
    const simples = async (tabela: string) =>
      new Map((await tx.query(`SELECT id, nome FROM ${tabela} WHERE empresa_id = $1 AND ativo`, [empresaId])).map((r) => [chaveNome(r.nome), { id: r.id as string }]));
    return {
      estab: (v: string): string | null => {
        if (!v) return null;
        const d = somenteDigitos(v);
        const porInsc = d.length >= 12 ? ests.find((e) => e.inscricao === d) : undefined;
        const porNome = ests.filter((e) => chaveNome(e.nome) === chaveNome(v));
        return porInsc?.id ?? (porNome.length === 1 ? porNome[0].id : null);
      },
      setores: await porEstab('setor', 'nome'),
      ghes: await porEstab('ghe', 'codigo'),
      cargos: await simples('cargo'),
      funcoes: await simples('funcao'),
      matriculas: new Set((await tx.query('SELECT matricula FROM vinculo WHERE empresa_id = $1', [empresaId])).map((r) => r.matricula as string)),
      cpfsAtivos: new Set(
        (await tx.query(
          `SELECT f.cpf FROM vinculo v JOIN funcionario f ON f.id = v.funcionario_id
            WHERE v.empresa_id = $1 AND (v.data_desligamento IS NULL OR v.data_desligamento >= current_date)`,
          [empresaId],
        )).map((r) => r.cpf as string),
      ),
    };
  }

  /** Grava as linhas válidas da prévia. Tudo numa transação: ou entram todas, ou nenhuma. */
  async confirmar(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(`importacao:${id}`), async (tx) => {
      const imp = await tx.one('SELECT * FROM importacao WHERE id = $1 FOR UPDATE', [id]);
      if (!imp) throw new NotFoundException({ mensagem: 'Importação não encontrada' });
      u.exigir('funcionarios.importar', imp.empresa_id);
      if (imp.situacao !== 'pre_visualizada') throw new UnprocessableEntityException({ mensagem: 'Esta importação já foi concluída ou descartada' });
      const linhas = imp.linhas as { linha: number; dados: AdmissaoInput }[];
      if (!linhas.length) throw new UnprocessableEntityException({ mensagem: 'Não há linhas válidas para gravar' });
      for (const l of linhas) {
        try {
          await this.funcionarios.admitir(u, imp.empresa_id, l.dados, tx);
        } catch (e: any) {
          const msg = e?.response?.mensagem ?? (e?.code === '23505' ? 'registro duplicado' : e?.message);
          throw new UnprocessableEntityException({ mensagem: `Linha ${l.linha}: ${msg}. Nada foi gravado; gere uma nova prévia.` });
        }
      }
      await tx.query(`UPDATE importacao SET situacao = 'confirmada', confirmada_em = now(), linhas = '[]' WHERE id = $1`, [id]);
      return { gravados: linhas.length };
    });
  }

  async descartar(u: Usuario, id: string) {
    await this.banco.tx(u.ctx(), async (tx) => {
      const imp = await tx.one('SELECT empresa_id, situacao FROM importacao WHERE id = $1', [id]);
      if (!imp) throw new NotFoundException({ mensagem: 'Importação não encontrada' });
      u.exigir('funcionarios.importar', imp.empresa_id);
      if (imp.situacao === 'pre_visualizada')
        await tx.query(`UPDATE importacao SET situacao = 'descartada', linhas = '[]' WHERE id = $1`, [id]);
    });
  }

  listar(u: Usuario, empresaId: string) {
    return this.banco.tx(u.ctx(), (tx) =>
      tx.query(
        `SELECT i.id, i.arquivo_nome AS "arquivoNome", i.situacao, i.total_linhas AS "totalLinhas",
                i.linhas_validas AS "linhasValidas", jsonb_array_length(i.erros) AS "linhasComErro",
                i.criado_em AS "criadoEm", i.confirmada_em AS "confirmadaEm", us.nome AS usuario
           FROM importacao i LEFT JOIN usuario us ON us.id = i.criado_por
          WHERE i.empresa_id = $1 ORDER BY i.criado_em DESC LIMIT 100`,
        [empresaId],
      ),
    );
  }
}

function rotuloCampo(c: string) {
  const m: Record<string, string> = {
    'pessoa.nome': 'Nome', 'pessoa.cpf': 'CPF', 'pessoa.dataNascimento': 'Data de nascimento', 'pessoa.sexo': 'Sexo',
    'pessoa.email': 'E-mail', 'pessoa.telefone': 'Telefone', matricula: 'Matrícula', categoria: 'Categoria',
    tipoContrato: 'Tipo de contrato', jornada: 'Jornada',
  };
  return m[c] ?? c;
}
