import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SITUACOES_EVENTO, TIPOS_ASO, TIPOS_EVENTO_ESOCIAL, TIPOS_OCORRENCIA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Ambiente, SituacaoEvento } from '../componentes/esocial';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';

type Aba = 'pendencias' | 'eventos';

const Prazo = ({ p }: { p: string | null }) => {
  if (!p) return <span className="text-slate-400">—</span>;
  const vencido = p < hojeIso();
  return <span className={vencido ? 'font-medium text-red-600' : 'text-slate-600'}>{dataBr(p)}{vencido ? ' (vencido)' : ''}</span>;
};

export function useConfigEsocial(empresaId: string | null) {
  return useQuery({ queryKey: ['esocial-config', empresaId], queryFn: () => api.get(`/esocial/config/${empresaId}`), enabled: !!empresaId });
}

/** Aviso fixo do ambiente em uso, para ninguém confundir teste com produção. */
export function FaixaAmbiente({ empresaId }: { empresaId: string }) {
  const c = useConfigEsocial(empresaId);
  if (!c.data) return null;
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${c.data.ambiente === 1 ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      <Ambiente a={c.data.ambiente} />
      {c.data.ambiente === 1
        ? 'Eventos aprovados e enviados agora valem oficialmente para o empregador.'
        : 'Ambiente de testes do governo: os eventos não têm valor jurídico. A produção é liberada depois de eventos aceitos aqui.'}
      {!c.data.certificado && <span className="font-medium text-red-700">Sem certificado digital: cadastre em Configuração e certificados.</span>}
    </div>
  );
}

