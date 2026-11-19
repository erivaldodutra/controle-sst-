import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './componentes/Layout';
import { Carregando } from './componentes/ui';
import { api, ErroApi } from './lib/api';
import { Eu, ProvedorSessao } from './lib/sessao';
import { ConfiguracaoInicial, Login, TrocaObrigatoria } from './paginas/Acesso';
import { Auditoria } from './paginas/Auditoria';
import { Backup } from './paginas/Backup';
import { EmpresaDetalhe, Empresas } from './paginas/Empresas';
import { Estrutura } from './paginas/Estrutura';
import { FuncionarioFicha } from './paginas/FuncionarioFicha';
import { Funcionarios } from './paginas/Funcionarios';
import { Importacoes } from './paginas/Importacoes';
import { Inicio } from './paginas/Inicio';
import { MinhaConta } from './paginas/MinhaConta';
import { Usuarios } from './paginas/Usuarios';
import { Asos } from './paginas/Asos';
import { CadastrosSaude } from './paginas/CadastrosSaude';
import { Treinamentos } from './paginas/Treinamentos';
import { Turma } from './paginas/Turma';
import { Vencimentos } from './paginas/Vencimentos';
import { Documento } from './paginas/Documento';
import { Documentos } from './paginas/Documentos';
import { Acao } from './paginas/Acao';
import { Acoes } from './paginas/Acoes';
import { Conformidade } from './paginas/Conformidade';
import { Inspecao } from './paginas/Inspecao';
import { Indicadores } from './paginas/Indicadores';
import { Calendario } from './paginas/Calendario';
import { Relatorios } from './paginas/Relatorios';
import { RegrasAlerta } from './paginas/RegrasAlerta';
import { Seguranca } from './paginas/Seguranca';
import { AssistenteIa } from './paginas/AssistenteIa';
import { Inspecoes } from './paginas/Inspecoes';
import { Ocorrencia } from './paginas/Ocorrencia';
import { Esocial } from './paginas/Esocial';
import { EsocialEvento } from './paginas/EsocialEvento';
import { EsocialLotes } from './paginas/EsocialLotes';
import { EsocialConfig } from './paginas/EsocialConfig';
import { AgentesNocivos } from './paginas/AgentesNocivos';
import './estilo.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ErroApi && e.status < 500) && n < 2, refetchOnWindowFocus: false },
  },
});

function App() {
  const estado = useQuery({ queryKey: ['estado'], queryFn: () => api.get<{ configurado: boolean }>('/auth/estado') });
  const eu = useQuery({
    queryKey: ['eu'],
    queryFn: () => api.get<Eu>('/auth/eu'),
    enabled: estado.data?.configurado === true,
    retry: false,
  });
  const recarregar = useCallback(() => {
    qc.clear();
    estado.refetch();
    eu.refetch();
  }, [estado, eu]);
  const aoSair = useCallback(() => {
    qc.setQueryData(['eu'], null);
    qc.removeQueries({ queryKey: ['eu'] });
    eu.refetch();
  }, [eu]);

  if (estado.isLoading) return <Carregando />;
  if (estado.isError) return <div className="p-8 text-center text-red-700">Não foi possível iniciar o sistema. Feche e abra novamente.</div>;
  if (!estado.data?.configurado) return <ConfiguracaoInicial aoConcluir={recarregar} />;
  if (eu.isLoading) return <Carregando />;
  if (!eu.data) return <Login aoEntrar={recarregar} />;
  if (eu.data.deveTrocarSenha) return <TrocaObrigatoria aoConcluir={recarregar} />;

  return (
    <ProvedorSessao eu={eu.data} aoSair={aoSair}>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/empresas" element={<Empresas />} />
            <Route path="/empresas/:id" element={<EmpresaDetalhe />} />
            <Route path="/estrutura" element={<Estrutura />} />
            <Route path="/funcionarios" element={<Funcionarios />} />
            <Route path="/funcionarios/:id" element={<FuncionarioFicha />} />
            <Route path="/importacoes" element={<Importacoes />} />
            <Route path="/vencimentos" element={<Vencimentos />} />
            <Route path="/asos" element={<Asos />} />
            <Route path="/saude/cadastros" element={<CadastrosSaude />} />
            <Route path="/treinamentos" element={<Treinamentos />} />
            <Route path="/turmas/:id" element={<Turma />} />
            <Route path="/documentos" element={<Documentos />} />
            <Route path="/documentos/:id" element={<Documento />} />
            <Route path="/acoes" element={<Acoes />} />
            <Route path="/acoes/:id" element={<Acao />} />
            <Route path="/inspecoes" element={<Inspecoes />} />
            <Route path="/inspecoes/:id" element={<Inspecao />} />
            <Route path="/ocorrencias/:id" element={<Ocorrencia />} />
            <Route path="/conformidade" element={<Conformidade />} />
            <Route path="/esocial" element={<Esocial />} />
            <Route path="/esocial/eventos/:id" element={<EsocialEvento />} />
            <Route path="/esocial/lotes" element={<EsocialLotes />} />
            <Route path="/esocial/agentes" element={<AgentesNocivos />} />
            <Route path="/esocial/config" element={<EsocialConfig />} />
            <Route path="/indicadores" element={<Indicadores />} />
            <Route path="/calendario" element={<Calendario />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/alertas" element={<RegrasAlerta />} />
            <Route path="/seguranca" element={<Seguranca />} />
            <Route path="/ia" element={<AssistenteIa />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/auditoria" element={<Auditoria />} />
            <Route path="/backup" element={<Backup />} />
            <Route path="/minha-conta" element={<MinhaConta />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </HashRouter>
    </ProvedorSessao>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
