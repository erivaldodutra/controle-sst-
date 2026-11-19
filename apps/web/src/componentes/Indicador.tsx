import { ArrowUpRight } from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type Tom = 'marca' | 'azul' | 'violeta' | 'ambar' | 'vermelho' | 'cinza';
const TONS: Record<Tom, string> = {
  marca: 'bg-marca-50 text-marca-600 ring-marca-100',
  azul: 'bg-sky-50 text-sky-600 ring-sky-100',
  violeta: 'bg-violet-50 text-violet-600 ring-violet-100',
  ambar: 'bg-amber-50 text-amber-600 ring-amber-100',
  vermelho: 'bg-red-50 text-red-600 ring-red-100',
  cinza: 'bg-slate-100 text-slate-500 ring-slate-200',
};

/**
 * Cartão de indicador. `icone` e `tom` são opcionais; `alerta` pinta o número quando há pendência.
 */
export function Indicador({ rotulo, valor, para, icone, tom = 'marca', alerta }: {
  rotulo: string; valor: number; para?: string; icone?: ReactNode; tom?: Tom; alerta?: boolean;
}) {
  const destaque = alerta && valor > 0;
  const corpo = (
    <div className={`cartao group flex h-full items-start gap-4 p-4 transition sm:p-5 ${para ? 'hover:-translate-y-0.5 hover:border-marca-200 hover:shadow-elevado' : ''}`}>
      {icone && <div className={`hidden size-11 sm:grid shrink-0 place-items-center rounded-xl ring-1 ring-inset ${TONS[destaque ? tom : alerta ? 'cinza' : tom]}`}>{icone}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-snug text-slate-500">{rotulo}</div>
        <div className={`mt-1 text-2xl font-semibold sm:text-3xl tracking-tight tabular-nums ${destaque ? (tom === 'vermelho' ? 'text-red-600' : 'text-amber-600') : 'text-tinta'}`}>
          {valor.toLocaleString('pt-BR')}
        </div>
      </div>
      {para && <ArrowUpRight size={16} className="shrink-0 text-slate-300 transition group-hover:text-marca-500" />}
    </div>
  );
  return para ? <Link to={para} className="block">{corpo}</Link> : corpo;
}