function Pendencias({ empresaId }: { empresaId: string }) {
  const s = useSessao();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['esocial-pendencias', empresaId], queryFn: () => api.get(`/esocial/pendencias/${empresaId}`) });
  const [erro, setErro] = useState<unknown>();
  const [s2240, setS2240] = useState<any>(null);
  const preparar = s.pode('esocial.preparar');
  if (!q.data) return <Carregando />;
  const gerar = async (url: string, corpo?: unknown) => {
    setErro(undefined);
    try {
      const ev = await api.post(url, corpo);
      qc.invalidateQueries({ queryKey: ['esocial-pendencias'] });
      qc.invalidateQueries({ queryKey: ['esocial-eventos'] });
      nav(`/esocial/eventos/${ev.id}`);
    } catch (e) { setErro(e); }
  };
  const { s2220, s2240: trab, s2210 } = q.data;
  return (
    <>
      <Aviso erro={erro} />
      <p className="mb-4 text-sm text-slate-600">
        Registros do sistema que ainda não viraram evento. Gerar um evento não envia nada: ele é validado no esquema oficial e fica aguardando a aprovação de uma pessoa.
      </p>
      <section className="cartao mb-4 overflow-x-auto">
        <h2 className="px-5 pt-4 text-sm font-semibold">S-2220 · ASOs sem evento <span className="text-slate-400">({s2220.length})</span></h2>
        {!s2220.length ? <p className="px-5 py-4 text-sm text-slate-500">Nenhum ASO pendente.</p> : (
          <table className="tabela mt-2">
            <thead><tr><th>Funcionário</th><th>ASO</th><th>Data</th><th>Prazo</th><th /></tr></thead>
            <tbody>
              {s2220.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.funcionarioNome} <span className="text-xs text-slate-500">· {a.matricula}</span></td>
                  <td>{TIPOS_ASO[a.tipo as keyof typeof TIPOS_ASO]}</td>
                  <td>{dataBr(a.data)}</td>
                  <td><Prazo p={a.prazo} /></td>
                  <td className="text-right">{preparar && <button className="btn-secundario" onClick={() => gerar(`/esocial/preparar/s2220/${a.id}`)}>Gerar S-2220</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="cartao mb-4 overflow-x-auto">
        <h2 className="px-5 pt-4 text-sm font-semibold">S-2240 · Condições ambientais a informar <span className="text-slate-400">({trab.length})</span></h2>
        {!trab.length ? <p className="px-5 py-4 text-sm text-slate-500">Todos os trabalhadores ativos têm S-2240 da lotação atual.</p> : (
          <table className="tabela mt-2">
            <thead><tr><th>Funcionário</th><th>GHE</th><th>Motivo</th><th>Lotação desde</th><th /></tr></thead>
            <tbody>
              {trab.map((t: any) => (
                <tr key={t.vinculoId}>
                  <td>{t.funcionarioNome} <span className="text-xs text-slate-500">· {t.matricula}</span></td>
                  <td>{t.gheCodigo ?? <span className="text-red-600">sem GHE</span>}</td>
                  <td className="text-sm">{t.motivo}</td>
                  <td>{dataBr(t.inicio)}</td>
                  <td className="text-right">{preparar && <button className="btn-secundario" onClick={() => setS2240(t)}>Gerar S-2240</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="cartao overflow-x-auto">
        <h2 className="px-5 pt-4 text-sm font-semibold">S-2210 · Acidentes sem CAT enviada <span className="text-slate-400">({s2210.length})</span></h2>
        {!s2210.length ? <p className="px-5 py-4 text-sm text-slate-500">Nenhum acidente pendente.</p> : (
          <table className="tabela mt-2">
            <thead><tr><th>Ocorrência</th><th>Tipo</th><th>Data</th><th>Situação da CAT</th><th>Prazo</th><th /></tr></thead>
            <tbody>
              {s2210.map((c: any) => (
                <tr key={`${c.ocorrenciaId}-${c.catId ?? ''}`}>
                  <td>{c.codigo} <span className="text-xs text-slate-500">· {c.funcionarioNome ?? 'sem funcionário'}</span></td>
                  <td>{TIPOS_OCORRENCIA[c.tipo as keyof typeof TIPOS_OCORRENCIA]}</td>
                  <td>{dataBr(c.data)}</td>
                  <td className="text-sm">{!c.catId ? 'Dados da CAT não preenchidos' : !c.temAtestado ? 'Falta o atestado médico' : 'Pronta para gerar'}</td>
                  <td><Prazo p={c.prazo} /></td>
                  <td className="text-right whitespace-nowrap">
                    {c.catId && c.temAtestado && preparar && <button className="btn-secundario mr-2" onClick={() => gerar(`/esocial/preparar/s2210/${c.catId}`)}>Gerar S-2210</button>}
                    <Link className="text-sm text-marca-700 hover:underline" to={`/ocorrencias/${c.ocorrenciaId}`}>Abrir ocorrência</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-5 pb-4 pt-2 text-xs text-slate-500">Prazo da CAT: primeiro dia útil após o acidente (feriados não são considerados); em caso de óbito, imediato.</p>
      </section>
      <Modal titulo="Gerar S-2240" aberto={!!s2240} aoFechar={() => setS2240(null)} largura="max-w-lg">
        {s2240 && <FormS2240 t={s2240} aoGerar={(c) => gerar('/esocial/preparar/s2240', c)} />}
      </Modal>
    </>
  );
}

function FormS2240({ t, aoGerar }: { t: any; aoGerar: (c: any) => Promise<void> }) {
  const [d, setD] = useState<any>({ dtIniCondicao: '', observacao: '' });
  return (
    <Formulario botao="Gerar evento" aoEnviar={() => aoGerar({ vinculoId: t.vinculoId, dtIniCondicao: d.dtIniCondicao || null, observacao: d.observacao || null })}>
      <p className="text-sm text-slate-600">{t.funcionarioNome}, GHE {t.gheCodigo ?? '—'}. Os agentes nocivos vêm do cadastro do GHE e o responsável ambiental, da configuração.</p>
      <Campo rotulo="Início das condições (vazio = início da lotação ou da obrigatoriedade)">
        <input type="date" className="campo" value={d.dtIniCondicao} onChange={(e) => setD({ ...d, dtIniCondicao: e.target.value })} />
      </Campo>
      <Campo rotulo="Observação (opcional)"><textarea className="campo" rows={2} maxLength={999} value={d.observacao} onChange={(e) => setD({ ...d, observacao: e.target.value })} /></Campo>
    </Formulario>
  );
}

function Eventos({ empresaId }: { empresaId: string }) {
  const s = useSessao();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const situacao = params.get('situacao') ?? '';
  const tipo = params.get('tipo') ?? '';
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [janela, setJanela] = useState<null | 'aprovar' | 'enviar'>(null);
  const [aviso, setAviso] = useState<string>();
  const cfg = useConfigEsocial(empresaId);
  const q = useQuery({
    queryKey: ['esocial-eventos', empresaId, situacao, tipo, params.get('busca') ?? ''],
    queryFn: () => api.get(`/esocial/eventos${qs({ empresaId, situacao, tipo, busca: params.get('busca') })}`),
  });
  const mudar = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n);
    setSel([]);
  };
  const itens = q.data ?? [];
  const pendentes = itens.filter((e: any) => e.situacao === 'pendente');
  const aprovados = itens.filter((e: any) => e.situacao === 'aprovado');
  const transmitir = s.pode('esocial.transmitir');
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['esocial-eventos'] });
    qc.invalidateQueries({ queryKey: ['esocial-lotes'] });
    qc.invalidateQueries({ queryKey: ['esocial-painel'] });
  };
  return (
    <>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); mudar('busca', busca.trim()); }}>
          <input className="campo w-64" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CPF, Id ou recibo" aria-label="Buscar" />
        </form>
        <select className="campo max-w-56" value={situacao} onChange={(e) => mudar('situacao', e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(SITUACOES_EVENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="campo max-w-72" value={tipo} onChange={(e) => mudar('tipo', e.target.value)} aria-label="Tipo">
          <option value="">Todos os eventos</option>
          {Object.entries(TIPOS_EVENTO_ESOCIAL).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {transmitir && <button className="btn-secundario" disabled={!sel.length} onClick={() => setJanela('aprovar')}><ShieldCheck size={15} /> Aprovar e assinar ({sel.length})</button>}
          {transmitir && <button className="btn-primario" disabled={!aprovados.length && situacao !== ''} onClick={() => setJanela('enviar')}><Send size={15} /> Enviar aprovados</button>}
        </div>
      </div>
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !itens.length ? <Vazio>Nenhum evento com estes filtros.</Vazio> : (
          <table className="tabela">
            <thead><tr>
              <th className="w-8">{transmitir && pendentes.length > 0 && (
                <input type="checkbox" aria-label="Selecionar todos aguardando aprovação" checked={sel.length === pendentes.length}
                  onChange={(e) => setSel(e.target.checked ? pendentes.filter((x: any) => !x.erros.length).map((x: any) => x.id) : [])} />
              )}</th>
              <th>Evento</th><th>Trabalhador</th><th>Referência</th><th>Prazo</th><th>Situação</th><th>Recibo</th>
            </tr></thead>
            <tbody>
              {itens.map((e: any) => (
                <tr key={e.id} className="cursor-pointer" onClick={() => nav(`/esocial/eventos/${e.id}`)}>
                  <td onClick={(x) => x.stopPropagation()}>
                    {transmitir && e.situacao === 'pendente' && (
                      <input type="checkbox" aria-label={`Selecionar ${e.tipo}`} checked={sel.includes(e.id)}
                        onChange={(x) => setSel(x.target.checked ? [...sel, e.id] : sel.filter((i) => i !== e.id))} />
                    )}
                  </td>
                  <td>
                    <div className="font-medium">{e.tipo}{e.indRetif === 2 ? ' · retificação' : ''}</div>
                    <div className="max-w-md truncate text-xs text-slate-500" title={e.resumo}>{e.resumo}</div>
                  </td>
                  <td>{e.funcionarioNome ?? '—'}</td>
                  <td>{dataBr(e.referencia)}</td>
                  <td>{['processado', 'cancelado', 'excluido', 'enviado'].includes(e.situacao) ? '—' : <Prazo p={e.prazo} />}</td>
                  <td><SituacaoEvento s={e.situacao} />{e.ambiente === 1 ? null : <div className="mt-0.5 text-[11px] text-slate-500">produção restrita</div>}</td>
                  <td className="font-mono text-xs">{e.nrRecibo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Aprovar e assinar eventos" aberto={janela === 'aprovar'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'aprovar' && (
          <Formulario botao={`Aprovar ${sel.length} evento(s)`} aoEnviar={async () => {
            await api.post('/esocial/aprovacao', { ids: sel });
            setAviso(`${sel.length} evento(s) aprovado(s) e assinado(s). Eles serão enviados quando você usar "Enviar aprovados".`);
            setSel([]);
            setJanela(null);
            atualizar();
          }}>
            <p className="text-sm text-slate-700">
              Ao aprovar, você confirma que conferiu as informações destes eventos. Eles serão assinados com o certificado digital da empresa e
              ficarão prontos para envio. Nada é enviado nesta etapa.
            </p>
            {cfg.data && <p className="text-sm">Ambiente: <Ambiente a={cfg.data.ambiente} /></p>}
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Enviar eventos aprovados" aberto={janela === 'enviar'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'enviar' && (
          <Formulario botao="Enviar ao eSocial" aoEnviar={async () => {
            const l = await api.post(`/esocial/envio/${empresaId}`);
            setJanela(null);
            atualizar();
            nav(`/esocial/lotes?lote=${l.id}`);
          }}>
            <p className="text-sm text-slate-700">
              Os eventos aprovados da empresa (até 50 por lote) serão transmitidos agora pela internet ao eSocial com o certificado digital.
              O retorno do governo é consultado depois, em Lotes e retornos.
            </p>
            {cfg.data && <p className="text-sm">Destino: <Ambiente a={cfg.data.ambiente} /></p>}
          </Formulario>
        )}
      </Modal>
    </>
  );
}

export function Esocial() {
  const s = useSessao();
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'pendencias';
  const ABAS: { aba: Aba; rotulo: string }[] = [{ aba: 'pendencias', rotulo: 'Pendências' }, { aba: 'eventos', rotulo: 'Eventos' }];
  return (
    <>
      <Titulo titulo="Central de eventos do eSocial" subtitulo="S-2210 (CAT), S-2220 (ASO), S-2240 (agentes nocivos) e S-3000 (exclusão). Nada é transmitido sem aprovação humana." />
      <ExigeEmpresa empresaId={s.empresaId}>
        <FaixaAmbiente empresaId={s.empresaId!} />
        <div className="mb-4 flex gap-1 border-b border-slate-200">
          {ABAS.map((a) => (
            <button key={a.aba} onClick={() => setParams({ aba: a.aba })}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.aba ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {a.rotulo}
            </button>
          ))}
          <Link to="/esocial/lotes" className="ml-auto inline-flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-tinta"><FileCheck2 size={15} /> Lotes e retornos</Link>
        </div>
        {aba === 'pendencias' ? <Pendencias empresaId={s.empresaId!} /> : <Eventos empresaId={s.empresaId!} />}
      </ExigeEmpresa>
    </>
  );
}
