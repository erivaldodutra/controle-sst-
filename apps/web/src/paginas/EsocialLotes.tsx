import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { dataBr, dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Ambiente, ListaMensagens, SituacaoEvento, SituacaoLote } from '../componentes/esocial';
import { Aviso, Carregando, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';
import { FaixaAmbiente } from './Esocial';

function DetalheLote({ id }: { id: string }) {
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [erro, setErro] = useState<unknown>();
  const [consultando, setConsultando] = useState(false);
  const q = useQuery({ queryKey: ['esocial-lote', id], queryFn: () => api.get(`/esocial/lotes/${id}`) });
  const l = q.data;
  if (q.error) return <Aviso erro={q.error} />;
  if (!l) return <Carregando />;
  const consultar = async () => {
    setErro(undefined);
    setConsultando(true);
    try {
      qc.setQueryData(['esocial-lote', id], await api.post(`/esocial/lotes/${id}/consulta`));
      qc.invalidateQueries({ queryKey: ['esocial-lotes'] });
      qc.invalidateQueries({ queryKey: ['esocial-eventos'] });
      qc.invalidateQueries({ queryKey: ['esocial-evento'] });
      qc.invalidateQueries({ queryKey: ['esocial-painel'] });
    } catch (x) { setErro(x); } finally { setConsultando(false); }
  };
  return (
    <>
      <Aviso erro={erro} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <SituacaoLote s={l.situacao} /><Ambiente a={l.ambiente} />
        <span className="text-slate-600">{l.eventos} evento(s) · enviado por {l.enviadoPorNome ?? '—'} em {dataHoraBr(l.enviadoEm)}</span>
        {['aguardando', 'enviando'].includes(l.situacao) && l.protocolo && s.pode('esocial.transmitir') && (
          <button className="btn-primario ml-auto" disabled={consultando} onClick={consultar}>
            <RefreshCw size={15} className={consultando ? 'animate-spin' : ''} /> {consultando ? 'Consultando…' : 'Consultar retorno'}
          </button>
        )}
      </div>
      <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><span className="text-slate-500">Protocolo: </span><span className="font-mono">{l.protocolo ?? '—'}</span></div>
        <div><span className="text-slate-500">Resposta: </span>{l.cdResposta ? `${l.cdResposta} · ${l.descResposta ?? ''}` : '—'}</div>
        <div><span className="text-slate-500">Consultas feitas: </span>{l.consultas ?? 0}{l.consultadoEm ? ` (última ${dataHoraBr(l.consultadoEm)})` : ''}</div>
        <div><span className="text-slate-500">Processado em: </span>{dataHoraBr(l.processadoEm)}</div>
      </dl>
      {l.situacao === 'aguardando' && <Aviso tipo="info">O eSocial recebeu o lote e processa em alguns minutos. Use "Consultar retorno" para buscar o resultado.</Aviso>}
      {l.situacao === 'falha_comunicacao' && <Aviso tipo="info">Não houve comunicação com o eSocial. Os eventos voltaram para "aprovado" e podem ser enviados de novo.</Aviso>}
      <ListaMensagens titulo="Ocorrências do lote" itens={l.ocorrencias ?? []} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="tabela">
          <thead><tr><th>Evento</th><th>Trabalhador</th><th>Referência</th><th>Situação</th><th>Recibo</th></tr></thead>
          <tbody>{l.eventosLista.map((e: any) => (
            <tr key={e.id} className="cursor-pointer" onClick={() => nav(`/esocial/eventos/${e.id}`)}>
              <td><div className="font-medium">{e.tipo}</div><div className="font-mono text-[11px] text-slate-500">{e.idEvento}</div></td>
              <td>{e.funcionarioNome ?? '—'}</td>
              <td>{dataBr(e.referencia)}</td>
              <td><SituacaoEvento s={e.situacao} />{e.ocorrencias?.length > 0 && <div className="mt-0.5 text-[11px] text-slate-500">{e.ocorrencias.length} ocorrência(s)</div>}</td>
              <td className="font-mono text-xs">{e.nrRecibo ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

export function EsocialLotes() {
  const s = useSessao();
  const [params, setParams] = useSearchParams();
  const lote = params.get('lote');
  const q = useQuery({
    queryKey: ['esocial-lotes', s.empresaId],
    queryFn: () => api.get(`/esocial/lotes${qs({ empresaId: s.empresaId })}`),
    enabled: !!s.empresaId,
  });
  return (
    <>
      <Link to="/esocial?aba=eventos" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-tinta"><ArrowLeft size={15} /> Central de eventos</Link>
      <Titulo titulo="Lotes e retornos" subtitulo="Cada envio ao eSocial forma um lote com protocolo. O evento só é considerado processado quando o governo devolve o recibo." />
      <ExigeEmpresa empresaId={s.empresaId}>
        <FaixaAmbiente empresaId={s.empresaId!} />
        <div className="cartao overflow-x-auto">
          {q.isLoading ? <Carregando /> : !q.data?.length ? <Vazio>Nenhum lote enviado ainda. Aprove eventos na Central de eventos e use "Enviar aprovados".</Vazio> : (
            <table className="tabela">
              <thead><tr><th>Enviado em</th><th>Ambiente</th><th>Eventos</th><th>Protocolo</th><th>Situação</th><th>Resposta</th></tr></thead>
              <tbody>{q.data.map((l: any) => (
                <tr key={l.id} className="cursor-pointer" onClick={() => setParams({ lote: l.id })}>
                  <td>{dataHoraBr(l.enviadoEm)}<div className="text-xs text-slate-500">{l.enviadoPorNome}</div></td>
                  <td><Ambiente a={l.ambiente} /></td>
                  <td>{l.eventos}</td>
                  <td className="font-mono text-xs">{l.protocolo ?? '—'}</td>
                  <td><SituacaoLote s={l.situacao} /></td>
                  <td className="max-w-xs truncate text-sm" title={l.descResposta ?? ''}>{l.cdResposta ? `${l.cdResposta} · ${l.descResposta ?? ''}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </ExigeEmpresa>
      <Modal titulo="Lote do eSocial" aberto={!!lote} aoFechar={() => setParams({})}>
        {lote && <DetalheLote id={lote} />}
      </Modal>
    </>
  );
}
