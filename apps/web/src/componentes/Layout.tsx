import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, BarChart3, Bell, BellRing, Bot, Building2, CalendarDays, ClipboardList, FileBarChart, SlidersHorizontal, DatabaseBackup, FileSpreadsheet, GraduationCap, HeartPulse, LayoutDashboard, LogOut, Network,
  Biohazard, ClipboardCheck, FileText, Inbox, KeyRound, ListTodo, Scale, Search, Send, ShieldCheck, Stethoscope, UserCog, Users,
} from 'lucide-react';
import { ChevronsUpDown, Menu as MenuIcone, X } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { Permissao } from '@sst/shared';
import { api, qs } from '../lib/api';
import { cpf } from '../lib/formato';
import { useSessao } from '../lib/sessao';

interface Item { para: string; rotulo: string; icone: ReactNode; permissao: Permissao }

/** Só aparecem módulos já implementados; os demais entram no menu na fase em que forem entregues. */
const GRUPOS: { titulo: string; itens: Item[] }[] = [
  {
    titulo: 'Painel',
    itens: [
      { para: '/', rotulo: 'Início', icone: <LayoutDashboard size={17} />, permissao: 'empresas.ler' },
      { para: '/indicadores', rotulo: 'Indicadores', icone: <BarChart3 size={17} />, permissao: 'empresas.ler' },
      { para: '/calendario', rotulo: 'Calendário de obrigações', icone: <CalendarDays size={17} />, permissao: 'empresas.ler' },
    ],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { para: '/empresas', rotulo: 'Empresas', icone: <Building2 size={17} />, permissao: 'empresas.ler' },
      { para: '/estrutura', rotulo: 'Setores, funções e GHE', icone: <Network size={17} />, permissao: 'estrutura.ler' },
      { para: '/funcionarios', rotulo: 'Funcionários', icone: <Users size={17} />, permissao: 'funcionarios.ler' },
      { para: '/importacoes', rotulo: 'Importar planilha', icone: <FileSpreadsheet size={17} />, permissao: 'funcionarios.importar' },
    ],
  },
  {
    titulo: 'Saúde e treinamentos',
    itens: [
      { para: '/vencimentos', rotulo: 'Vencimentos', icone: <AlarmClock size={17} />, permissao: 'saude.ler' },
      { para: '/asos', rotulo: 'ASO', icone: <HeartPulse size={17} />, permissao: 'saude.ler' },
      { para: '/treinamentos', rotulo: 'Treinamentos', icone: <GraduationCap size={17} />, permissao: 'treinamentos.ler' },
      { para: '/saude/cadastros', rotulo: 'Médicos, clínicas e exames', icone: <Stethoscope size={17} />, permissao: 'saude.ler' },
    ],
  },
  {
    titulo: 'Programas legais',
    itens: [
      { para: '/documentos', rotulo: 'Programas e documentos', icone: <FileText size={17} />, permissao: 'documentos.ler' },
    ],
  },
  {
    titulo: 'Gestão de SST',
    itens: [
      { para: '/acoes', rotulo: 'Planos de ação', icone: <ListTodo size={17} />, permissao: 'acoes.ler' },
      { para: '/inspecoes', rotulo: 'Inspeções e ocorrências', icone: <ClipboardCheck size={17} />, permissao: 'inspecoes.ler' },
      { para: '/conformidade', rotulo: 'Matriz de conformidade', icone: <Scale size={17} />, permissao: 'conformidade.ler' },
    ],
  },
  {
    titulo: 'eSocial',
    itens: [
      { para: '/esocial', rotulo: 'Central de eventos', icone: <Send size={17} />, permissao: 'esocial.ler' },
      { para: '/esocial/lotes', rotulo: 'Lotes e retornos', icone: <Inbox size={17} />, permissao: 'esocial.ler' },
      { para: '/esocial/agentes', rotulo: 'Agentes nocivos por GHE', icone: <Biohazard size={17} />, permissao: 'esocial.ler' },
      { para: '/esocial/config', rotulo: 'Configuração e certificados', icone: <KeyRound size={17} />, permissao: 'esocial.ler' },
    ],
  },
  {
    titulo: 'Relatórios',
    itens: [
      { para: '/relatorios', rotulo: 'Central de relatórios', icone: <FileBarChart size={17} />, permissao: 'empresas.ler' },
      { para: '/ia', rotulo: 'Assistente de IA', icone: <Bot size={17} />, permissao: 'empresas.ler' },
    ],
  },
  {
    titulo: 'Administração',
    itens: [
      { para: '/alertas', rotulo: 'Regras de alerta', icone: <SlidersHorizontal size={17} />, permissao: 'empresas.ler' },
      { para: '/usuarios', rotulo: 'Usuários e perfis', icone: <UserCog size={17} />, permissao: 'usuarios.gerenciar' },
      { para: '/auditoria', rotulo: 'Auditoria', icone: <ClipboardList size={17} />, permissao: 'auditoria.ler' },
      { para: '/backup', rotulo: 'Backup', icone: <DatabaseBackup size={17} />, permissao: 'backup.gerenciar' },
    ],
  },
];

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase();
}

