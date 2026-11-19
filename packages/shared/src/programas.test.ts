import { describe, expect, it } from 'vitest';
import { BIBLIOTECA_DOCUMENTOS, documentoTipoSchema, somarMesesIso, situacaoDocumento, versaoSchema, type EntradaSituacao } from './programas';

const HOJE = '2026-06-15';
const base: EntradaSituacao = {
  aplicabilidade: 'aplicavel', substituidoEm: null, mudancaCondicoesEm: null, mudancaCondicoesMotivo: null,
  monitoramentoMeses: null, ultimoAcompanhamento: null, temRascunho: false,
  vigente: { dataEmissao: '2025-06-01', dataRevisao: '2027-06-01', dataVencimento: null, dataReavaliacao: null },
};
const sit = (e: Partial<EntradaSituacao>, vig?: Partial<NonNullable<EntradaSituacao['vigente']>>) =>
  situacaoDocumento({ ...base, ...e, vigente: e.vigente === null ? null : { ...base.vigente!, ...vig } }, HOJE, 90);

describe('datas', () => {
  it('soma meses respeitando o fim do mês', () => {
    expect(somarMesesIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMesesIso('2024-01-31', 1)).toBe('2024-02-29');
    expect(somarMesesIso('2025-06-01', 24)).toBe('2027-06-01');
    expect(somarMesesIso('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('situação do documento', () => {
  it('distingue os prazos e não inventa validade quando não há regra', () => {
    const r = sit({}, { dataRevisao: null });
    expect(r.situacao).toBe('regular');
    expect(r.prazos).toEqual([]);
  });

  it('regular, próximo da revisão e vencido pela revisão legal', () => {
    expect(sit({}).situacao).toBe('regular');
    expect(sit({}, { dataRevisao: '2026-08-01' }).situacao).toBe('proximo_revisao');
    const v = sit({}, { dataRevisao: '2026-06-01' });
    expect(v.situacao).toBe('vencido');
    expect(v.motivos[0]).toMatch(/revisão venceu em 01\/06\/2026/);
  });

  it('vencimento expresso tem situação própria', () => {
    expect(sit({}, { dataVencimento: '2026-07-01' }).situacao).toBe('proximo_vencimento');
    expect(sit({}, { dataVencimento: '2026-06-14' }).situacao).toBe('vencido');
  });

  it('mudança de condições, acompanhamento e reavaliação interna atrasados deixam pendente', () => {
    expect(sit({ mudancaCondicoesEm: '2026-05-01', mudancaCondicoesMotivo: 'Nova linha de produção' }).situacao).toBe('pendente');
    // Acompanhamento anual contado da emissão (2025-06-01) e depois do último registro.
    expect(sit({ monitoramentoMeses: 12 }).situacao).toBe('pendente');
    expect(sit({ monitoramentoMeses: 12, ultimoAcompanhamento: '2026-06-10' }).situacao).toBe('regular');
    expect(sit({ monitoramentoMeses: 12, ultimoAcompanhamento: '2025-08-01' }).situacao).toBe('proximo_revisao');
    expect(sit({}, { dataReavaliacao: '2026-01-01' }).situacao).toBe('pendente');
  });

  it('sem versão, em elaboração, em revisão, substituído e não aplicável', () => {
    expect(sit({ vigente: null }).situacao).toBe('pendente');
    expect(sit({ vigente: null, temRascunho: true }).situacao).toBe('em_elaboracao');
    expect(sit({ temRascunho: true }).situacao).toBe('em_revisao');
    // Vencido continua aparecendo como vencido mesmo com revisão em andamento.
    expect(sit({ temRascunho: true }, { dataRevisao: '2026-01-01' }).situacao).toBe('vencido');
    expect(sit({ substituidoEm: '2026-01-01' }).situacao).toBe('substituido');
    expect(sit({ aplicabilidade: 'nao_aplicavel' }).situacao).toBe('nao_aplicavel');
    expect(sit({ aplicabilidade: 'a_avaliar' }).motivos[0]).toMatch(/Aplicabilidade/);
  });
});

describe('biblioteca e validação', () => {
  it('a biblioteca só traz prazos fixados pela norma e passa na validação dos tipos', () => {
    for (const t of BIBLIOTECA_DOCUMENTOS) expect(documentoTipoSchema.safeParse(t).success).toBe(true);
    const comPrazo = BIBLIOTECA_DOCUMENTOS.filter((t) => t.prazoRevisaoMeses || t.vencimentoMeses || t.monitoramentoMeses).map((t) => t.sigla);
    expect(comPrazo.sort()).toEqual(['CIPA', 'PCMSO', 'PGR']);
  });

  it('datas da versão precisam ser depois da emissão', () => {
    expect(versaoSchema.safeParse({ dataEmissao: '2026-01-01', dataRevisao: '2025-12-01' }).success).toBe(false);
    expect(versaoSchema.safeParse({ dataEmissao: '2026-01-01', dataRevisao: '2028-01-01' }).success).toBe(true);
  });
});
