import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Carregando, Titulo } from '../componentes/ui';

function Indicador({ rotulo, valor, para }: { rotulo: string; valor: number; para?: string }) {
  const corpo = (
    <div className="cartao p-4 transition hover:border-marca-500">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor.toLocaleString('pt-BR')}</div>
    </div>
  );
  return para ? <Link to={para}>{corpo}</Link> : corpo;
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
        <div className="cartao p-8 text-center">
          <h2 className="font-semibold">Comece cadastrando uma empresa</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Depois cadastre os estabelecimentos, a estrutura (setores, funções e GHE) e os funcionários, um a um ou por planilha.
          </p>
          {s.podeGlobal('empresas.editar') && <Link to="/empresas?nova=1" className="btn-primario mt-4">Cadastrar empresa</Link>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="Empresas ativas" valor={data.empresas} para="/empresas" />
          <Indicador rotulo="Estabelecimentos" valor={data.estabelecimentos} />
          <Indicador rotulo="Funcionários ativos" valor={data.ativos} para="/funcionarios?situacao=ativo" />
          <Indicador rotulo="Afastados" valor={data.afastados} para="/funcionarios?situacao=afastado" />
          <Indicador rotulo="Desligados" valor={data.desligados} para="/funcionarios?situacao=desligado" />
          <Indicador rotulo="Admissões nos últimos 30 dias" valor={data.admissoes30Dias} />
        </div>
      )}
      <p className="mt-6 text-xs text-slate-500">
        Os indicadores de ASO, treinamentos, documentos, planos de ação e eSocial aparecem aqui conforme cada módulo for entregue.
      </p>
    </>
  );
}
