import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, ArrowUpRight, Building2, Factory, GraduationCap, HeartPulse, UserMinus, UserPlus, Users, UserX,
} from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Carregando, Titulo } from '../componentes/ui';

type Tom = 'marca' | 'azul' | 'violeta' | 'ambar' | 'vermelho' | 'cinza';
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
function Indicador({ rotulo, valor, para, icone, tom = 'marca', alerta }: {
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

const SEGMENTOS = [
  { chave: 'em_dia', rotulo: 'Em dia', cor: 'bg-marca-500' },
  { chave: 'vencendo', rotulo: 'Vencendo', cor: 'bg-amber-400' },
  { chave: 'vencido', rotulo: 'Vencido', cor: 'bg-red-500' },
  { chave: 'sem_aso', rotulo: 'Sem ASO', cor: 'bg-red-300' },
  { chave: 'pendente', rotulo: 'Pendente', cor: 'bg-red-300' },
];

/** Barra empilhada com a situação de um tipo de controle (ASO ou treinamentos), com números reais do resumo. */
function BarraSituacao({ titulo, resumo, para }: { titulo: string; resumo: Record<string, number> | undefined; para: string }) {
  const segs = SEGMENTOS.map((g) => ({ ...g, n: resumo?.[g.chave] ?? 0 })).filter((g) => g.n > 0);
  const total = segs.reduce((a, g) => a + g.n, 0);
  const emDia = resumo?.em_dia ?? 0;
  return (
    <Link to={para} className="group block rounded-lg p-1 -m-1 transition hover:bg-slate-50">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-tinta">{titulo}</span>
        <span className="text-xs text-slate-500 tabular-nums">
          {total ? <><span className="font-semibold text-tinta">{Math.round((emDia / total) * 100)}%</span> em dia · {total.toLocaleString('pt-BR')} no total</> : 'Nenhum controle exigido'}
        </span>
      </div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {segs.map((g) => (
          <div key={g.chave} className={`${g.cor} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${(g.n / total) * 100}%` }} title={`${g.rotulo}: ${g.n}`} />
        ))}
      </div>
      {total > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {segs.map((g) => (
            <span key={g.chave} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${g.cor}`} />
              {g.rotulo} <span className="font-medium text-slate-700 tabular-nums">{g.n.toLocaleString('pt-BR')}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

function PainelVencimentos() {
  const s = useSessao();
  const { data } = useQuery({
    queryKey: ['vencimentos', s.empresaId, '', 'todos'],
    queryFn: () => api.get(`/vencimentos${qs({ empresaId: s.empresaId, todos: '1' })}`),
  });
  if (!data) return null;
  const n = (t: string, sit: string[]) => sit.reduce((a, x) => a + (data.resumo?.[t]?.[x] ?? 0), 0);
  return (
    <>
      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">Saúde e treinamentos</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {s.pode('saude.ler') && <Indicador rotulo="ASO vencido ou ausente" valor={n('aso', ['vencido', 'sem_aso'])} para="/vencimentos?tipo=aso" icone={<HeartPulse size={20} />} tom="vermelho" alerta />}
        {s.pode('saude.ler') && <Indicador rotulo="ASO vencendo" valor={n('aso', ['vencendo'])} para="/vencimentos?tipo=aso&situacao=vencendo" icone={<AlarmClock size={20} />} tom="ambar" alerta />}
        {s.pode('treinamentos.ler') && <Indicador rotulo="Treinamento vencido ou pendente" valor={n('treinamento', ['vencido', 'pendente'])} para="/vencimentos?tipo=treinamento" icone={<GraduationCap size={20} />} tom="vermelho" alerta />}
        {s.pode('treinamentos.ler') && <Indicador rotulo="Treinamento vencendo" valor={n('treinamento', ['vencendo'])} para="/vencimentos?tipo=treinamento&situacao=vencendo" icone={<AlarmClock size={20} />} tom="ambar" alerta />}
      </div>
      <div className="cartao mt-4 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-tinta">Situação dos controles</h3>
          <span className="text-xs text-slate-500">Funcionários ativos e afastados</span>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {s.pode('saude.ler') && <BarraSituacao titulo="ASO periódico" resumo={data.resumo?.aso} para="/vencimentos?tipo=aso" />}
          {s.pode('treinamentos.ler') && <BarraSituacao titulo="Treinamentos exigidos" resumo={data.resumo?.treinamento} para="/vencimentos?tipo=treinamento" />}
        </div>
      </div>
    </>
  );
}

export function Inicio() {
  const s = useSessao();
  const { data } = useQuery({
    queryKey: ['contagens', s.empresaId],
    queryFn: () => api.get(`/painel/contagens${qs({ empresaId: s.empresaId })}`),
  });
  const vazio = data && data.empresas === 0;
  return (
    <>
      <Titulo titulo={`Olá, ${s.eu.nome.split(' ')[0]}`} subtitulo={s.empresaId ? 'Números da empresa selecionada' : 'Números de todas as empresas que você acessa'} />
      {!data ? (
        <Carregando />
      ) : vazio ? (
        <div className="cartao flex flex-col items-center p-10 text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-marca-50 text-marca-600 ring-1 ring-marca-100"><Building2 size={26} /></div>
          <h2 className="text-lg font-semibold">Comece cadastrando uma empresa</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Depois cadastre os estabelecimentos, a estrutura (setores, funções e GHE) e os funcionários, um a um ou por planilha.
          </p>
          {s.podeGlobal('empresas.editar') && <Link to="/empresas?nova=1" className="btn-primario mt-4">Cadastrar empresa</Link>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
          <Indicador rotulo="Empresas ativas" valor={data.empresas} para="/empresas" icone={<Building2 size={20} />} />
          <Indicador rotulo="Estabelecimentos" valor={data.estabelecimentos} icone={<Factory size={20} />} tom="azul" />
          <Indicador rotulo="Funcionários ativos" valor={data.ativos} para="/funcionarios?situacao=ativo" icone={<Users size={20} />} tom="violeta" />
          <Indicador rotulo="Afastados" valor={data.afastados} para="/funcionarios?situacao=afastado" icone={<UserMinus size={20} />} tom="ambar" />
          <Indicador rotulo="Desligados" valor={data.desligados} para="/funcionarios?situacao=desligado" icone={<UserX size={20} />} tom="cinza" />
          <Indicador rotulo="Admissões nos últimos 30 dias" valor={data.admissoes30Dias} icone={<UserPlus size={20} />} tom="azul" />
        </div>
      )}
      {data && !vazio && (s.pode('saude.ler') || s.pode('treinamentos.ler')) && <PainelVencimentos />}
      <p className="mt-8 text-xs text-slate-400">
        Os indicadores de documentos, planos de ação e eSocial aparecem aqui conforme cada módulo for entregue.
      </p>
    </>
  );
}
