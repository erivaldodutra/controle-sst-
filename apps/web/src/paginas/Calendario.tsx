import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIAS_ALERTA, type CategoriaAlerta, type ItemCalendario } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { baixar } from '../componentes/esocial';
import { Aviso, Carregando, Etiqueta, Titulo, Vazio } from '../componentes/ui';

const ESTADOS = {
  atrasado: { rotulo: 'Atrasado', cor: 'bg-red-50 text-red-700', ponto: 'bg-red-500' },
  proximo: { rotulo: 'Próximo', cor: 'bg-amber-50 text-amber-700', ponto: 'bg-amber-400' },
  futuro: { rotulo: 'Em dia', cor: 'bg-slate-100 text-slate-600', ponto: 'bg-slate-400' },
} as const;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const somarDias = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

function ItemLinha({ i }: { i: ItemCalendario }) {
  const e = ESTADOS[i.estado];
  return (
    <Link to={i.link} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition hover:bg-slate-50">
      <span className="w-24 shrink-0 tabular-nums text-slate-600">{dataBr(i.data)}</span>
      <Etiqueta cor={e.cor}>{e.rotulo}{i.estado !== 'futuro' && ` · ${i.dias < 0 ? `${-i.dias} dia(s) atrás` : i.dias === 0 ? 'hoje' : `em ${i.dias} dia(s)`}`}</Etiqueta>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-tinta">{i.titulo}</span>
        <span className="block text-xs text-slate-500">{CATEGORIAS_ALERTA[i.categoria]} · {i.empresa}{i.detalhe ? ` · ${i.detalhe}` : ''}</span>
      </span>
    </Link>
  );
}

