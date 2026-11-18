import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { Permissao } from '@sst/shared';
import { api, definirAoExpirar } from './api';

export interface Eu {
  id: string;
  nome: string;
  email: string;
  deveTrocarSenha: boolean;
  empresas: '*' | string[];
  permissoes: Permissao[];
  atribuicoes: { perfil: string; empresaId: string | null }[];
}

interface Sessao {
  eu: Eu;
  pode: (p: Permissao) => boolean;
  podeGlobal: (p: Permissao) => boolean;
  empresaId: string | null;
  setEmpresaId: (id: string | null) => void;
  empresas: { id: string; razaoSocial: string; nomeFantasia: string | null }[];
  sair: () => Promise<void>;
}

const Ctx = createContext<Sessao | null>(null);
export const useSessao = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('Sessão ausente');
  return c;
};

const CHAVE_EMPRESA = 'sst.empresaSelecionada';

export function ProvedorSessao({ eu, children, aoSair }: { eu: Eu; children: ReactNode; aoSair: () => void }) {
  const qc = useQueryClient();
  const { data: empresas = [] } = useQuery({ queryKey: ['empresas', 'seletor'], queryFn: () => api.get('/empresas') });
  const [empresaId, setEmpresaIdEstado] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CHAVE_EMPRESA);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (empresaId && empresas.length && !empresas.some((e: any) => e.id === empresaId)) setEmpresaIdEstado(null);
  }, [empresas, empresaId]);
  useEffect(() => definirAoExpirar(aoSair), [aoSair]);

  const valor = useMemo<Sessao>(
    () => ({
      eu,
      pode: (p) => eu.permissoes.includes(p),
      podeGlobal: (p) =>
        eu.atribuicoes.some((a) => a.empresaId === null) && eu.permissoes.includes(p),
      empresaId,
      setEmpresaId: (id) => {
        setEmpresaIdEstado(id);
        try {
          if (id) localStorage.setItem(CHAVE_EMPRESA, id);
          else localStorage.removeItem(CHAVE_EMPRESA);
        } catch {
          /* armazenamento indisponível: segue sem lembrar */
        }
      },
      empresas,
      sair: async () => {
        await api.post('/auth/logout').catch(() => {});
        qc.clear();
        aoSair();
      },
    }),
    [eu, empresaId, empresas, qc, aoSair],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
