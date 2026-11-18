import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, ErroApi, qs } from '../lib/api';
import { cpf, dataBr } from '../lib/formato';
import { Aviso, Etiqueta } from './ui';

/** Situações de ASO, treinamentos e vencimentos, com rótulo e cor. */
export const SITUACOES_PRAZO: Record<string, { rotulo: string; cor: string }> = {
  vigente: { rotulo: 'Vigente', cor: 'bg-emerald-100 text-emerald-800' },
  em_dia: { rotulo: 'Em dia', cor: 'bg-emerald-100 text-emerald-800' },
  vencendo: { rotulo: 'Vencendo', cor: 'bg-amber-100 text-amber-800' },
  vencido: { rotulo: 'Vencido', cor: 'bg-red-100 text-red-800' },
  pendente: { rotulo: 'Pendente', cor: 'bg-red-100 text-red-800' },
  sem_aso: { rotulo: 'Sem ASO', cor: 'bg-red-100 text-red-800' },
  sem_vencimento: { rotulo: 'Sem vencimento', cor: 'bg-slate-200 text-slate-700' },
  substituido: { rotulo: 'Substituído', cor: 'bg-slate-100 text-slate-600' },
  cancelado: { rotulo: 'Cancelado', cor: 'bg-slate-200 text-slate-600 line-through' },
  planejada: { rotulo: 'Planejada', cor: 'bg-sky-100 text-sky-800' },
  realizada: { rotulo: 'Realizada', cor: 'bg-emerald-100 text-emerald-800' },
  cancelada: { rotulo: 'Cancelada', cor: 'bg-slate-200 text-slate-600' },
};

export function SituacaoPrazo({ s, dias }: { s: string; dias?: number | null }) {
  const d = SITUACOES_PRAZO[s] ?? { rotulo: s, cor: 'bg-slate-100 text-slate-700' };
  const extra = dias === null || dias === undefined ? '' : dias < 0 ? ` há ${-dias} d` : s === 'vencendo' ? ` em ${dias} d` : '';
  return <Etiqueta cor={d.cor}>{d.rotulo}{extra}</Etiqueta>;
}

/** Formulário com tratamento de erro padrão (mensagens por campo vêm juntas). */
export function Formulario({ children, aoEnviar, botao = 'Salvar', perigo, extra }: {
  children: ReactNode; aoEnviar: () => Promise<unknown>; botao?: string; perigo?: boolean; extra?: ReactNode;
}) {
  const [erro, setErro] = useState<unknown>();
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    setEnviando(true);
    try {
      await aoEnviar();
    } catch (x) {
      setErro(x instanceof ErroApi && x.corpo?.campos ? new Error(x.corpo.campos.map((c: any) => `${c.campo ? c.campo + ': ' : ''}${c.mensagem}`).join('; ')) : x);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-3">
      <Aviso erro={erro} />
      {children}
      <div className="flex items-center gap-2">
        <button className={perigo ? 'btn-perigo' : 'btn-primario'} disabled={enviando}>{enviando ? 'Salvando…' : botao}</button>
        {extra}
      </div>
    </form>
  );
}

export function useCadastroSaude(tipo: 'medicos' | 'clinicas' | 'tipos-exame', inativos = false) {
  return useQuery({
    queryKey: ['saude', tipo, inativos],
    queryFn: () => api.get<any[]>(`/saude/${tipo}${qs({ inativos: inativos ? 1 : undefined })}`),
  });
}

export function useBiblioteca(inativos = false) {
  return useQuery({ queryKey: ['treinamentos', inativos], queryFn: () => api.get<any[]>(`/treinamentos${qs({ inativos: inativos ? 1 : undefined })}`) });
}

/** Busca um funcionário (vínculo) da empresa pelo nome, CPF ou matrícula. */
export function SeletorFuncionario({ empresaId, valor, onChange }: {
  empresaId: string; valor: any | null; onChange: (v: any | null) => void;
}) {
  const [q, setQ] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTermo(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useQuery({
    queryKey: ['seletor-funcionario', empresaId, termo],
    queryFn: () => api.get(`/funcionarios${qs({ empresaId, busca: termo, limite: 8 })}`),
    enabled: termo.length >= 2,
  });
  if (valor)
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span><b>{valor.nome}</b> · Matr. {valor.matricula} · CPF {cpf(valor.cpf)}</span>
        <button type="button" className="text-xs text-marca-700 hover:underline" onClick={() => onChange(null)}>Trocar</button>
      </div>
    );
  return (
    <div>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
        <input className="campo pl-8" placeholder="Nome, CPF ou matrícula" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {termo.length >= 2 && data && (
        <div className="mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200">
          {!data.itens.length && <div className="px-3 py-2 text-sm text-slate-500">Nenhum funcionário encontrado</div>}
          {data.itens.map((f: any) => (
            <button type="button" key={f.vinculoId} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => onChange(f)}>
              <div className="font-medium">{f.nome}</div>
              <div className="text-xs text-slate-500">
                Matr. {f.matricula} · admissão {dataBr(f.dataAdmissao)} · {f.funcao ?? f.cargo ?? 'sem função'} · {f.situacao}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Soma meses a uma data ISO (para sugerir o vencimento do ASO). */
export function somarMeses(iso: string, meses: number) {
  const [a, m, d] = iso.split('-').map(Number);
  const r = new Date(Date.UTC(a!, m! - 1 + meses, d!));
  return r.toISOString().slice(0, 10);
}
