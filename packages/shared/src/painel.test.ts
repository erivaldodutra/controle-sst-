import { describe, expect, it } from 'vitest';
import { anonimizar, estadoPrazo, iaConfigSchema } from './painel';

describe('painel', () => {
  it('classifica o prazo pela janela de alerta', () => {
    expect(estadoPrazo('2026-11-18', '2026-11-19', 30)).toEqual({ dias: -1, estado: 'atrasado' });
    expect(estadoPrazo('2026-12-19', '2026-11-19', 30)).toEqual({ dias: 30, estado: 'proximo' });
    expect(estadoPrazo('2026-12-20', '2026-11-19', 30)).toEqual({ dias: 31, estado: 'futuro' });
  });

  it('tira CPF, CNPJ, e-mail e números longos antes de enviar à IA', () => {
    const t = anonimizar('CPF 529.982.247-25 / 52998224725, CNPJ 11.222.333/0001-81, nis 12345678901, x@y.com.br, código 0281 e recibo ok');
    expect(t).not.toMatch(/529|11\.222|12345678901|x@y/);
    expect(t).toContain('código 0281');
  });

  it('aceita só chave no formato da Anthropic', () => {
    expect(iaConfigSchema.safeParse({ ativo: true, modelo: 'claude-opus-5-5', chave: 'abc' }).success).toBe(false);
    expect(iaConfigSchema.parse({ ativo: true, modelo: 'claude-opus-5-5', chave: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }).chave).toMatch(/^sk-ant/);
    expect(iaConfigSchema.parse({ ativo: false, modelo: 'claude-opus-5-5', chave: '' }).chave).toBeNull();
  });
});
