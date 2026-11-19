import { describe, expect, it } from 'vitest';
import { agenteNocivoSchema, idEvento, inscricaoEmpregador, prazoEvento, problemasAgente, problemasConjuntoAgentes } from './esocial';

describe('identificação do evento', () => {
  it('monta o Id com 36 caracteres e raiz do CNPJ completada com zeros', () => {
    const id = idEvento(1, '12345678', new Date(2026, 10, 19, 8, 5, 9), 42);
    expect(id).toBe('ID1123456780000002026111908050900042');
    expect(id).toHaveLength(36);
  });
  it('usa a raiz do CNPJ, salvo órgão público da administração direta', () => {
    expect(inscricaoEmpregador(1, '12345678000195', '2062')).toBe('12345678');
    expect(inscricaoEmpregador(1, '12345678000195', '1031')).toBe('12345678000195');
    expect(inscricaoEmpregador(2, '529.982.247-25')).toBe('52998224725');
  });
});

describe('prazos', () => {
  it('S-2220/S-2240 até o dia 15 do mês seguinte; S-2210 no primeiro dia útil', () => {
    expect(prazoEvento('S-2220', '2026-12-03')).toBe('2027-01-15');
    expect(prazoEvento('S-2240', '2026-11-30')).toBe('2026-12-15');
    expect(prazoEvento('S-2210', '2026-11-20')).toBe('2026-11-23'); // sexta -> segunda
    expect(prazoEvento('S-2210', '2026-11-20', true)).toBe('2026-11-20');
  });
});

describe('agentes nocivos (S-2240)', () => {
  const base = { codigo: '02.01.001', descricao: null, tpAval: 1 as const, intConc: 85, limTol: null, unMed: 4, tecMedicao: 'NHO 01', nrProcJud: null,
    utilizEpc: 0 as const, eficEpc: null, utilizEpi: 0 as const, eficEpi: null, epis: [], epiCompl: null, inicio: '2026-01-01', fim: null };
  it('aceita ruído quantitativo completo', () => expect(problemasAgente(base)).toEqual([]));
  it('quantitativo exige intensidade, unidade e técnica', () => {
    expect(problemasAgente({ ...base, intConc: null, unMed: null, tecMedicao: null }).map((p) => p.campo)).toEqual(['intConc', 'unMed', 'tecMedicao']);
  });
  it('EPI utilizado exige CA, eficácia e requisitos da NR-06', () => {
    expect(problemasAgente({ ...base, utilizEpi: 2 }).map((p) => p.campo).sort()).toEqual(['eficEpi', 'epiCompl', 'epis']);
  });
  it('09.01.001 não vem com outros agentes nem com avaliação', () => {
    expect(problemasConjuntoAgentes(['09.01.001', '02.01.001'])).toMatch(/não pode vir junto/);
    expect(problemasAgente({ ...base, codigo: '09.01.001', tpAval: null, intConc: null, unMed: null, tecMedicao: null, utilizEpc: null, utilizEpi: null })).toEqual([]);
    expect(agenteNocivoSchema.safeParse({ gheId: '00000000-0000-4000-8000-000000000000', codigo: '01.01.001', tpAval: 2, utilizEpc: 0, utilizEpi: 0, inicio: '2026-01-01' }).success).toBe(false);
  });
});
