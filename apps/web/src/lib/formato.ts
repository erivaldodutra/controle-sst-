import { formatarCnpj, formatarCpf } from '@sst/shared';

export const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const dataHoraBr = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
export const inscricao = (tipo: number, v: string) => (tipo === 1 ? formatarCnpj(v) : tipo === 2 ? formatarCpf(v) : v);
export const cpf = formatarCpf;
export const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const SITUACOES: Record<string, { rotulo: string; cor: string }> = {
  ativo: { rotulo: 'Ativo', cor: 'bg-emerald-100 text-emerald-800' },
  afastado: { rotulo: 'Afastado', cor: 'bg-amber-100 text-amber-800' },
  desligado: { rotulo: 'Desligado', cor: 'bg-slate-200 text-slate-700' },
  admissao_futura: { rotulo: 'Admissão futura', cor: 'bg-sky-100 text-sky-800' },
};
