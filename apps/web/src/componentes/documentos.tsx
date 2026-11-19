import { useQuery } from '@tanstack/react-query';
import { SITUACOES_DOCUMENTO, TIPOS_PRAZO } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr } from '../lib/formato';
import { Etiqueta } from './ui';

const CORES: Record<string, string> = {
  regular: 'bg-emerald-100 text-emerald-800',
  proximo_revisao: 'bg-amber-100 text-amber-800',
  proximo_vencimento: 'bg-amber-100 text-amber-800',
  vencido: 'bg-red-100 text-red-800',
  pendente: 'bg-red-100 text-red-800',
  em_elaboracao: 'bg-sky-100 text-sky-800',
  em_revisao: 'bg-sky-100 text-sky-800',
  substituido: 'bg-slate-100 text-slate-600',
  nao_aplicavel: 'bg-slate-200 text-slate-600',
  // versões
  vigente: 'bg-emerald-100 text-emerald-800',
  substituida: 'bg-slate-100 text-slate-600',
  cancelada: 'bg-slate-200 text-slate-600 line-through',
};

export function SituacaoDocumento({ s, rotulo }: { s: string; rotulo?: string }) {
  return <Etiqueta cor={CORES[s] ?? 'bg-slate-100 text-slate-700'}>{rotulo ?? SITUACOES_DOCUMENTO[s as keyof typeof SITUACOES_DOCUMENTO] ?? s}</Etiqueta>;
}

export function TextoPrazo({ p }: { p: any }) {
  if (!p) return <span className="text-slate-400">—</span>;
  const cor = p.estado === 'atrasado' ? 'text-red-700' : p.estado === 'proximo' ? 'text-amber-700' : 'text-slate-700';
  const quando = p.dias < 0 ? `há ${-p.dias} d` : p.dias === 0 ? 'hoje' : `em ${p.dias} d`;
  return (
    <span className={cor}>
      {TIPOS_PRAZO[p.tipo as keyof typeof TIPOS_PRAZO]}: {dataBr(p.data)} <span className="text-xs">({quando})</span>
    </span>
  );
}

export function useTiposDocumento(inativos = false) {
  return useQuery({
    queryKey: ['documentos-tipos', inativos],
    queryFn: () => api.get<any[]>(`/documentos-tipos${qs({ inativos: inativos ? 1 : undefined })}`),
  });
}

/** Meses ou "—" para mostrar regras. */
export const meses = (n: number | null | undefined) => (n ? `${n} ${n === 1 ? 'mês' : 'meses'}` : '—');