function Menu({ aoNavegar }: { aoNavegar?: () => void }) {
  const s = useSessao();
  return (
    <>
      <div className="flex items-center gap-3 px-5 pb-2 pt-5">
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-marca-400 to-marca-700 shadow-lg shadow-marca-900/40 ring-1 ring-white/10">
          <ShieldCheck className="text-white" size={20} strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <div className="font-semibold tracking-tight text-white">Controle SST</div>
          <div className="text-[11px] text-slate-400">Saúde e Segurança do Trabalho</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent]">
        {GRUPOS.map((g) => {
          const itens = g.itens.filter((i) => s.pode(i.permissao));
          if (!itens.length) return null;
          return (
            <div key={g.titulo} className="mt-5">
              <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">{g.titulo}</div>
              <div className="space-y-0.5">
                {itens.map((i) => (
                  <NavLink
                    key={i.para}
                    to={i.para}
                    end={i.para === '/' || i.para === '/esocial'}
                    onClick={aoNavegar}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition ${
                        isActive
                          ? 'bg-white/[0.08] font-medium text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-marca-400'
                          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className={isActive ? 'text-marca-300' : 'text-slate-500 transition group-hover:text-slate-300'}>{i.icone}</span>
                        <span className="truncate">{i.rotulo}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="m-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06]">
        <div className="flex items-center gap-3">
          <Link
            to="/minha-conta"
            onClick={aoNavegar}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-marca-500/20 text-xs font-semibold text-marca-200 ring-1 ring-marca-400/30"
            title="Minha conta"
          >
            {iniciais(s.eu.nome)}
          </Link>
          <div className="min-w-0 flex-1">
            <Link to="/minha-conta" onClick={aoNavegar} className="block truncate text-sm font-medium text-slate-100 hover:text-white">{s.eu.nome}</Link>
            <div className="truncate text-xs text-slate-500">{s.eu.email}</div>
          </div>
          <button className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.06] hover:text-red-300" onClick={s.sair} title="Sair" aria-label="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const s = useSessao();
  const [menuAberto, setMenuAberto] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuAberto(false), [pathname]);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-noite-900 bg-gradient-to-b from-noite-800 to-noite-900 lg:flex">
        <Menu />
      </aside>
      {menuAberto && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Menu">
          <div className="absolute inset-0 animate-surgir bg-noite-900/60 backdrop-blur-sm" onClick={() => setMenuAberto(false)} />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-gradient-to-b from-noite-800 to-noite-900 shadow-2xl">
            <button className="absolute right-3 top-5 rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setMenuAberto(false)} aria-label="Fechar menu">
              <X size={18} />
            </button>
            <Menu aoNavegar={() => setMenuAberto(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur-md md:px-8">
          <button className="btn-secundario px-2.5 lg:hidden" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">
            <MenuIcone size={18} />
          </button>
          <div className="relative min-w-0 flex-1 sm:max-w-xs sm:flex-none">
            <Building2 size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
            <select
              className="campo appearance-none pl-9 pr-9 font-medium"
              value={s.empresaId ?? ''}
              onChange={(e) => s.setEmpresaId(e.target.value || null)}
              aria-label="Empresa"
            >
              <option value="">Todas as empresas</option>
              {s.empresas.map((e) => (
                <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
              ))}
            </select>
            <ChevronsUpDown size={15} className="pointer-events-none absolute right-3 top-3 text-slate-400" />
          </div>
          <BuscaGlobal />
          <Notificacoes />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function BuscaGlobal() {
  const [q, setQ] = useState('');
  const [aberta, setAberta] = useState(false);
  const [termo, setTermo] = useState('');
  const nav = useNavigate();
  const s = useSessao();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setTermo(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberta(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, []);
  const { data } = useQuery({
    queryKey: ['busca', termo],
    queryFn: () => api.get(`/busca${qs({ q: termo })}`),
    enabled: termo.length >= 2,
  });
  const ir = (url: string, empresaId?: string) => {
    if (empresaId) s.setEmpresaId(empresaId);
    setAberta(false);
    setQ('');
    nav(url);
  };
  return (
    <div ref={ref} className="relative min-w-48 flex-1 basis-full sm:basis-auto md:max-w-lg">
      <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
      <input
        className="campo bg-slate-50/80 pl-9 focus:bg-white"
        placeholder="Buscar funcionário (nome, CPF, matrícula) ou empresa"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
      />
      {aberta && termo.length >= 2 && data && (
        <div className="absolute left-0 right-0 top-12 z-30 max-h-96 animate-surgir overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-elevado">
          {data.empresas.length + data.funcionarios.length === 0 && <div className="px-3 py-3 text-slate-500">Nada encontrado</div>}
          {data.funcionarios.map((f: any) => (
            <button key={f.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-marca-50" onClick={() => ir(`/funcionarios/${f.id}`)}>
              <div className="font-medium">{f.nome}</div>
              <div className="text-xs text-slate-500">CPF {cpf(f.cpf)} · Matr. {f.matricula ?? '—'} · {f.empresa}</div>
            </button>
          ))}
          {data.empresas.map((e: any) => (
            <button key={e.id} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-marca-50" onClick={() => ir(`/empresas/${e.id}`, e.id)}>
              <div className="font-medium">{e.razaoSocial}</div>
              <div className="text-xs text-slate-500">Empresa</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sino do topo: avisos de prazos atrasados ou próximos, gerados dos módulos e só do próprio usuário. */
function Notificacoes() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ['notificacoes'],
    queryFn: () => api.get('/notificacoes'),
    refetchInterval: 5 * 60_000,
  });
  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, []);
  const ler = async (id: string | 'todas') => {
    await api.post(id === 'todas' ? '/notificacoes/lidas' : `/notificacoes/${id}/lida`);
    qc.invalidateQueries({ queryKey: ['notificacoes'] });
  };
  const n = data?.naoLidas ?? 0;
  return (
    <div ref={ref} className="relative">
      <button className="btn-secundario relative px-2.5" onClick={() => setAberto(!aberto)} aria-label={`Notificações: ${n} não lida(s)`} aria-expanded={aberto}>
        {n > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {n > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-5 text-white tabular-nums">{n > 99 ? '99+' : n}</span>}
      </button>
      {aberto && (
        <div className="absolute right-0 top-12 z-30 w-[min(26rem,calc(100vw-2rem))] animate-surgir overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-elevado">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="font-semibold">Avisos de prazos</span>
            {n > 0 && <button className="text-xs font-medium text-marca-700 hover:underline" onClick={() => ler('todas')}>Marcar todos como lidos</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.itens.length && <div className="px-4 py-8 text-center text-slate-500">Nenhum aviso novo.</div>}
            {data?.itens.map((i: any) => (
              <div key={i.id} className="flex items-start gap-3 border-b border-slate-50 px-4 py-2.5 hover:bg-slate-50">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${i.estado === 'atrasado' ? 'bg-red-500' : 'bg-amber-400'}`} />
                <button className="min-w-0 flex-1 text-left" onClick={() => { setAberto(false); ler(i.id); if (i.link) nav(i.link); }}>
                  <div className="font-medium text-tinta">{i.titulo}</div>
                  <div className="text-xs text-slate-500">
                    {i.estado === 'atrasado' ? 'Atrasado' : 'Vence'} em {i.data?.split('-').reverse().join('/')} · {data.categorias[i.categoria]}{i.empresa ? ` · ${i.empresa}` : ''}
                  </div>
                </button>
                <button className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" title="Marcar como lido" aria-label="Marcar como lido" onClick={() => ler(i.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-slate-100 px-4 py-2 text-xs">
            <Link to="/calendario" className="font-medium text-marca-700 hover:underline" onClick={() => setAberto(false)}>Ver calendário</Link>
            <Link to="/alertas" className="text-slate-500 hover:text-tinta" onClick={() => setAberto(false)}>Escolher avisos</Link>
          </div>
        </div>
      )}
    </div>
  );
}
