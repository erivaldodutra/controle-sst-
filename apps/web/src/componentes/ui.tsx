import { X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { ErroApi } from '../lib/api';

export function Titulo({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>}
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
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${cor}`}>{msg}</div>;
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
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={aoFechar}>
      <div className={`h-full w-full ${largura} overflow-y-auto bg-white shadow-xl`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <h2 className="font-semibold">{titulo}</h2>
          <button className="rounded p-1 hover:bg-slate-100" onClick={aoFechar} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Etiqueta({ cor, children }: { cor: string; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cor}`}>{children}</span>;
}

export function Carregando() {
  return <div className="px-4 py-10 text-center text-sm text-slate-400">Carregando…</div>;
}

/** Exige empresa selecionada no topo para telas que trabalham com uma empresa. */
export function ExigeEmpresa({ empresaId, children }: { empresaId: string | null; children: ReactNode }) {
  if (!empresaId)
    return (
      <div className="cartao p-8 text-center text-sm text-slate-600">
        Escolha uma empresa no seletor do topo para continuar.
      </div>
    );
  return <>{children}</>;
}
