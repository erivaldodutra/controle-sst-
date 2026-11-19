import { describe, expect, it } from 'vitest';
import {
  acaoSchema, classificarEmpresa, conformidadeSchema, percentualConformidade, prazoAcao, situacaoConformidade, sugerirAplicabilidade,
} from './acoes';

describe('ações', () => {
  const base = {
    empresaId: '00000000-0000-4000-8000-000000000001', origem: 'pgr', descricao: 'Instalar proteção na prensa', tipo: 'introduzir',
    prioridade: 'alta', responsavelNome: 'Ana', dataAbertura: '2026-11-01', prazo: '2026-12-01',
  };

  it('exige justificativa quando dispensa evidência e prazo depois da abertura', () => {
    expect(acaoSchema.safeParse(base).success).toBe(true);
    expect(acaoSchema.safeParse({ ...base, exigeEvidencia: false }).success).toBe(false);
    expect(acaoSchema.safeParse({ ...base, exigeEvidencia: false, dispensaJustificativa: 'Ação administrativa' }).success).toBe(true);
    expect(acaoSchema.safeParse({ ...base, prazo: '2026-10-01' }).success).toBe(false);
  });

  it('calcula atraso, proximidade e reprogramação', () => {
    expect(prazoAcao({ situacao: 'em_andamento', prazo: '2026-11-10', prazoInicial: '2026-11-10' }, '2026-11-19', 30))
      .toMatchObject({ estado: 'atrasado', atrasada: true, reprogramada: false, dias: -9 });
    expect(prazoAcao({ situacao: 'nao_iniciada', prazo: '2026-12-01', prazoInicial: '2026-11-10' }, '2026-11-19', 30))
      .toMatchObject({ estado: 'proximo', reprogramada: true });
    expect(prazoAcao({ situacao: 'concluida', prazo: '2026-11-10', prazoInicial: '2026-11-10' }, '2026-11-19', 30))
      .toMatchObject({ estado: 'encerrada', atrasada: false });
  });
});

describe('conformidade', () => {
  it('requisito com documento segue o pior documento; sem documento segue a avaliação', () => {
    const c = (documentos: any[], avaliacao: any = 'nao_avaliado', porDocumento = true) =>
      situacaoConformidade({ aplicabilidade: 'aplicavel', porDocumento, documentos, avaliacao }).situacao;
    expect(c([])).toBe('nao_conforme');
    expect(c(['regular'])).toBe('conforme');
    expect(c(['regular', 'vencido'])).toBe('nao_conforme');
    expect(c(['substituido', 'em_revisao'])).toBe('conforme');
    expect(c(['em_elaboracao'])).toBe('nao_conforme');
    expect(situacaoConformidade({ aplicabilidade: 'aplicavel', porDocumento: true, documentos: ['proximo_vencimento'], avaliacao: 'nao_avaliado' }).proximo)
      .toBe(true);
    expect(c([], 'parcial', false)).toBe('parcial');
    expect(situacaoConformidade({ aplicabilidade: 'nao_aplicavel', porDocumento: true, documentos: [], avaliacao: 'nao_avaliado' }).situacao)
      .toBe('nao_aplicavel');
    expect(situacaoConformidade({ aplicabilidade: 'a_avaliar', porDocumento: false, documentos: [], avaliacao: 'conforme' }).situacao)
      .toBe('a_avaliar');
  });

  it('percentual conta só aplicáveis avaliados', () => {
    expect(percentualConformidade(['conforme', 'nao_conforme', 'a_avaliar', 'nao_aplicavel', 'nao_avaliado'])).toBe(50);
    expect(percentualConformidade(['conforme', 'parcial'])).toBe(75);
    expect(percentualConformidade(['a_avaliar'])).toBeNull();
  });

  it('não aplicável exige justificativa; avaliação exige data', () => {
    const b = { empresaId: '00000000-0000-4000-8000-000000000001', requisitoId: '00000000-0000-4000-8000-000000000002' };
    expect(conformidadeSchema.safeParse({ ...b, aplicabilidade: 'nao_aplicavel' }).success).toBe(false);
    expect(conformidadeSchema.safeParse({ ...b, aplicabilidade: 'aplicavel', avaliacao: 'conforme' }).success).toBe(false);
    expect(conformidadeSchema.safeParse({ ...b, aplicabilidade: 'aplicavel', avaliacao: 'conforme', avaliacaoEm: '2026-11-19' }).success).toBe(true);
  });

  it('sugestão de aplicabilidade só quando há critérios, e todos precisam bater', () => {
    const r = { sugestaoGrausRisco: [3, 4], sugestaoCnaePrefixos: ['41'], sugestaoMinEmpregados: 20 };
    expect(sugerirAplicabilidade(r, { grauRisco: 3, cnaes: ['4120400'], empregados: 25 })?.sugere).toBe(true);
    expect(sugerirAplicabilidade(r, { grauRisco: 3, cnaes: ['4120400'], empregados: 5 })?.sugere).toBe(false);
    expect(sugerirAplicabilidade(r, { grauRisco: 2, cnaes: ['4120400'], empregados: 25 })?.sugere).toBe(false);
    expect(sugerirAplicabilidade({ sugestaoGrausRisco: [], sugestaoCnaePrefixos: [], sugestaoMinEmpregados: null },
      { grauRisco: 3, cnaes: [], empregados: 1 })).toBeNull();
  });

  it('classifica a empresa pela pior condição', () => {
    const z = { documentosVencidos: 0, acoesAtrasadas: 0, naoConformes: 0, parciais: 0, aAvaliar: 0, naoAvaliados: 0,
      documentosPendentes: 0, documentosProximos: 0, acoesProximas: 0 };
    expect(classificarEmpresa(z)).toBe('regular');
    expect(classificarEmpresa({ ...z, acoesProximas: 1 })).toBe('prazos_proximos');
    expect(classificarEmpresa({ ...z, acoesProximas: 1, naoConformes: 1 })).toBe('com_pendencias');
    expect(classificarEmpresa({ ...z, naoConformes: 1, acoesAtrasadas: 1 })).toBe('com_vencidos');
  });
});
