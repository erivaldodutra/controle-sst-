import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido } from './documentos';

describe('validação de documentos', () => {
  it('aceita CPF com dígitos corretos e rejeita os demais', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });
  it('aceita CNPJ com dígitos corretos e rejeita os demais', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('00.000.000/0000-00')).toBe(false);
  });
});
