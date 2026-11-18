import { formatarCnpj, formatarCpf, ORDENS_EXAME, RESULTADOS_ASO, TIPOS_ASO, TIPOS_TURMA, MODALIDADES_TURMA } from '@sst/shared';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

/**
 * Documentos em PDF gerados no próprio computador (sem internet).
 * Usa as fontes padrão do PDF (codificação WinAnsi, que cobre o português).
 */

const A4: [number, number] = [595.28, 841.89];
const MARGEM = 48;
const COR_TEXTO = rgb(0.11, 0.15, 0.2);
const COR_SUAVE = rgb(0.4, 0.45, 0.52);
const COR_LINHA = rgb(0.8, 0.83, 0.87);

const dataBr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '—');
const inscricao = (tipo: number, v: string) => (tipo === 1 ? `CNPJ ${formatarCnpj(v)}` : `CPF ${formatarCpf(v)}`);

/** Caracteres além do Latin-1 que a codificação WinAnsi das fontes padrão também desenha. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Remove caracteres que a fonte padrão não desenha (ex.: emoji). */
const limpo = (t: unknown) =>
  [...String(t ?? '')].filter((c) => /[\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/.test(c) || WIN_ANSI_EXTRA.includes(c)).join('');

class Escritor {
  y: number;
  constructor(readonly doc: PDFDocument, public page: PDFPage, readonly normal: PDFFont, readonly negrito: PDFFont) {
    this.y = A4[1] - MARGEM;
  }

  get largura() {
    return A4[0] - 2 * MARGEM;
  }

  private garantir(altura: number) {
    if (this.y - altura < MARGEM) {
      this.page = this.doc.addPage(A4);
      this.y = A4[1] - MARGEM;
    }
  }

  quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
    const linhas: string[] = [];
    for (const par of limpo(texto).split(/\r?\n/)) {
      let atual = '';
      for (const p of par.split(/\s+/)) {
        const t = atual ? `${atual} ${p}` : p;
        if (fonte.widthOfTextAtSize(t, tamanho) > largura && atual) {
          linhas.push(atual);
          atual = p;
        } else atual = t;
      }
      linhas.push(atual);
    }
    return linhas;
  }

  texto(t: string, o: { tamanho?: number; negrito?: boolean; cor?: ReturnType<typeof rgb>; x?: number; largura?: number; centro?: boolean } = {}) {
    const tam = o.tamanho ?? 10;
    const f = o.negrito ? this.negrito : this.normal;
    const larg = o.largura ?? this.largura;
    for (const l of this.quebrar(t, f, tam, larg)) {
      this.garantir(tam * 1.4);
      const x = o.centro ? (A4[0] - f.widthOfTextAtSize(l, tam)) / 2 : o.x ?? MARGEM;
      this.page.drawText(l, { x, y: this.y - tam, size: tam, font: f, color: o.cor ?? COR_TEXTO });
      this.y -= tam * 1.4;
    }
  }

  espaco(n = 8) {
    this.y -= n;
  }

  linha() {
    this.garantir(10);
    this.page.drawLine({ start: { x: MARGEM, y: this.y }, end: { x: A4[0] - MARGEM, y: this.y }, thickness: 0.6, color: COR_LINHA });
    this.y -= 10;
  }

  secao(titulo: string) {
    this.espaco(6);
    this.texto(titulo.toUpperCase(), { tamanho: 9, negrito: true, cor: COR_SUAVE });
    this.linha();
  }

  /** Pares rótulo/valor em duas colunas. */
  campos(pares: [string, unknown][]) {
    const col = this.largura / 2;
    for (let i = 0; i < pares.length; i += 2) {
      const yIni = this.y;
      let yMin = yIni;
      pares.slice(i, i + 2).forEach(([r, v], j) => {
        this.y = yIni;
        this.texto(r, { tamanho: 8, cor: COR_SUAVE, x: MARGEM + j * col, largura: col - 10 });
        this.texto(String(v ?? '—') || '—', { tamanho: 10, x: MARGEM + j * col, largura: col - 10 });
        yMin = Math.min(yMin, this.y);
      });
      this.y = yMin - 4;
    }
  }

  assinatura(rotulo: string, x: number, largura: number) {
    this.page.drawLine({ start: { x, y: this.y }, end: { x: x + largura, y: this.y }, thickness: 0.6, color: COR_TEXTO });
    const linhas = this.quebrar(rotulo, this.normal, 8, largura);
    linhas.forEach((l, i) =>
      this.page.drawText(l, { x: x + (largura - this.normal.widthOfTextAtSize(l, 8)) / 2, y: this.y - 11 - i * 10, size: 8, font: this.normal, color: COR_SUAVE }),
    );
  }

  rodape(texto: string) {
    for (const p of this.doc.getPages())
      p.drawText(limpo(texto), { x: MARGEM, y: 24, size: 7, font: this.normal, color: COR_SUAVE });
  }
}

