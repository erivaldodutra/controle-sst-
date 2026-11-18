import { AlertCircle, Building2, CheckCircle2, Inbox, Info, X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { ErroApi } from '../lib/api';

export function Titulo({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-tinta">{titulo}</h1>
        {subtitulo && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

export function Campo({
  rotulo, erro, children, className = '', obrigatorio,
}: { rotulo: string; erro?: string; children: ReactNode; className?: string; obrigatorio?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="rotulo">
        {rotulo}
        {obrigatorio && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {erro && <span className="mt-1 block text-xs text-red-600">{erro}</span>}
    </label>
  );
}

export function Aviso({ erro, tipo = 'erro', children }: { erro?: unknown; tipo?: 'erro' | 'info' | 'ok'; children?: ReactNode }) {
  if (!erro && !children) return null;
  const msg = erro instanceof ErroApi ? erro.message : erro instanceof Error ? erro.message : children;
  const cor = tipo === 'erro' ? 'border-red-200 bg-red-50 text-red-800' : tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800';
  const Icone = tipo === 'erro' ? AlertCircle : tipo === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`mb-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${cor}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Icone size={17} className="mt-px shrink-0" />
      <div className="min-w-0">{msg}</div>
    </div>
  );
}

export function Modal({ titulo, aberto, aoFechar, children, largura = 'max-w-2xl' }: {
  titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; largura?: string;
}) {
  useEffect(() => {
    if (!aberto) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-40 flex animate-surgir justify-end bg-noite-900/40 backdrop-blur-[2px]" onMouseDown={aoFechar}>
      <div
        className={`h-full w-full ${largura} animate-entrar-direita overflow-y-auto bg-white shadow-2xl sm:rounded-l-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={titulo}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-6 py-4 backdrop-blur">
          <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
          <button className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-tinta" onClick={aoFechar} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-slate-500">
      <div className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Inbox size={20} /></div>
      <div className="max-w-md">{children}</div>
    </div>
  );
}

export function Etiqueta({ cor, children }: { cor: string; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-current/10 ${cor}`}>{children}</span>;
}

export function Carregando() {
  return (
    <div className="flex items-center justify-center gap-2.5 px-4 py-12 text-sm text-slate-400" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-marca-500" />
      Carregando…
    </div>
  );
}

/** Exige empresa selecionada no topo para telas que trabalham com uma empresa. */
export function ExigeEmpresa({ empresaId, children }: { empresaId: string | null; children: ReactNode }) {
  if (!empresaId)
    return (
      <div className="cartao flex flex-col items-center gap-3 p-10 text-center text-sm text-slate-600">
        <div className="grid size-12 place-items-center rounded-full bg-marca-50 text-marca-600"><Building2 size={22} /></div>
        Escolha uma empresa no seletor do topo para continuar.
      </div>
    );
  return <>{children}</>;
}
