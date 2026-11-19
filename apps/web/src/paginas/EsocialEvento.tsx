import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FilePenLine, RefreshCw, RotateCcw, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TIPOS_EVENTO_ESOCIAL } from '@sst/shared';
import { api } from '../lib/api';
import { cpf, dataBr, dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Ambiente, baixar, ListaMensagens, SituacaoEvento, SituacaoLote } from '../componentes/esocial';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Modal, Titulo } from '../componentes/ui';

/** Indenta o XML só para leitura na tela (o arquivo baixado é o original). */
function formatarXml(xml: string) {
  let nivel = 0;
  return xml.replace(/>\s*</g, '>\n<').split('\n').map((l) => {
    if (/^<\/[^>]+>$/.test(l)) nivel = Math.max(nivel - 1, 0);
    const linha = '  '.repeat(nivel) + l;
    if (/^<[^!?/][^>]*[^/]>$/.test(l) && !/<\/[^>]+>$/.test(l.slice(1))) nivel++;
    return linha;
  }).join('\n');
}

type Janela = null | 'aprovar' | 'descartar' | 'retificar' | 'excluir' | 'desaprovar';

const Linha = ({ r, children }: { r: string; children: React.ReactNode }) => (
  <div className="flex gap-2 py-1"><dt className="w-40 shrink-0 text-slate-500">{r}</dt><dd className="min-w-0 break-words">{children}</dd></div>
);

