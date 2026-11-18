import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, Building2, ClipboardList, DatabaseBackup, FileSpreadsheet, GraduationCap, HeartPulse, LayoutDashboard, LogOut, Network,
  Search, ShieldCheck, Stethoscope, UserCog, Users,
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
  { titulo: 'Painel', itens: [{ para: '/', rotulo: 'Início', icone: <LayoutDashboard size={17} />, permissao: 'empresas.ler' }] },
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
    titulo: 'Administração',
    itens: [
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
                    end={i.para === '/'}
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