async function novo(titulo: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(limpo(titulo));
  doc.setProducer('Controle SST');
  doc.setCreator('Controle SST');
  const w = new Escritor(doc, doc.addPage(A4), await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  return w;
}

/** ASO conforme os itens exigidos pela NR-7. */
export async function pdfAso(a: any): Promise<Buffer> {
  const w = await novo(`ASO - ${a.funcionarioNome}`);
  w.texto('ATESTADO DE SAÚDE OCUPACIONAL', { tamanho: 15, negrito: true, centro: true });
  w.texto(`${TIPOS_ASO[a.tipo as keyof typeof TIPOS_ASO]}${a.situacao === 'cancelado' ? ' · CANCELADO' : ''}`, { tamanho: 11, centro: true, cor: COR_SUAVE });
  w.espaco(6);

  w.secao('Empresa');
  w.campos([['Razão social', a.empresaNome], ['Inscrição', inscricao(a.empresaTipoInscricao, a.empresaInscricao)]]);

  w.secao('Empregado');
  w.campos([
    ['Nome', a.funcionarioNome], ['CPF', formatarCpf(a.funcionarioCpf)],
    ['Função', a.funcao ?? a.cargo ?? '—'], ['Setor', a.setor ?? '—'],
    ['Matrícula', a.matricula],
  ]);

  w.secao('Perigos ou fatores de risco ocupacionais (PGR)');
  w.texto(a.riscos || 'Não informados neste ASO.');

  w.secao('Exames realizados');
  w.campos([['Exame clínico', dataBr(a.dataExame)]]);
  if (a.exames?.length) {
    for (const e of a.exames)
      w.texto(`• ${e.nome}${e.codigoEsocial ? ` (${e.codigoEsocial})` : ''} — ${dataBr(e.dataRealizacao)}${e.ordem ? ` · ${ORDENS_EXAME[e.ordem as 1 | 2]}` : ''}`);
  } else w.texto('Sem exames complementares.');

  w.secao('Conclusão');
  w.texto(`${RESULTADOS_ASO[a.resultado as 1 | 2].toUpperCase()} para a função`, { tamanho: 14, negrito: true });
  if (a.vencimento) w.texto(`Próximo exame até ${dataBr(a.vencimento)}`, { cor: COR_SUAVE });
  if (a.observacoes) {
    w.espaco(4);
    w.texto(a.observacoes);
  }

  w.secao('Médicos');
  w.campos([
    ['Médico coordenador do PCMSO', a.coordenadorNome ? `${a.coordenadorNome} · CRM ${a.coordenadorCrm}/${a.coordenadorUfCrm}` : 'Não definido para a data do exame'],
    ['Médico examinador', `${a.medicoNome} · CRM ${a.medicoCrm}/${a.medicoUfCrm}`],
    ['Clínica', a.clinicaNome ?? '—'], ['Data', dataBr(a.dataExame)],
  ]);

  w.espaco(48);
  const larg = (w.largura - 40) / 2;
  w.assinatura(`${a.medicoNome} · CRM ${a.medicoCrm}/${a.medicoUfCrm}`, 48, larg);
  w.assinatura(`${a.funcionarioNome} (ciente)`, 48 + larg + 40, larg);
  w.rodape(`Controle SST · ASO ${a.id}`);
  return Buffer.from(await w.doc.save());
}

/** Certificado de treinamento com os itens da NR-1 (1.7). */
export async function pdfCertificado(c: any): Promise<Buffer> {
  const w = await novo(`Certificado - ${c.funcionarioNome}`);
  w.espaco(10);
  w.texto('CERTIFICADO', { tamanho: 22, negrito: true, centro: true });
  w.espaco(10);
  w.texto(
    `Certificamos que ${c.funcionarioNome}, CPF ${formatarCpf(c.funcionarioCpf)}, empregado(a) de ${c.empresaNome} ` +
      `(${inscricao(c.empresaTipoInscricao, c.empresaInscricao)}), concluiu com aproveitamento o treinamento ` +
      `${c.treinamentoNome}${c.norma ? ` (${c.norma})` : ''}, com carga horária de ${String(c.cargaHoraria).replace('.', ',')} horas, ` +
      `realizado de ${dataBr(c.dataInicio)} a ${dataBr(c.dataFim)}${c.local ? `, em ${c.local}` : ''}.`,
    { tamanho: 11 },
  );
  w.espaco(6);
  w.campos([
    ['Tipo', TIPOS_TURMA[c.tipo as keyof typeof TIPOS_TURMA]], ['Modalidade', MODALIDADES_TURMA[c.modalidade as keyof typeof MODALIDADES_TURMA]],
    ['Validade', c.validade ? `até ${dataBr(c.validade)}` : 'Sem reciclagem periódica definida'], ['Código de verificação', c.codigo],
  ]);

  w.secao('Instrutor(es)');
  w.texto(`${c.instrutorNome}${c.instrutorQualificacao ? ` — ${c.instrutorQualificacao}` : ''}`);
  if (c.responsavelTecnico) {
    w.secao('Responsável técnico');
    w.texto(c.responsavelTecnico);
  }

  w.secao('Conteúdo programático');
  w.texto(c.conteudoProgramatico || 'Conforme cadastrado no treinamento.', { tamanho: 9 });

  w.espaco(56);
  const larg = (w.largura - 40) / 3;
  w.assinatura(`${c.funcionarioNome} (trabalhador)`, 48, larg);
  w.assinatura(`${c.instrutorNome} (instrutor)`, 48 + larg + 20, larg);
  w.assinatura(`${c.responsavelTecnico ?? 'Responsável técnico'}`, 48 + 2 * (larg + 20), larg);
  w.rodape(`Controle SST · Certificado ${c.codigo}`);
  return Buffer.from(await w.doc.save());
}