export function EsocialEvento() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [janela, setJanela] = useState<Janela>(null);
  const [erro, setErro] = useState<unknown>();
  const [verXml, setVerXml] = useState(false);
  const q = useQuery({ queryKey: ['esocial-evento', id], queryFn: () => api.get(`/esocial/eventos/${id}`) });
  const e = q.data;
  if (q.error) return <Aviso erro={q.error} />;
  if (!e) return <Carregando />;
  const preparar = s.pode('esocial.preparar');
  const transmitir = s.pode('esocial.transmitir');
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['esocial-evento'] });
    qc.invalidateQueries({ queryKey: ['esocial-eventos'] });
    qc.invalidateQueries({ queryKey: ['esocial-pendencias'] });
    qc.invalidateQueries({ queryKey: ['esocial-painel'] });
  };
  /** Ações que geram outro evento abrem o novo evento. */
  const acao = async (url: string, corpo?: unknown) => {
    setErro(undefined);
    try {
      const r = await api.post(url, corpo);
      atualizar();
      setJanela(null);
      if (r?.id && r.id !== e.id) nav(`/esocial/eventos/${r.id}`);
    } catch (x) { setErro(x); setJanela(null); }
  };
  const xml = async (qual?: 'recibo') => {
    setErro(undefined);
    try { await baixar(`/esocial/eventos/${e.id}/xml${qual ? '?qual=recibo' : ''}`, `${e.tipo} ${e.idEvento}${qual ? ' recibo' : ''}.xml`); } catch (x) { setErro(x); }
  };
  const aberto = ['invalido', 'pendente'].includes(e.situacao);
  return (
    <>
      <Link to="/esocial?aba=eventos" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-tinta"><ArrowLeft size={15} /> Central de eventos</Link>
      <Titulo
        titulo={`${e.tipo} · ${TIPOS_EVENTO_ESOCIAL[e.tipo as keyof typeof TIPOS_EVENTO_ESOCIAL] ?? ''}${e.indRetif === 2 ? ' (retificação)' : ''}`}
        subtitulo={e.resumo}
        acoes={<>
          <SituacaoEvento s={e.situacao} /><Ambiente a={e.ambiente} />
          {aberto && preparar && e.tipo !== 'S-3000' && <button className="btn-secundario" onClick={() => acao(`/esocial/eventos/${e.id}/refazer`)}><RefreshCw size={15} /> Gerar de novo</button>}
          {e.situacao === 'pendente' && !e.erros.length && transmitir && <button className="btn-primario" onClick={() => setJanela('aprovar')}><ShieldCheck size={15} /> Aprovar e assinar</button>}
          {e.situacao === 'aprovado' && transmitir && <button className="btn-secundario" onClick={() => setJanela('desaprovar')}><Undo2 size={15} /> Voltar para aprovação</button>}
          {e.situacao === 'processado' && e.tipo !== 'S-3000' && preparar && <>
            <button className="btn-secundario" onClick={() => setJanela('retificar')}><FilePenLine size={15} /> Retificar</button>
            <button className="btn-secundario" onClick={() => setJanela('excluir')}><RotateCcw size={15} /> Excluir no eSocial</button>
          </>}
          {['invalido', 'pendente', 'aprovado', 'rejeitado'].includes(e.situacao) && (e.situacao === 'aprovado' ? transmitir : preparar) &&
            <button className="btn-secundario" onClick={() => setJanela('descartar')}><Trash2 size={15} /> Descartar</button>}
        </>}
      />
      <Aviso erro={erro} />
      {e.situacao === 'invalido' && <Aviso tipo="info">O evento não passou na validação. Corrija o cadastro de origem e use "Gerar de novo".</Aviso>}
      {e.situacao === 'rejeitado' && <Aviso tipo="info">O eSocial recusou este evento. Corrija o cadastro de origem e gere um novo evento pelas pendências; este pode ser descartado.</Aviso>}
      <ListaMensagens titulo="Erros de validação (esquema oficial e regras do leiaute)" itens={e.erros} />
      <ListaMensagens titulo={e.situacao === 'processado' ? 'Advertências do eSocial' : 'Ocorrências devolvidas pelo eSocial'} itens={e.ocorrencias ?? []}
        cor={e.situacao === 'processado' ? 'amber' : 'red'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cartao p-5 text-sm">
          <h2 className="mb-2 font-semibold">Identificação</h2>
          <dl>
            <Linha r="Empresa">{e.empresaNome}</Linha>
            {e.funcionarioNome && <Linha r="Trabalhador">{e.funcionarioNome} · CPF {cpf(e.funcionarioCpf)} · matrícula {e.matricula}</Linha>}
            <Linha r="Data de referência">{dataBr(e.referencia)}</Linha>
            <Linha r="Id do evento"><span className="font-mono text-xs">{e.idEvento}</span></Linha>
            <Linha r="Gerado em">{dataHoraBr(e.criadoEm)}</Linha>
            {e.eventoOrigemId && (
              <Linha r={e.tipo === 'S-3000' ? 'Evento excluído' : 'Evento original'}>
                <Link className="text-marca-700 hover:underline" to={`/esocial/eventos/${e.eventoOrigemId}`}>{e.origemTipo} · recibo {e.origemRecibo}</Link>
              </Linha>
            )}
            {e.asoId && <Linha r="Origem">ASO do trabalhador</Linha>}
            {e.catId && <Linha r="Origem">CAT da ocorrência</Linha>}
          </dl>
        </section>
        <section className="cartao p-5 text-sm">
          <h2 className="mb-2 font-semibold">Aprovação e retorno</h2>
          <dl>
            <Linha r="Prazo legal">{e.prazo ? dataBr(e.prazo) : '—'}</Linha>
            <Linha r="Aprovado por">{e.aprovadoEm ? `${e.aprovadoPorNome} em ${dataHoraBr(e.aprovadoEm)}` : '—'}</Linha>
            <Linha r="Recibo">{e.nrRecibo ? <span className="font-mono">{e.nrRecibo}</span> : '—'}</Linha>
            <Linha r="Processado em">{dataHoraBr(e.processadoEm)}</Linha>
            {e.cdResposta && <Linha r="Código de resposta">{e.cdResposta}</Linha>}
            {e.canceladoEm && <Linha r="Descartado">{dataHoraBr(e.canceladoEm)} · {e.motivoCancelamento}</Linha>}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {(e.xml || e.tipo !== 'S-2210') && <button className="btn-secundario" onClick={() => xml()}><Download size={15} /> XML do evento{e.situacao !== 'pendente' && e.situacao !== 'invalido' ? ' assinado' : ''}</button>}
            {e.nrRecibo && <button className="btn-secundario" onClick={() => xml('recibo')}><Download size={15} /> XML do recibo</button>}
          </div>
        </section>
      </div>
      {e.lotes?.length > 0 && (
        <section className="cartao mt-4 overflow-x-auto">
          <h2 className="px-5 pt-4 text-sm font-semibold">Lotes em que foi enviado</h2>
          <table className="tabela mt-2">
            <thead><tr><th>Enviado em</th><th>Protocolo</th><th>Situação</th></tr></thead>
            <tbody>{e.lotes.map((l: any) => (
              <tr key={l.id} className="cursor-pointer" onClick={() => nav(`/esocial/lotes?lote=${l.id}`)}>
                <td>{dataHoraBr(l.enviadoEm)}</td><td className="font-mono text-xs">{l.protocolo ?? '—'}</td><td><SituacaoLote s={l.situacao} /></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      {e.derivados?.length > 0 && (
        <section className="cartao mt-4 overflow-x-auto">
          <h2 className="px-5 pt-4 text-sm font-semibold">Retificações e exclusões deste evento</h2>
          <table className="tabela mt-2">
            <thead><tr><th>Evento</th><th>Gerado em</th><th>Situação</th><th>Recibo</th></tr></thead>
            <tbody>{e.derivados.map((d: any) => (
              <tr key={d.id} className="cursor-pointer" onClick={() => nav(`/esocial/eventos/${d.id}`)}>
                <td>{d.tipo}</td><td>{dataHoraBr(d.criadoEm)}</td><td><SituacaoEvento s={d.situacao} /></td><td className="font-mono text-xs">{d.nrRecibo ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <section className="cartao mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Conteúdo do evento (XML)</h2>
          {e.xml && <button className="btn-secundario" onClick={() => setVerXml(!verXml)}>{verXml ? 'Ocultar' : 'Mostrar'}</button>}
        </div>
        {!e.xml ? <p className="mt-2 text-sm text-slate-500">O XML da CAT contém dados clínicos e só aparece para quem tem acesso a eles.</p>
          : verXml && <pre className="mt-3 max-h-[32rem] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{formatarXml(e.xml)}</pre>}
      </section>

      <Modal titulo="Aprovar e assinar" aberto={janela === 'aprovar'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'aprovar' && (
          <Formulario botao="Aprovar e assinar" aoEnviar={async () => { await api.post('/esocial/aprovacao', { ids: [e.id] }); atualizar(); setJanela(null); }}>
            <p className="text-sm text-slate-700">
              Ao aprovar, você confirma que conferiu as informações deste evento. Ele será assinado com o certificado digital da empresa e ficará
              pronto para envio. Nada é enviado nesta etapa.
            </p>
            <p className="text-sm">Ambiente: <Ambiente a={e.ambiente} /></p>
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Voltar para aprovação" aberto={janela === 'desaprovar'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'desaprovar' && (
          <Formulario botao="Voltar para aprovação" aoEnviar={async () => { await api.post(`/esocial/eventos/${e.id}/desaprovar`); atualizar(); setJanela(null); }}>
            <p className="text-sm text-slate-700">A assinatura é removida e o evento volta a aguardar aprovação. Use quando perceber algo a corrigir antes do envio.</p>
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Descartar evento" aberto={janela === 'descartar'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'descartar' && <FormMotivo aoEnviar={(motivo) => acao(`/esocial/eventos/${e.id}/descartar`, { motivo })} />}
      </Modal>
      <Modal titulo="Retificar evento" aberto={janela === 'retificar'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'retificar' && (
          <Formulario botao="Gerar retificação" aoEnviar={() => acao(`/esocial/eventos/${e.id}/retificar`)}>
            <p className="text-sm text-slate-700">
              Corrija primeiro o cadastro de origem (ASO, agentes do GHE ou CAT). A retificação é gerada com os dados atuais, apontando para o
              recibo {e.nrRecibo}, e também precisa de aprovação antes do envio.
            </p>
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Excluir evento no eSocial (S-3000)" aberto={janela === 'excluir'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'excluir' && (
          <Formulario perigo botao="Gerar S-3000" aoEnviar={() => acao(`/esocial/eventos/${e.id}/excluir`)}>
            <p className="text-sm text-slate-700">
              Gera um evento de exclusão (S-3000) do recibo {e.nrRecibo}. Ele passa pela mesma aprovação e envio. Quando o eSocial processar a
              exclusão, este evento fica marcado como excluído.
            </p>
          </Formulario>
        )}
      </Modal>
    </>
  );
}

function FormMotivo({ aoEnviar }: { aoEnviar: (motivo: string) => Promise<void> }) {
  const [m, setM] = useState('');
  return (
    <Formulario perigo botao="Descartar" aoEnviar={() => aoEnviar(m)}>
      <p className="text-sm text-slate-700">O evento não será enviado. Ele continua no histórico como descartado.</p>
      <Campo rotulo="Motivo" obrigatorio><textarea className="campo" rows={2} required maxLength={500} value={m} onChange={(e) => setM(e.target.value)} /></Campo>
    </Formulario>
  );
}
