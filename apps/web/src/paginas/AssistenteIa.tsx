import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, ListPlus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PRIORIDADES, SITUACOES_SUGESTAO, TIPOS_SUGESTAO_IA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { FormAcao } from '../componentes/acoes';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo, Vazio } from '../componentes/ui';

const COR_SITUACAO: Record<string, string> = {
  pendente: 'bg-amber-50 text-amber-700', aceita: 'bg-emerald-50 text-emerald-700', descartada: 'bg-slate-100 text-slate-600',
};

function Configuracao() {
  const s = useSessao();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ia-config'], queryFn: () => api.get('/ia/config') });
  const [editar, setEditar] = useState(false);
  const [d, setD] = useState<{ ativo: boolean; modelo: string; chave: string } | null>(null);
  const c = q.data;
  if (!c) return <Carregando />;
  const podeConfigurar = s.pode('sistema.configurar');
  const form = d ?? { ativo: c.ativo, modelo: c.modelo, chave: '' };
  const salvo = () => { qc.invalidateQueries({ queryKey: ['ia-config'] }); setEditar(false); setD(null); };
  return (
    <section className="cartao p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Bot size={18} className="text-marca-600" /> Assistente de IA</h2>
          <p className="mt-1 text-sm text-slate-600">
            {c.ativo ? <>Ligado · {c.modelos[c.modelo] ?? c.modelo} · chave terminada em <span className="font-mono">{c.chaveFinal}</span></> : 'Desligado. O sistema funciona normalmente sem ele.'}
          </p>
        </div>
        {podeConfigurar && !editar && <button className="btn-secundario" onClick={() => setEditar(true)}>Configurar</button>}
      </div>
      <ul className="mt-3 space-y-1 text-sm text-slate-600">
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-marca-600" />Só explica erros do eSocial e resume pendências. Cada resposta fica aguardando uma pessoa aceitar ou descartar.</li>
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-marca-600" />Não grava nada no sistema, não aprova, não define exames ou aptidão e não transmite ao eSocial.</li>
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-marca-600" />Não envia nomes, CPF, valores digitados nem dados clínicos. Cada sugestão mostra exatamente o que foi enviado.</li>
        <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-marca-600" />Precisa de internet e de uma chave da API da Anthropic (cobrada pela Anthropic). Se o modelo escolhido estiver indisponível, a Anthropic responde com um modelo reserva, e o modelo que respondeu fica registrado.</li>
      </ul>
      {editar && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Formulario aoEnviar={async () => { await api.put('/ia/config', { ...form, chave: form.chave || null }); salvo(); }}
            extra={<>
              <button type="button" className="btn-secundario" onClick={() => { setEditar(false); setD(null); }}>Cancelar</button>
              {c.temChave && <button type="button" className="btn-secundario text-red-700" onClick={async () => { await api.delete('/ia/config/chave'); salvo(); }}>Apagar chave</button>}
            </>}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-marca-600" checked={form.ativo} onChange={(e) => setD({ ...form, ativo: e.target.checked })} />
              Assistente ligado
            </label>
            <Campo rotulo="Modelo">
              <select className="campo" value={form.modelo} onChange={(e) => setD({ ...form, modelo: e.target.value })}>
                {Object.entries(c.modelos).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
              </select>
            </Campo>
            <Campo rotulo={c.temChave ? `Nova chave da API (deixe em branco para manter a terminada em ${c.chaveFinal})` : 'Chave da API da Anthropic'}>
              <input className="campo font-mono" type="password" autoComplete="off" value={form.chave} placeholder="sk-ant-…" onChange={(e) => setD({ ...form, chave: e.target.value })} />
            </Campo>
            <p className="text-xs text-slate-500">A chave fica cifrada no banco deste computador e nunca é mostrada de novo.</p>
          </Formulario>
        </div>
      )}
    </section>
  );
}

