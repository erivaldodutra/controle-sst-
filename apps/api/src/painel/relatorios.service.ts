import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  APLICABILIDADES, CATEGORIAS_ALERTA, filtroRelatorioSchema, GRAVIDADES, ORIGENS_ACAO, PRIORIDADES, RELATORIOS, SITUACOES_ACAO,
  SITUACOES_CONFORMIDADE, SITUACOES_DOCUMENTO, SITUACOES_EVENTO, SITUACOES_OCORRENCIA, TIPOS_OCORRENCIA, TIPOS_PRAZO,
  type TipoRelatorio,
} from '@sst/shared';
import { AcoesService } from '../acoes/acoes.service';
import { ConformidadeService } from '../acoes/conformidade.service';
import { InspecoesService } from '../acoes/inspecoes.service';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco } from '../db/banco';
import { DocumentosService } from '../documentos/documentos.service';
import { EsocialService } from '../esocial/esocial.service';
import { FuncionariosService } from '../funcionarios/funcionarios.service';
import { pdfTabela, type Tabela } from '../pdf/pdf';
import { VencimentosService } from '../saude/vencimentos.service';
import { CalendarioService } from './calendario.service';

const iso = (v: unknown) => (v == null || v === '' ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const br = (v: unknown) => { const d = iso(v); return d ? d.split('-').reverse().join('/') : ''; };
const rotulo = (m: Record<string, string>, v: unknown) => (v == null ? '' : m[String(v)] ?? String(v));
const cpf = (v?: string | null) => (v && v.length === 11 ? `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}` : v ?? '');

const SITUACAO_VENCIMENTO: Record<string, string> = {
  sem_aso: 'Sem ASO', sem_vencimento: 'Sem vencimento', vencido: 'Vencido', vencendo: 'Vencendo', em_dia: 'Em dia', pendente: 'Pendente',
};
const SITUACAO_VINCULO: Record<string, string> = { ativo: 'Ativo', afastado: 'Afastado', desligado: 'Desligado' };
const ESTADO_PRAZO: Record<string, string> = { atrasado: 'Atrasado', proximo: 'Próximo', futuro: 'Futuro', em_dia: 'Em dia', encerrada: 'Encerrada' };

type Coluna = { titulo: string; peso: number };
type Montado = { colunas: Coluna[]; linhas: string[][]; nota?: string };

/**
 * Central de relatórios: cada relatório lê o mesmo serviço que a tela correspondente
 * (com as mesmas permissões) e sai em PDF ou Excel, gerados no próprio computador.
 * Nenhum relatório traz resultado de exame, CID ou outro dado clínico.
 */
@Injectable()
export class RelatoriosService {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    private readonly funcionarios: FuncionariosService,
    private readonly vencimentos: VencimentosService,
    private readonly documentos: DocumentosService,
    private readonly acoes: AcoesService,
    private readonly inspecoes: InspecoesService,
    private readonly conformidade: ConformidadeService,
    private readonly esocial: EsocialService,
    private readonly calendario: CalendarioService,
  ) {}

  /** Catálogo com os relatórios que o usuário pode gerar. */
  catalogo(u: Usuario) {
    return Object.entries(RELATORIOS).map(([tipo, r]) => ({ tipo, ...r, disponivel: u.pode(r.permissao) }));
  }

  async gerar(u: Usuario, tipo: TipoRelatorio, corpo: unknown): Promise<{ nome: string; mime: string; conteudo: Buffer }> {
    const f = validar(filtroRelatorioSchema, corpo);
    const def = RELATORIOS[tipo];
    if (!u.pode(def.permissao, f.empresaId)) throw new ForbiddenException({ mensagem: 'Sem permissão para este relatório' });
    const { hoje, empresa } = await this.banco.tx(u.ctx(), async (tx) => ({
      hoje: (await tx.one('SELECT current_date::text AS d'))!.d as string,
      empresa: f.empresaId ? ((await tx.one('SELECT razao_social AS r FROM empresa WHERE id = $1', [f.empresaId]))?.r as string | undefined) : undefined,
    }));
    if (f.empresaId && !empresa) throw new ForbiddenException({ mensagem: 'Empresa não encontrada' });
    const m = await this.montar(u, tipo, f, hoje);
    const varias = !f.empresaId;
    // A coluna "Empresa" só aparece quando o relatório junta várias empresas.
    const colunas = varias ? m.colunas : m.colunas.slice(1);
    const linhas = varias ? m.linhas : m.linhas.map((l) => l.slice(1));
    const periodo = f.de || f.ate ? ` · período ${f.de ? br(f.de) : 'início'} a ${f.ate ? br(f.ate) : 'hoje'}` : '';
    const subtitulo = `${empresa ?? 'Todas as empresas que você pode ver'}${periodo} · ${linhas.length} registro(s) · emitido em ${br(hoje)} por ${u.nome}${m.nota ? ` · ${m.nota}` : ''}`;
    const nomeBase = `${def.nome} ${hoje}`.replace(/[\\/:*?"<>|]/g, '-');
    if (f.formato === 'pdf') {
      const t: Tabela = { titulo: def.nome, subtitulo, colunas, linhas, rodape: `Controle SST · ${def.nome}` };
      return { nome: `${nomeBase}.pdf`, mime: 'application/pdf', conteudo: await pdfTabela(t) };
    }
    return {
      nome: `${nomeBase}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      conteudo: await this.xlsx(def.nome, subtitulo, colunas, linhas),
    };
  }

  private async xlsx(titulo: string, subtitulo: string, colunas: Coluna[], linhas: string[][]) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Controle SST';
    const ws = wb.addWorksheet(titulo.slice(0, 31));
    ws.addRow([titulo]).font = { bold: true, size: 14 };
    ws.addRow([subtitulo]).font = { color: { argb: 'FF64748B' } };
    ws.addRow([]);
    const cab = ws.addRow(colunas.map((c) => c.titulo));
    cab.font = { bold: true };
    cab.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; });
    for (const l of linhas) {
      // Datas dd/mm/aaaa viram data de verdade na planilha (filtram e ordenam certo).
      ws.addRow(l.map((v) => {
        const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
        return d ? new Date(Date.UTC(+d[3]!, +d[2]! - 1, +d[1]!)) : v;
      }));
    }
    colunas.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(60, Math.max(10, c.peso * 7));
    });
    ws.eachRow((r, n) => { if (n > 4) r.eachCell((c) => { if (c.value instanceof Date) c.numFmt = 'dd/mm/yyyy'; }); });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: colunas.length } };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private noPeriodo(data: string, f: { de?: string; ate?: string }) {
    const d = iso(data);
    return (!f.de || d >= f.de) && (!f.ate || d <= f.ate);
  }

  private async montar(u: Usuario, tipo: TipoRelatorio, f: { empresaId?: string; de?: string; ate?: string }, hoje: string): Promise<Montado> {
    const E = { titulo: 'Empresa', peso: 3 };
    switch (tipo) {
      case 'funcionarios': {
        const r = await this.funcionarios.listar(u, { empresaId: f.empresaId, pagina: 1, limite: 100000 } as any);
        const empresas = await this.nomesEmpresas(u);
        return {
          colunas: [E, { titulo: 'Nome', peso: 3.5 }, { titulo: 'CPF', peso: 1.8 }, { titulo: 'Matrícula', peso: 1.3 }, { titulo: 'Admissão', peso: 1.3 },
            { titulo: 'Situação', peso: 1.2 }, { titulo: 'Estabelecimento', peso: 2.5 }, { titulo: 'Setor', peso: 2 }, { titulo: 'Função', peso: 2.2 },
            { titulo: 'CBO', peso: 1 }, { titulo: 'GHE', peso: 1 }],
          linhas: r.itens.map((x: any) => [empresas.get(x.empresaId) ?? '', x.nome, cpf(x.cpf), x.matricula, br(x.dataAdmissao),
            rotulo(SITUACAO_VINCULO, x.situacao), x.estabelecimento ?? '', x.setor ?? '', x.funcao ?? x.cargo ?? '', x.cbo ?? '', x.ghe ?? '']),
        };
      }
      case 'aso':
      case 'treinamentos': {
        const r = await this.vencimentos.listar(u, { empresaId: f.empresaId, tipo: tipo === 'aso' ? 'aso' : 'treinamento', incluirEmDia: true });
        return {
          colunas: [E, { titulo: 'Trabalhador', peso: 3.5 }, { titulo: 'Matrícula', peso: 1.3 },
            ...(tipo === 'treinamentos' ? [{ titulo: 'Treinamento', peso: 3.5 }] : []),
            { titulo: 'Vencimento', peso: 1.3 }, { titulo: 'Dias', peso: 0.8 }, { titulo: 'Situação', peso: 1.4 }],
          linhas: r.itens.map((x: any) => [x.empresa, x.funcionarioNome, x.matricula, ...(tipo === 'treinamentos' ? [x.descricao] : []),
            br(x.vencimento), x.diasParaVencer == null ? '' : String(x.diasParaVencer), rotulo(SITUACAO_VENCIMENTO, x.situacao)]),
          nota: 'vínculos ativos e afastados',
        };
      }
      case 'documentos': {
        const r = await this.documentos.listar(u, { empresaId: f.empresaId });
        return {
          colunas: [E, { titulo: 'Documento', peso: 2.5 }, { titulo: 'Identificação', peso: 2.5 }, { titulo: 'Estabelecimento', peso: 2.2 },
            { titulo: 'Versão vigente', peso: 1.2 }, { titulo: 'Emissão', peso: 1.2 }, { titulo: 'Próximo prazo', peso: 2.4 },
            { titulo: 'Responsável', peso: 2 }, { titulo: 'Situação', peso: 1.6 }],
          linhas: (r.itens as any[]).map((d) => [d.empresaNome, d.tipoSigla ?? d.tipoNome, d.identificacao ?? '', d.estabelecimentoNome ?? 'Empresa toda',
            d.vigenteNumero ? `nº ${d.vigenteNumero}` : 'Sem versão vigente', br(d.vigenteEmissao),
            d.proximoPrazo ? `${TIPOS_PRAZO[d.proximoPrazo.tipo as keyof typeof TIPOS_PRAZO] ?? d.proximoPrazo.tipo} ${br(d.proximoPrazo.data)}` : '',
            d.vigenteResponsavel ?? '', rotulo(SITUACOES_DOCUMENTO, d.situacao)]),
        };
      }
      case 'acoes': {
        const r = await this.acoes.listar(u, { empresaId: f.empresaId });
        const itens = (r.itens as any[]).filter((a) => this.noPeriodo(a.dataAbertura, f));
        return {
          colunas: [E, { titulo: 'Código', peso: 1.2 }, { titulo: 'Descrição', peso: 5 }, { titulo: 'Origem', peso: 1.6 }, { titulo: 'Prioridade', peso: 1.1 },
            { titulo: 'Responsável', peso: 2 }, { titulo: 'Abertura', peso: 1.2 }, { titulo: 'Prazo', peso: 1.2 }, { titulo: 'Situação', peso: 1.6 },
            { titulo: 'Prazo (estado)', peso: 1.2 }],
          linhas: itens.map((a) => [a.empresaNome, a.codigo, a.descricao, rotulo(ORIGENS_ACAO, a.origem), rotulo(PRIORIDADES, a.prioridade),
            a.responsavelNome, br(a.dataAbertura), br(a.prazo), rotulo(SITUACOES_ACAO, a.situacao), rotulo(ESTADO_PRAZO, a.estado)]),
          nota: f.de || f.ate ? 'filtrado pela data de abertura' : undefined,
        };
      }
      case 'ocorrencias': {
        const r = await this.inspecoes.listarOcorrencias(u, { empresaId: f.empresaId });
        const itens = (r as any[]).filter((o) => this.noPeriodo(o.dataHora, f));
        return {
          colunas: [E, { titulo: 'Código', peso: 1.2 }, { titulo: 'Data e hora', peso: 1.6 }, { titulo: 'Tipo', peso: 2 }, { titulo: 'Gravidade', peso: 1.2 },
            { titulo: 'Afastamento', peso: 1.1 }, { titulo: 'Estabelecimento', peso: 2.2 }, { titulo: 'Setor', peso: 1.8 }, { titulo: 'Situação', peso: 1.4 },
            { titulo: 'Ações', peso: 0.8 }],
          linhas: itens.map((o) => [o.empresaNome, o.codigo, `${br(o.dataHora)} ${String(o.dataHora).slice(11, 16)}`, rotulo(TIPOS_OCORRENCIA, o.tipo),
            rotulo(GRAVIDADES, o.gravidade), o.houveAfastamento ? 'Sim' : 'Não', o.estabelecimentoNome, o.setorNome ?? '',
            rotulo(SITUACOES_OCORRENCIA, o.situacao), String(o.acoes)]),
          nota: 'sem nome do trabalhador, CID ou dados clínicos',
        };
      }
      case 'conformidade': {
        if (f.empresaId) {
          const m = await this.conformidade.matriz(u, f.empresaId, null);
          return {
            colunas: [E, { titulo: 'Requisito', peso: 5 }, { titulo: 'Fundamentação', peso: 2.5 }, { titulo: 'Aplicabilidade', peso: 1.4 },
              { titulo: 'Situação', peso: 1.6 }, { titulo: 'Avaliado em', peso: 1.2 }, { titulo: 'Responsável', peso: 2 }, { titulo: 'Ações abertas', peso: 1 }],
            linhas: m.itens.map((l: any) => [m.empresa.razaoSocial, l.requisito.titulo, l.requisito.fundamentacao ?? '', rotulo(APLICABILIDADES, l.aplicabilidade),
              rotulo(SITUACOES_CONFORMIDADE, l.situacao), br(l.conformidade?.avaliacaoEm), l.conformidade?.responsavelNome ?? '', String(l.acoesAbertas)]),
            nota: `${m.resumo.percentual ?? 0}% de conformidade`,
          };
        }
        const v = await this.conformidade.visaoEmpresas(u);
        return {
          colunas: [E, { titulo: '% conforme', peso: 1 }, { titulo: 'Conformes', peso: 1 }, { titulo: 'Aplicáveis', peso: 1 }, { titulo: 'Não conformes', peso: 1.1 },
            { titulo: 'A avaliar', peso: 1 }, { titulo: 'Docs. vencidos', peso: 1.1 }, { titulo: 'Docs. pendentes', peso: 1.1 },
            { titulo: 'Ações abertas', peso: 1.1 }, { titulo: 'Ações atrasadas', peso: 1.1 }],
          linhas: v.empresas.map((e: any) => [e.razaoSocial, `${e.percentual ?? 0}%`, String(e.conformes), String(e.aplicaveis), String(e.naoConformes),
            String(e.aAvaliar), String(e.documentosVencidos), String(e.documentosPendentes), String(e.acoesAbertas), String(e.acoesAtrasadas)]),
          nota: 'uma linha por empresa',
        };
      }
      case 'esocial': {
        const r = await this.esocial.listar(u, { empresaId: f.empresaId });
        const itens = (r as any[]).filter((e) => this.noPeriodo(e.referencia, f));
        return {
          colunas: [E, { titulo: 'Evento', peso: 1 }, { titulo: 'Trabalhador', peso: 3 }, { titulo: 'Matrícula', peso: 1.2 }, { titulo: 'Referência', peso: 1.2 },
            { titulo: 'Prazo legal', peso: 1.2 }, { titulo: 'Situação', peso: 1.8 }, { titulo: 'Recibo', peso: 2.4 }, { titulo: 'Processado em', peso: 1.3 }],
          linhas: itens.map((e) => [e.empresaNome, e.tipo, e.funcionarioNome ?? '', e.matricula ?? '', br(e.referencia), br(e.prazo),
            rotulo(SITUACOES_EVENTO, e.situacao), e.nrRecibo ?? '', br(e.processadoEm)]),
          nota: 'até 500 eventos mais recentes; sem CPF nem dados clínicos',
        };
      }
      case 'calendario': {
        const ate = f.ate ?? hoje;
        const c = await this.calendario.itens(u, { empresaId: f.empresaId, ate: f.ate });
        const itens = c.itens.filter((i) => (!f.de || i.data >= f.de) && (i.estado !== 'futuro' || i.data <= ate));
        return {
          colunas: [E, { titulo: 'Data', peso: 1.1 }, { titulo: 'Situação', peso: 1 }, { titulo: 'Categoria', peso: 1.4 }, { titulo: 'Obrigação', peso: 5 },
            { titulo: 'Detalhe', peso: 3 }],
          linhas: itens.map((i) => [i.empresa, br(i.data), rotulo(ESTADO_PRAZO, i.estado), CATEGORIAS_ALERTA[i.categoria], i.titulo, i.detalhe ?? '']),
          nota: f.ate ? undefined : `atrasados e próximos ${c.janela} dias`,
        };
      }
    }
  }

  private async nomesEmpresas(u: Usuario) {
    const r = await this.banco.tx(u.ctx(), (tx) => tx.query('SELECT id, razao_social AS r FROM empresa'));
    return new Map(r.map((e) => [e.id as string, e.r as string]));
  }
}
