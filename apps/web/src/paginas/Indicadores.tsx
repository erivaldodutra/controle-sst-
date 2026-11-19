import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ClipboardCheck, FileWarning, HeartPulse, ListTodo, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { BarrasPercentuais, ColunasMensais } from '../componentes/graficos';
import { Indicador } from '../componentes/Indicador';
import { Aviso, Carregando, Titulo } from '../componentes/ui';
import { BarraSituacao } from './Inicio';

const PERIODOS = [6, 12, 24];

/** Painel executivo: todos os números saem dos registros atuais, com o filtro de empresa do topo e o período escolhido. */
export function Indicadores() {
  const s = useSessao();
  const nav = useNavigate();
  const [meses, setMeses] = useState(12);
  const [erro, setErro] = useState<unknown>();
  const [pedindo, setPedindo] = useState(false);
  const q = useQuery({
    queryKey: ['indicadores', s.empresaId, meses],
    queryFn: () => api.get(`/indicadores${qs({ empresaId: s.empresaId, meses })}`),
  });
  const ia = useQuery({ queryKey: ['ia-config'], queryFn: () => api.get('/ia/config'), enabled: s.pode('ia.usar') });
  const d = q.data;
  const resumoIa = async () => {
    setErro(undefined);
    setPedindo(true);
    try {
      const r = await api.post(`/ia/empresas/${s.empresaId}/resumo`);
      nav(`/ia?sugestao=${r.id}`);
    } catch (x) { setErro(x); } finally { setPedindo(false); }
  };
  const doc = d?.documentos ?? {};
  const oc = d?.ocorrenciasPorMes;
  return (
    <>
      <Titulo
        titulo="Indicadores"
        subtitulo={`${s.empresaId ? 'Empresa selecionada no topo' : 'Todas as empresas que você acessa'} · calculado agora a partir dos cadastros, sem números digitados à parte`}
        acoes={<>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p} className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${meses === p ? 'bg-marca-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setMeses(p)} aria-pressed={meses === p}>{p} meses</button>
            ))}
          </div>
          {s.pode('ia.usar') && ia.data?.ativo && (
            <button className="btn-secundario" disabled={!s.empresaId || pedindo} onClick={resumoIa} title={s.empresaId ? '' : 'Escolha uma empresa no topo'}>
              <Sparkles size={15} /> {pedindo ? 'Pedindo resumo…' : 'Resumo com IA'}
            </button>
          )}
        </>}
      />
      <Aviso erro={erro ?? q.error} />
      {!d ? <Carregando /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {d.acoes && <Indicador rotulo="Ações atrasadas" valor={d.acoes.atrasadas} para="/acoes?situacao=atrasadas" icone={<ListTodo size={20} />} tom="vermelho" alerta />}
            {d.documentos && <Indicador rotulo="Documentos vencidos ou pendentes" valor={(doc.vencido ?? 0) + (doc.pendente ?? 0)} para="/documentos" icone={<FileWarning size={20} />} tom="vermelho" alerta />}
            {oc && <Indicador rotulo={`Acidentes em ${meses} meses`} valor={oc.acidentes} para="/inspecoes?aba=ocorrencias" icone={<AlertTriangle size={20} />} tom="ambar" alerta />}
            {oc && (
              <div className="cartao flex h-full items-start gap-4 p-4 sm:p-5">
                <div className="hidden size-11 shrink-0 place-items-center rounded-xl bg-marca-50 text-marca-600 ring-1 ring-inset ring-marca-100 sm:grid"><CalendarClock size={20} /></div>
                <div>
                  <div className="text-[13px] font-medium leading-snug text-slate-500">Dias sem acidente com afastamento</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{oc.diasSemAfastamento ?? '—'}</div>
                  {oc.diasSemAfastamento == null && <div className="text-xs text-slate-400">Nenhum registrado</div>}
                </div>
              </div>
            )}
            {d.esocial && <Indicador rotulo="Eventos do eSocial com erro ou rejeitados" valor={(d.esocial.porSituacao.invalido ?? 0) + (d.esocial.porSituacao.rejeitado ?? 0)} para="/esocial?aba=eventos" icone={<Send size={20} />} tom="vermelho" alerta />}
            {d.esocial && <Indicador rotulo="Eventos aguardando aprovação" valor={d.esocial.porSituacao.pendente ?? 0} para="/esocial?aba=eventos" icone={<ClipboardCheck size={20} />} tom="ambar" alerta />}
            {d.saude?.aso && <Indicador rotulo="ASO vencido ou ausente" valor={(d.saude.aso.vencido ?? 0) + (d.saude.aso.sem_aso ?? 0)} para="/vencimentos?tipo=aso" icone={<HeartPulse size={20} />} tom="vermelho" alerta />}
            {oc && <Indicador rotulo="Ocorrências em aberto" valor={oc.abertas} para="/inspecoes?aba=ocorrencias" icone={<AlertTriangle size={20} />} tom="ambar" alerta />}
          </div>

          {d.saude && (
            <section className="cartao p-5">
              <h3 className="mb-4 text-sm font-semibold text-tinta">Saúde e treinamentos (funcionários ativos e afastados)</h3>
              <div className="grid gap-6 md:grid-cols-2">
                {s.pode('saude.ler') && <BarraSituacao titulo="ASO periódico" resumo={d.saude.aso} para="/vencimentos?tipo=aso" />}
                {s.pode('treinamentos.ler') && <BarraSituacao titulo="Treinamentos exigidos" resumo={d.saude.treinamento} para="/vencimentos?tipo=treinamento" />}
              </div>
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {d.acoesPorMes && (
              <ColunasMensais titulo="Ações abertas e concluídas por mês" dados={d.acoesPorMes}
                series={[{ chave: 'abertas', rotulo: 'Abertas' }, { chave: 'concluidas', rotulo: 'Concluídas' }]} />
            )}
            {oc && (
              <ColunasMensais titulo="Ocorrências por mês" dados={oc.porMes} empilhado
                series={[{ chave: 'acidentes', rotulo: 'Acidentes e doenças' }, { chave: 'incidentes', rotulo: 'Incidentes e quase acidentes' }, { chave: 'outras', rotulo: 'Outras' }]} />
            )}
            {d.esocial && (
              <ColunasMensais titulo="Eventos do eSocial processados por mês" dados={d.esocial.processadosPorMes} empilhado
                series={['S-2210', 'S-2220', 'S-2240', 'S-3000'].map((t) => ({ chave: t, rotulo: t }))} vazio="Nenhum evento processado no período." />
            )}
            {d.conformidade && (
              <BarrasPercentuais titulo="Conformidade legal por empresa" vazio="Nenhuma empresa com requisitos."
                itens={d.conformidade.empresas.map((e: any) => ({ id: e.id, rotulo: e.razaoSocial, valor: e.percentual }))} />
            )}
          </div>
          {oc && <p className="text-xs text-slate-500">Acidentes incluem típico, de trajeto e doença ocupacional. Dias sem afastamento contam desde o último acidente típico ou doença com afastamento.</p>}
        </div>
      )}
    </>
  );
}