/** Calendário de obrigações: os prazos que cada módulo já controla, num só lugar. Nada é digitado aqui. */
export function Calendario() {
  const s = useSessao();
  const [params, setParams] = useSearchParams();
  const visao = params.get('visao') === 'mes' ? 'mes' : 'lista';
  const categoria = (params.get('categoria') ?? '') as CategoriaAlerta | '';
  const hojeLocal = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
  const [mes, setMes] = useState(hojeLocal.slice(0, 7));
  const [erro, setErro] = useState<unknown>();
  const fimMes = iso(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)));
  const ate = visao === 'mes' ? fimMes : somarDias(hojeLocal, 90);
  const q = useQuery({
    queryKey: ['calendario', s.empresaId, ate],
    queryFn: () => api.get<{ hoje: string; janela: number; itens: ItemCalendario[] }>(`/calendario${qs({ empresaId: s.empresaId, ate })}`),
  });
  const mudar = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };
  const itens = useMemo(() => (q.data?.itens ?? []).filter((i) => !categoria || i.categoria === categoria), [q.data, categoria]);
  const contagem = (e: keyof typeof ESTADOS) => itens.filter((i) => i.estado === e).length;
  const pdf = async () => {
    setErro(undefined);
    try { await baixar(`/relatorios/calendario${qs({ formato: 'pdf', empresaId: s.empresaId, ate })}`, `Calendário de obrigações ${q.data?.hoje}.pdf`); } catch (x) { setErro(x); }
  };

  const mover = (n: number) => { const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1)); setMes(iso(d).slice(0, 7)); };
  const primeiro = new Date(`${mes}-01T12:00:00Z`);
  const inicioGrade = somarDias(`${mes}-01`, -primeiro.getUTCDay());
  const semanas = Math.ceil((primeiro.getUTCDay() + Number(fimMes.slice(8))) / 7);
  const porDia = useMemo(() => {
    const m = new Map<string, ItemCalendario[]>();
    for (const i of itens) m.set(i.data, [...(m.get(i.data) ?? []), i]);
    return m;
  }, [itens]);

  return (
    <>
      <Titulo
        titulo="Calendário de obrigações"
        subtitulo={`Gerado dos vencimentos de ASO, treinamentos, documentos, ações, eventos do eSocial e certificado digital${q.data ? ` · alerta a partir de ${q.data.janela} dias antes` : ''}`}
        acoes={<button className="btn-secundario" onClick={pdf}><Download size={15} /> PDF</button>}
      />
      <Aviso erro={erro ?? q.error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Visão">
          {(['lista', 'mes'] as const).map((v) => (
            <button key={v} className={`rounded-md px-3 py-1.5 text-sm font-medium ${visao === v ? 'bg-marca-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              onClick={() => mudar('visao', v === 'lista' ? '' : v)} aria-pressed={visao === v}>{v === 'lista' ? 'Lista' : 'Mês'}</button>
          ))}
        </div>
        <select className="campo w-auto" value={categoria} onChange={(e) => mudar('categoria', e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {Object.entries(CATEGORIAS_ALERTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {q.data && (
          <span className="ml-auto flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" />Atrasados <b className="tabular-nums">{contagem('atrasado')}</b></span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" />Próximos <b className="tabular-nums">{contagem('proximo')}</b></span>
          </span>
        )}
      </div>
      {!q.data ? <Carregando /> : visao === 'lista' ? (
        <div className="space-y-4">
          {(['atrasado', 'proximo', 'futuro'] as const).map((e) => {
            const grupo = itens.filter((i) => i.estado === e);
            if (!grupo.length) return null;
            return (
              <section key={e} className="cartao overflow-hidden">
                <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">
                  {e === 'atrasado' ? 'Atrasados' : e === 'proximo' ? `Nos próximos ${q.data!.janela} dias` : 'Depois disso (até 90 dias)'} <span className="font-normal text-slate-500">· {grupo.length}</span>
                </h2>
                <div className="divide-y divide-slate-100">{grupo.map((i) => <ItemLinha key={i.chave} i={i} />)}</div>
              </section>
            );
          })}
          {!itens.length && <div className="cartao"><Vazio>Nenhum prazo atrasado ou nos próximos 90 dias.</Vazio></div>}
        </div>
      ) : (
        <section className="cartao overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <button className="btn-secundario px-2" onClick={() => mover(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
            <h2 className="text-sm font-semibold">
              {(() => { const n = MESES[Number(mes.slice(5, 7)) - 1]!; return n[0]!.toUpperCase() + n.slice(1); })()} de {mes.slice(0, 4)}
            </h2>
            <button className="btn-secundario px-2" onClick={() => mover(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
          </div>
          {(() => {
            const antes = itens.filter((i) => i.estado === 'atrasado' && i.data < `${mes}-01`).length;
            return antes > 0 && (
              <button className="w-full border-b border-red-100 bg-red-50 px-4 py-2 text-left text-sm text-red-800 hover:bg-red-100" onClick={() => setParams({ categoria })}>
                {antes} prazo(s) atrasado(s) de meses anteriores. Ver na lista.
              </button>
            );
          })()}
          <div className="overflow-x-auto">
            <div className="grid min-w-[44rem] grid-cols-7 text-xs">
              {DIAS.map((d) => <div key={d} className="border-b border-slate-100 px-2 py-1.5 text-center font-medium uppercase text-slate-500">{d}</div>)}
              {Array.from({ length: semanas * 7 }, (_, k) => {
                const dia = somarDias(inicioGrade, k);
                const doMes = dia.slice(0, 7) === mes;
                const lista = doMes ? porDia.get(dia) ?? [] : [];
                return (
                  <div key={dia} className={`min-h-24 border-b border-r border-slate-100 p-1.5 ${doMes ? '' : 'bg-slate-50/60'}`}>
                    <div className={`mb-1 text-right tabular-nums ${dia === q.data!.hoje ? 'font-semibold text-marca-700' : doMes ? 'text-slate-500' : 'text-slate-300'}`}>{Number(dia.slice(8))}</div>
                    {lista.slice(0, 3).map((i) => (
                      <Link key={i.chave} to={i.link} title={`${i.titulo} · ${i.empresa}`}
                        className={`mb-0.5 flex items-center gap-1 truncate rounded px-1 py-0.5 hover:ring-1 hover:ring-slate-300 ${ESTADOS[i.estado].cor}`}>
                        <span className={`size-1.5 shrink-0 rounded-full ${ESTADOS[i.estado].ponto}`} /><span className="truncate">{i.titulo}</span>
                      </Link>
                    ))}
                    {lista.length > 3 && (
                      <button className="px-1 text-[11px] text-marca-700 hover:underline" onClick={() => setParams({ visao: '', categoria })}>+{lista.length - 3} na lista</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
