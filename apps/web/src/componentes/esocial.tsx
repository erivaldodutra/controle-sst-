import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AMBIENTES_ESOCIAL, SITUACOES_EVENTO, SITUACOES_LOTE } from '@sst/shared';
import { api, qs } from '../lib/api';
import { Etiqueta } from './ui';

const COR_EVENTO: Record<string, string> = {
  invalido: 'bg-red-100 text-red-800', pendente: 'bg-amber-100 text-amber-800', aprovado: 'bg-sky-100 text-sky-800',
  enviado: 'bg-violet-100 text-violet-800', processado: 'bg-emerald-100 text-emerald-800', rejeitado: 'bg-red-600 text-white',
  cancelado: 'bg-slate-100 text-slate-500', excluido: 'bg-slate-200 text-slate-700',
};
const COR_LOTE: Record<string, string> = {
  enviando: 'bg-violet-100 text-violet-800', aguardando: 'bg-violet-100 text-violet-800', processado: 'bg-emerald-100 text-emerald-800',
  recusado: 'bg-red-100 text-red-800', rejeitado: 'bg-red-100 text-red-800', falha_comunicacao: 'bg-amber-100 text-amber-800',
};

export const SituacaoEvento = ({ s }: { s: string }) =>
  <Etiqueta cor={COR_EVENTO[s] ?? ''}>{SITUACOES_EVENTO[s as keyof typeof SITUACOES_EVENTO] ?? s}</Etiqueta>;
export const SituacaoLote = ({ s }: { s: string }) =>
  <Etiqueta cor={COR_LOTE[s] ?? ''}>{SITUACOES_LOTE[s as keyof typeof SITUACOES_LOTE] ?? s}</Etiqueta>;
export const Ambiente = ({ a }: { a: number }) =>
  <Etiqueta cor={a === 1 ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}>{AMBIENTES_ESOCIAL[a as 1 | 2]}</Etiqueta>;

/** Lista de erros de validação ou ocorrências devolvidas pelo eSocial. */
export function ListaMensagens({ titulo, itens, cor = 'red' }: { titulo: string; itens: any[]; cor?: 'red' | 'amber' }) {
  if (!itens?.length) return null;
  const c = cor === 'red' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${c}`}>
      <div className="mb-1 font-medium">{titulo}</div>
      <ul className="list-disc space-y-0.5 pl-5">
        {itens.map((m, i) => (
          <li key={i}>
            {m.codigo ? <span className="font-mono text-xs">[{m.codigo}] </span> : null}
            {m.mensagem ?? m.descricao}
            {m.localizacao ? <span className="text-xs opacity-70"> ({m.localizacao})</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Campo de código de tabela oficial do eSocial com busca por código ou descrição.
 * O valor é sempre um código que existe na tabela.
 */
export function CodigoTabela({ tabela, valor, onChange, required, placeholder }: {
  tabela: number | number[]; valor: string; onChange: (codigo: string) => void; required?: boolean; placeholder?: string;
}) {
  const tabelas = Array.isArray(tabela) ? tabela : [tabela];
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const atual = useQuery({
    queryKey: ['esocial-tabela', tabelas, 'cod', valor],
    queryFn: async () => (await Promise.all(tabelas.map((t) => api.get(`/esocial/tabelas/${t}${qs({ codigos: valor })}`)))).flat()[0] ?? null,
    enabled: !!valor,
  });
  const lista = useQuery({
    queryKey: ['esocial-tabela', tabelas, busca],
    queryFn: async () => (await Promise.all(tabelas.map((t) => api.get(`/esocial/tabelas/${t}${qs({ busca })}`)))).flat(),
    enabled: aberto && busca.trim().length >= 2,
  });
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  return (
    <div className="relative" ref={caixa}>
      <input
        className="campo"
        value={aberto ? busca : valor ? `${valor}${atual.data ? ` · ${atual.data.descricao}` : ''}` : ''}
        onFocus={() => { setAberto(true); setBusca(''); }}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={placeholder ?? `Busque na Tabela ${tabelas.join(' ou ')} por código ou nome`}
        required={required && !valor}
        aria-label={`Código da Tabela ${tabelas.join(' ou ')}`}
      />
      {aberto && busca.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-elevado">
          {lista.isLoading ? <div className="px-3 py-2 text-sm text-slate-500">Buscando…</div>
            : !lista.data?.length ? <div className="px-3 py-2 text-sm text-slate-500">Nada encontrado.</div>
              : lista.data.map((x: any) => (
                <button type="button" key={x.codigo} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-marca-50"
                  onClick={() => { onChange(x.codigo); setAberto(false); }}>
                  <span className="font-mono text-xs text-slate-500">{x.codigo}</span> {x.descricao}
                  {x.grupo ? <span className="text-xs text-slate-400"> · {x.grupo}</span> : null}
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

/** Baixa um arquivo da API (XML do evento ou do recibo). */
export async function baixar(url: string, nome: string) {
  const r = await fetch(`/api${url}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.mensagem ?? `Erro ${r.status}`);
  const b = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}