function Detalhe({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['ia-sugestao', id], queryFn: () => api.get(`/ia/sugestoes/${id}`) });
  const [descartar, setDescartar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<unknown>();
  const [acao, setAcao] = useState<{ descricao: string; prioridade: string } | null>(null);
  const x = q.data;
  if (q.error) return <Aviso erro={q.error} />;
  if (!x) return <Carregando />;
  const atualizar = (r: any) => { qc.setQueryData(['ia-sugestao', id], r); qc.invalidateQueries({ queryKey: ['ia-sugestoes'] }); };
  const aceitar = async () => { setErro(undefined); try { atualizar(await api.post(`/ia/sugestoes/${id}/aceite`)); } catch (e) { setErro(e); } };
  if (acao)
    return (
      <>
        <p className="mb-3 text-sm text-slate-600">Ação sugerida pelo assistente. Confira, complete e salve; nada é gravado sem você.</p>
        <FormAcao empresaId={x.empresaId} inicial={acao} aoSalvar={(a) => { aoFechar(); nav(`/acoes/${a.id}`); }} />
      </>
    );
  return (
    <div className="space-y-4 text-sm">
      <Aviso erro={erro} />
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta cor={COR_SITUACAO[x.situacao]!}>{SITUACOES_SUGESTAO[x.situacao as keyof typeof SITUACOES_SUGESTAO]}</Etiqueta>
        <span className="text-slate-500">{TIPOS_SUGESTAO_IA[x.tipo as keyof typeof TIPOS_SUGESTAO_IA]} · {x.empresaNome} · pedido por {x.criadoPor} em {dataHoraBr(x.criadoEm)} · {x.modelo}</span>
      </div>
      {x.eventoId && <Link className="text-marca-700 hover:underline" to={`/esocial/eventos/${x.eventoId}`} onClick={aoFechar}>Abrir o evento {x.eventoTipo}</Link>}
      <Aviso tipo="info">Texto gerado por IA. Pode conter erros: confira no leiaute do eSocial e nos cadastros antes de agir.</Aviso>
      <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 leading-relaxed text-slate-800">{x.texto}</div>
      {x.acoesSugeridas.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Ações sugeridas</h3>
          <ul className="space-y-1.5">
            {x.acoesSugeridas.map((a: any, i: number) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span className="min-w-0 flex-1">{a.descricao}</span>
                <span className="text-xs text-slate-500">Prioridade {PRIORIDADES[a.prioridade as keyof typeof PRIORIDADES]}</span>
                {x.situacao === 'aceita' && s.pode('acoes.editar') && (
                  <button className="btn-secundario px-2.5 py-1 text-xs" onClick={() => setAcao(a)}><ListPlus size={14} /> Abrir como ação</button>
                )}
              </li>
            ))}
          </ul>
          {x.situacao === 'pendente' && <p className="mt-1 text-xs text-slate-500">Depois de aceitar, cada ação pode virar um plano de ação, que você confere e salva.</p>}
        </div>
      )}
      <details className="rounded-lg border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer font-medium">O que foi enviado ao serviço de IA</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(x.enviado, null, 2)}</pre>
      </details>
      {x.situacao === 'pendente' ? (
        descartar ? (
          <Formulario botao="Descartar sugestão" perigo aoEnviar={async () => { atualizar(await api.post(`/ia/sugestoes/${id}/descarte`, { motivo })); setDescartar(false); }}
            extra={<button type="button" className="btn-secundario" onClick={() => setDescartar(false)}>Voltar</button>}>
            <Campo rotulo="Motivo do descarte" obrigatorio>
              <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} />
            </Campo>
          </Formulario>
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button className="btn-primario" onClick={aceitar}><Check size={15} /> Aceitar</button>
            <button className="btn-secundario" onClick={() => setDescartar(true)}><X size={15} /> Descartar</button>
          </div>
        )
      ) : (
        <p className="border-t border-slate-100 pt-4 text-slate-600">
          {x.situacao === 'aceita' ? 'Aceita' : 'Descartada'} por {x.decididoPorNome} em {dataHoraBr(x.decididoEm)}{x.motivoDescarte ? ` · motivo: ${x.motivoDescarte}` : ''}
        </p>
      )}
    </div>
  );
}

/** Assistente de IA: configuração e a fila de sugestões aguardando decisão humana. */
export function AssistenteIa() {
  const s = useSessao();
  const [params, setParams] = useSearchParams();
  const situacao = params.get('situacao') ?? 'pendente';
  const aberta = params.get('sugestao');
  const q = useQuery({
    queryKey: ['ia-sugestoes', s.empresaId, situacao],
    queryFn: () => api.get(`/ia/sugestoes${qs({ empresaId: s.empresaId, situacao: situacao === 'todas' ? '' : situacao })}`),
    enabled: s.pode('ia.usar'),
  });
  const mudar = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };
  return (
    <>
      <Titulo titulo="Assistente de IA" subtitulo="Explicações de erros do eSocial e resumos de pendências, sempre como sugestão para uma pessoa aceitar ou descartar." />
      <Configuracao />
      {s.pode('ia.usar') && (
        <section className="cartao mt-4 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="mr-auto font-semibold">Sugestões</h2>
            {['pendente', 'aceita', 'descartada', 'todas'].map((k) => (
              <button key={k} onClick={() => mudar('situacao', k === 'pendente' ? '' : k)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${situacao === k ? 'bg-marca-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {k === 'todas' ? 'Todas' : SITUACOES_SUGESTAO[k as keyof typeof SITUACOES_SUGESTAO]}
              </button>
            ))}
          </div>
          {!q.data ? <Carregando /> : !q.data.length ? (
            <Vazio>
              Nenhuma sugestão {situacao === 'pendente' ? 'aguardando decisão' : 'aqui'}. Peça uma explicação em um evento do eSocial com erro ou rejeitado,
              ou um resumo de pendências em <Link className="text-marca-700 hover:underline" to="/indicadores">Indicadores</Link>.
            </Vazio>
          ) : (
            <div className="divide-y divide-slate-100">
              {q.data.map((x: any) => (
                <button key={x.id} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => mudar('sugestao', x.id)}>
                  <Sparkles size={16} className="shrink-0 text-marca-600" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-tinta">{x.titulo}</span>
                    <span className="block truncate text-xs text-slate-500">{x.empresaNome} · {dataHoraBr(x.criadoEm)} · {x.texto.slice(0, 140)}</span>
                  </span>
                  <Etiqueta cor={COR_SITUACAO[x.situacao]!}>{SITUACOES_SUGESTAO[x.situacao as keyof typeof SITUACOES_SUGESTAO]}</Etiqueta>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      <Modal titulo="Sugestão do assistente" aberto={!!aberta} aoFechar={() => mudar('sugestao', '')} largura="max-w-xl">
        {aberta && <Detalhe id={aberta} aoFechar={() => mudar('sugestao', '')} />}
      </Modal>
    </>
  );
}
