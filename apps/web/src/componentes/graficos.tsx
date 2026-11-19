import { useEffect, useRef, useState } from 'react';

/**
 * Gráficos em SVG, sem biblioteca externa (funciona sem internet).
 * Cores categóricas em ordem fixa (paleta validada para daltonismo); a cor segue a série, nunca a posição.
 */
export const CORES_SERIE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;

export type Serie = { chave: string; rotulo: string };

const mesCurto = (mes: string) => {
  const [a, m] = mes.split('-');
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${a!.slice(2)}`;
};

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(300);
  useEffect(() => {
    if (!ref.current) return;
    const o = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e!.contentRect.width))));
    o.observe(ref.current);
    return () => o.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Topo "redondo" do eixo: 1, 2, 5 × 10^n. */
function teto(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}

/** Barra com o canto de cima arredondado (4px) e a base reta, apoiada no eixo. */
function barra(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function Legenda({ series }: { series: Serie[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {series.map((s, i) => (
        <span key={s.chave} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: CORES_SERIE[i] }} />{s.rotulo}
        </span>
      ))}
    </div>
  );
}

/**
 * Colunas por mês (agrupadas ou empilhadas), com legenda, valor ao passar o mouse
 * e a opção de ver os mesmos números em tabela.
 */
export function ColunasMensais({ titulo, dados, series, empilhado, vazio = 'Sem registros no período.' }: {
  titulo: string; dados: Record<string, any>[]; series: Serie[]; empilhado?: boolean; vazio?: string;
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const total = (d: Record<string, any>) => series.reduce((s, x) => s + (d[x.chave] ?? 0), 0);
  const max = teto(Math.max(0, ...dados.map((d) => (empilhado ? total(d) : Math.max(...series.map((s) => d[s.chave] ?? 0))))));
  const tudoZero = dados.every((d) => total(d) === 0);
  const H = 200;
  const M = { t: 8, r: 8, b: 24, l: 32 };
  const ih = H - M.t - M.b;
  const iw = largura - M.l - M.r;
  const passo = iw / Math.max(1, dados.length);
  const larguraGrupo = Math.min(passo * 0.7, empilhado ? 36 : 18 * series.length + 2 * (series.length - 1));
  const y = (v: number) => M.t + ih - (v / max) * ih;
  const cadaRotulo = dados.length > 12 ? (largura < 520 ? 4 : 2) : largura < 420 && dados.length > 6 ? 2 : 1;
  return (
    <section className="cartao min-w-0 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
        <button className="text-xs font-medium text-marca-700 hover:underline" onClick={() => setTabela(!tabela)}>{tabela ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      <div className="mb-2"><Legenda series={series} /></div>
      {tabela ? (
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Mês</th>{series.map((s) => <th key={s.chave} className="text-right">{s.rotulo}</th>)}</tr></thead>
            <tbody>{dados.map((d) => (
              <tr key={d.mes}><td>{mesCurto(d.mes)}</td>{series.map((s) => <td key={s.chave} className="text-right tabular-nums">{d[s.chave] ?? 0}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full min-w-0" onMouseLeave={() => setFoco(null)}>
          <svg width={largura} height={H} role="img" aria-label={titulo} className="block overflow-visible">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={M.l} x2={largura - M.r} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? '#cbd5e1' : '#eef2f6'} />
                <text x={M.l - 6} y={y(max * f) + 3.5} textAnchor="end" className="fill-slate-400 text-[10.5px] tabular-nums">{Math.round(max * f)}</text>
              </g>
            ))}
            {dados.map((d, i) => {
              const cx = M.l + passo * i + passo / 2;
              const x0 = cx - larguraGrupo / 2;
              let acumulado = 0;
              const larg = empilhado ? larguraGrupo : (larguraGrupo - 2 * (series.length - 1)) / series.length;
              return (
                <g key={d.mes} opacity={foco === null || foco === i ? 1 : 0.45}>
                  {series.map((s, k) => {
                    const v = d[s.chave] ?? 0;
                    if (!v) return null;
                    if (empilhado) {
                      const topo = y(acumulado + v);
                      const h = y(acumulado) - topo - (acumulado ? 2 : 0);
                      acumulado += v;
                      const ultimo = series.slice(k + 1).every((z) => !(d[z.chave] ?? 0));
                      return <path key={s.chave} d={ultimo ? barra(x0, topo, larg, h) : `M${x0},${topo}h${larg}v${h}h${-larg}Z`} fill={CORES_SERIE[k]} />;
                    }
                    return <path key={s.chave} d={barra(x0 + k * (larg + 2), y(v), larg, y(0) - y(v))} fill={CORES_SERIE[k]} />;
                  })}
                  {i % cadaRotulo === 0 && <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[10.5px]">{mesCurto(d.mes)}</text>}
                  <rect x={M.l + passo * i} y={M.t} width={passo} height={ih} fill="transparent" onMouseEnter={() => setFoco(i)} />
                </g>
              );
            })}
          </svg>
          {tudoZero && <div className="pointer-events-none absolute inset-x-0 top-16 text-center text-sm text-slate-400">{vazio}</div>}
          {foco !== null && dados[foco] && (
            <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-elevado"
              style={{ left: Math.min(largura - 150, Math.max(0, M.l + passo * foco + passo / 2 + 12)) }}>
              <div className="mb-1 font-semibold text-tinta">{mesCurto(dados[foco]!.mes)}</div>
              {series.map((s, k) => (
                <div key={s.chave} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="size-2 rounded-sm" style={{ background: CORES_SERIE[k] }} />{s.rotulo}</span>
                  <span className="font-medium tabular-nums text-tinta">{dados[foco]![s.chave] ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Uma barra horizontal por item (0 a 100%), com o valor escrito ao lado. */
export function BarrasPercentuais({ titulo, itens, vazio }: { titulo: string; itens: { id: string; rotulo: string; valor: number | null }[]; vazio: string }) {
  return (
    <section className="cartao min-w-0 p-5">
      <h3 className="mb-3 text-sm font-semibold text-tinta">{titulo}</h3>
      {!itens.length ? <p className="py-6 text-center text-sm text-slate-400">{vazio}</p> : (
        <div className="space-y-2.5">
          {itens.map((i) => (
            <div key={i.id} className="grid grid-cols-[minmax(0,12rem)_1fr_3.5rem] items-center gap-3 text-sm" title={`${i.rotulo}: ${i.valor == null ? 'sem requisitos avaliados' : `${i.valor}%`}`}>
              <span className="truncate text-slate-600">{i.rotulo}</span>
              <div className="h-2.5 rounded-full bg-slate-100">
                {i.valor != null && i.valor > 0 && <div className="h-full rounded-full" style={{ width: `${i.valor}%`, background: CORES_SERIE[0] }} />}
              </div>
              <span className="text-right font-medium tabular-nums text-tinta">{i.valor == null ? '—' : `${i.valor}%`}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
