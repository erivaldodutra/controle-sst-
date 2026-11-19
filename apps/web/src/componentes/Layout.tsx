import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, Building2, ClipboardList, DatabaseBackup, FileSpreadsheet, GraduationCap, HeartPulse, LayoutDashboard, LogOut, Network,
  FileText, Search, ShieldCheck, Stethoscope, UserCog, Users,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
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
    titulo: 'Programas legais',
    itens: [
      { para: '/documentos', rotulo: 'Programas e documentos', icone: <FileText size={17} />, permissao: 'documentos.ler' },
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

export function Layout({ children }: { children: ReactNode }) {
  const s = useSessao();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <ShieldCheck className="text-marca-600" size={24} />
          <span className="font-semibold">Controle SST</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {GRUPOS.map((g) => {
            const itens = g.itens.filter((i) => s.pode(i.permissao));
            if (!itens.length) return null;
            return (
              <div key={g.titulo} className="mt-4">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.titulo}</div>
                {itens.map((i) => (
                  <NavLink
                    key={i.para}
                    to={i.para}
                    end={i.para === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive ? 'bg-marca-50 font-medium text-marca-700' : 'text-slate-600 hover:bg-slate-50'}`
                    }
                  >
                    {i.icone}
                    {i.rotulo}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3 text-sm">
          <Link to="/minha-conta" className="block truncate font-medium hover:underline">{s.eu.nome}</Link>
          <div className="truncate text-xs text-slate-500">{s.eu.email}</div>
          <button className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-red-600" onClick={s.sair}>
            <LogOut size={13} /> Sair
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:px-6">
          <select
            className="campo max-w-xs"
            value={s.empresaId ?? ''}
            onChange={(e) => s.setEmpresaId(e.target.value || null)}
            aria-label="Empresa"
          >
            <option value="">Todas as empresas</option>
            {s.empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>
            ))}
          </select>
          <BuscaGlobal />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
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
    <div ref={ref} className="relative min-w-48 flex-1 md:max-w-md">
      <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
      <input
        className="campo pl-8"
        placeholder="Buscar funcionário (nome, CPF, matrícula) ou empresa"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
      />
      {aberta && termo.length >= 2 && data && (
        <div className="absolute left-0 right-0 top-11 z-30 max-h-96 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {data.empresas.length + data.funcionarios.length === 0 && <div className="px-3 py-3 text-slate-500">Nada encontrado</div>}
          {data.funcionarios.map((f: any) => (
            <button key={f.id} className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => ir(`/funcionarios/${f.id}`)}>
              <div className="font-medium">{f.nome}</div>
              <div className="text-xs text-slate-500">CPF {cpf(f.cpf)} · Matr. {f.matricula ?? '—'} · {f.empresa}</div>
            </button>
          ))}
          {data.empresas.map((e: any) => (
            <button key={e.id} className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => ir(`/empresas/${e.id}`, e.id)}>
              <div className="font-medium">{e.razaoSocial}</div>
              <div className="text-xs text-slate-500">Empresa</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
