import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { APLICABILIDADES, SITUACOES_DOCUMENTO } from '@sst/shared';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { meses, SituacaoDocumento, TextoPrazo, useTiposDocumento } from '../componentes/documentos';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstabelecimentos } from './Estrutura';

type Aba = 'documentos' | 'tipos';

const num = (v: any) => (v === '' || v == null ? null : Number(v));

/** Campos de prazo (em meses) usados no tipo e no documento. */
export function CamposPrazos({ d, set }: { d: any; set: (k: string) => (e: any) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Revisão legal a cada (meses)"><input className="campo" type="number" min={1} max={120} value={d.prazoRevisaoMeses ?? ''} onChange={set('prazoRevisaoMeses')} placeholder="vazio = sem prazo fixo" /></Campo>
        <Campo rotulo="Vencimento após (meses)"><input className="campo" type="number" min={1} max={120} value={d.vencimentoMeses ?? ''} onChange={set('vencimentoMeses')} placeholder="só se houver vencimento expresso" /></Campo>
        <Campo rotulo="Acompanhamento a cada (meses)"><input className="campo" type="number" min={1} max={120} value={d.monitoramentoMeses ?? ''} onChange={set('monitoramentoMeses')} placeholder="ex.: relatório anual" /></Campo>
        <Campo rotulo="Reavaliação interna a cada (meses)"><input className="campo" type="number" min={1} max={120} value={d.reavaliacaoMeses ?? ''} onChange={set('reavaliacaoMeses')} placeholder="regra da sua organização" /></Campo>
      </div>
      <Campo rotulo="Critério de revisão"><textarea className="campo" rows={3} value={d.criterioRevisao ?? ''} onChange={set('criterioRevisao')} placeholder="Quando o documento precisa ser revisto além dos prazos (ex.: mudança de processo)" /></Campo>
    </>
  );
}

export const corpoPrazos = (d: any) => ({
  prazoRevisaoMeses: num(d.prazoRevisaoMeses), vencimentoMeses: num(d.vencimentoMeses), monitoramentoMeses: num(d.monitoramentoMeses),
  reavaliacaoMeses: num(d.reavaliacaoMeses), criterioRevisao: d.criterioRevisao || null,
});

function FormTipo({ inicial, aoSalvar }: { inicial?: any; aoSalvar: () => void }) {
  const [d, setD] = useState<any>({ ativo: true, ...(inicial ?? {}) });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const corpo = { sigla: d.sigla || null, nome: d.nome, baseLegal: d.baseLegal || null, descricao: d.descricao || null, ativo: d.ativo, ...corpoPrazos(d) };
      if (inicial) await api.put(`/documentos-tipos/${inicial.id}`, corpo);
      else await api.post('/documentos-tipos', corpo);
      aoSalvar();
    }}>
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Campo rotulo="Sigla"><input className="campo" value={d.sigla ?? ''} onChange={set('sigla')} maxLength={20} /></Campo>
        <Campo rotulo="Nome do tipo" obrigatorio><input className="campo" value={d.nome ?? ''} onChange={set('nome')} required /></Campo>
      </div>
      <Campo rotulo="Base legal"><input className="campo" value={d.baseLegal ?? ''} onChange={set('baseLegal')} placeholder="ex.: NR-01" /></Campo>
      <CamposPrazos d={d} set={set} />
      <p className="text-xs text-slate-500">
        Prazos em branco não são presumidos. Preencha só o que a norma ou a sua organização exige. Os prazos são copiados para cada documento novo e podem ser ajustados nele.
      </p>
      {inicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
    </Formulario>
  );
}

function Tipos() {
  const s = useSessao();
  const qc = useQueryClient();
  const [inativos, setInativos] = useState(false);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [msg, setMsg] = useState<string>();
  const [erro, setErro] = useState<unknown>();
  const lista = useTiposDocumento(inativos);
  const pode = s.pode('documentos.editar');
  const recarregar = () => qc.invalidateQueries({ queryKey: ['documentos-tipos'] });
  return (
    <>
      <Aviso erro={erro} />
      {msg && <Aviso tipo="ok">{msg}</Aviso>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
        {pode && (
          <div className="ml-auto flex gap-2">
            <button className="btn-secundario" onClick={async () => {
              setErro(undefined); setMsg(undefined);
              try {
                const r = await api.post('/documentos-tipos/biblioteca');
                setMsg(r.incluidos ? `${r.incluidos} tipos incluídos da biblioteca sugerida. Revise os prazos antes de usar.` : 'Todos os tipos da biblioteca sugerida já estão cadastrados.');
                recarregar();
              } catch (x) { setErro(x); }
            }}><BookOpen size={16} /> Incluir biblioteca sugerida</button>
            <button className="btn-primario" onClick={() => setEdit(null)}><Plus size={16} /> Novo tipo</button>
          </div>
        )}
      </div>
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : !lista.data?.length ? (
          <Vazio>Nenhum tipo cadastrado. Use "Incluir biblioteca sugerida" (PGR, PCMSO, LTCAT, laudos e outros) ou cadastre os seus.</Vazio>
        ) : (
          <table className="tabela">
            <thead><tr><th>Tipo</th><th>Base legal</th><th>Revisão legal</th><th>Vencimento</th><th>Acompanhamento</th><th>Reavaliação</th><th /></tr></thead>
            <tbody>
              {lista.data.map((t) => (
                <tr key={t.id} className={pode ? 'cursor-pointer' : ''} onClick={() => pode && setEdit(t)}>
                  <td><span className="font-medium">{t.sigla ? `${t.sigla} · ` : ''}{t.nome}</span></td>
                  <td>{t.baseLegal ?? '—'}</td>
                  <td>{meses(t.prazoRevisaoMeses)}</td><td>{meses(t.vencimentoMeses)}</td><td>{meses(t.monitoramentoMeses)}</td><td>{meses(t.reavaliacaoMeses)}</td>
                  <td>{!t.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">A biblioteca sugerida só traz prazo quando a norma o fixa de forma expressa (ex.: revisão do PGR a cada 2 anos). Confira sempre a norma vigente.</p>
      <Modal titulo={edit ? 'Editar tipo de documento' : 'Novo tipo de documento'} aberto={edit !== undefined} aoFechar={() => setEdit(undefined)} largura="max-w-xl">
        {edit !== undefined && <FormTipo key={edit?.id ?? 'novo'} inicial={edit ?? undefined} aoSalvar={() => { setEdit(undefined); recarregar(); }} />}
      </Modal>
    </>
  );
}

function FormNovoDocumento({ empresaId, aoSalvar }: { empresaId: string; aoSalvar: (d: any) => void }) {
  const tipos = useTiposDocumento();
  const ests = useEstabelecimentos(empresaId);
  const [d, setD] = useState<any>({});
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const tipo = tipos.data?.find((t) => t.id === d.tipoId);
  return (
    <Formulario aoEnviar={async () => {
      aoSalvar(await api.post('/documentos', {
        empresaId, tipoId: d.tipoId, estabelecimentoId: d.estabelecimentoId || null, identificacao: d.identificacao, observacoes: d.observacoes || null,
      }));
    }}>
      {tipos.data && !tipos.data.length && <Aviso tipo="info">Cadastre os tipos de documento primeiro, na aba "Tipos de documento".</Aviso>}
      <Campo rotulo="Tipo" obrigatorio>
        <select className="campo" value={d.tipoId ?? ''} onChange={(e) => {
          const t = tipos.data?.find((x) => x.id === e.target.value);
          setD({ ...d, tipoId: e.target.value, identificacao: d.identificacao || t?.sigla || t?.nome || '' });
        }} required>
          <option value="" />
          {tipos.data?.map((t) => <option key={t.id} value={t.id}>{t.sigla ? `${t.sigla} · ` : ''}{t.nome}</option>)}
        </select>
      </Campo>
      {tipo && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Regras copiadas do tipo: revisão legal {meses(tipo.prazoRevisaoMeses)}, vencimento {meses(tipo.vencimentoMeses)}, acompanhamento {meses(tipo.monitoramentoMeses)},
          reavaliação {meses(tipo.reavaliacaoMeses)}. Podem ser ajustadas na ficha do documento.
        </p>
      )}
      <Campo rotulo="Identificação" obrigatorio><input className="campo" value={d.identificacao ?? ''} onChange={set('identificacao')} required placeholder="ex.: PGR Matriz" /></Campo>
      <Campo rotulo="Estabelecimento">
        <select className="campo" value={d.estabelecimentoId ?? ''} onChange={set('estabelecimentoId')}>
          <option value="">Toda a empresa</option>
          {ests.data?.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Observações"><textarea className="campo" rows={2} value={d.observacoes ?? ''} onChange={set('observacoes')} /></Campo>
    </Formulario>
  );
}

const CARTOES: { rotulo: string; sits: string[]; cor: string }[] = [
  { rotulo: 'Regulares', sits: ['regular'], cor: 'text-emerald-700' },
  { rotulo: 'Próximos da revisão ou vencimento', sits: ['proximo_revisao', 'proximo_vencimento'], cor: 'text-amber-700' },
  { rotulo: 'Vencidos', sits: ['vencido'], cor: 'text-red-700' },
  { rotulo: 'Pendentes', sits: ['pendente'], cor: 'text-red-700' },
  { rotulo: 'Em elaboração ou revisão', sits: ['em_elaboracao', 'em_revisao'], cor: 'text-sky-700' },
  { rotulo: 'Substituídos', sits: ['substituido'], cor: '' },
];

function ListaDocumentos() {
  const s = useSessao();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const situacao = params.get('situacao') ?? '';
  const tipoId = params.get('tipoId') ?? '';
  const [novo, setNovo] = useState(false);
  const tipos = useTiposDocumento(true);
  const q = useQuery({
    queryKey: ['documentos', s.empresaId, tipoId],
    queryFn: () => api.get(`/documentos${qs({ empresaId: s.empresaId, tipoId })}`),
  });
  const mudar = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const sits = situacao.split(',').filter(Boolean);
  const itens = (q.data?.itens ?? []).filter((d: any) => !sits.length || sits.includes(d.situacao));
  const contar = (l: string[]) => l.reduce((n, x) => n + (q.data?.resumo?.[x] ?? 0), 0);
  return (
    <>
      {q.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {CARTOES.map((c) => {
            const n = contar(c.sits);
            const ativo = situacao === c.sits.join(',');
            return (
              <button key={c.rotulo} className={`cartao p-3 text-left hover:border-marca-500 ${ativo ? 'border-marca-500' : ''}`} onClick={() => mudar('situacao', ativo ? '' : c.sits.join(','))}>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.rotulo}</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${n ? c.cor : ''}`}>{n}</div>
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="campo max-w-64" value={tipoId} onChange={(e) => mudar('tipoId', e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {tipos.data?.map((t) => <option key={t.id} value={t.id}>{t.sigla ? `${t.sigla} · ` : ''}{t.nome}</option>)}
        </select>
        <select className="campo max-w-56" value={situacao} onChange={(e) => mudar('situacao', e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(SITUACOES_DOCUMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {s.pode('documentos.editar') && s.empresaId && <button className="btn-primario ml-auto" onClick={() => setNovo(true)}><Plus size={16} /> Novo documento</button>}
      </div>
      {!s.empresaId && s.pode('documentos.editar') && <p className="mb-2 text-xs text-slate-500">Selecione uma empresa no topo para cadastrar documentos.</p>}
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !itens.length ? (
          <Vazio>{q.data?.itens.length ? 'Nenhum documento nesta situação.' : 'Nenhum documento cadastrado. Cadastre os programas e laudos que se aplicam a cada empresa.'}</Vazio>
        ) : (
          <table className="tabela">
            <thead><tr><th>Documento</th>{!s.empresaId && <th>Empresa</th>}<th>Aplicabilidade</th><th>Versão vigente</th><th>Próximo prazo</th><th>Situação</th></tr></thead>
            <tbody>
              {itens.map((d: any) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => nav(`/documentos/${d.id}`)}>
                  <td>
                    <div className="font-medium">{d.identificacao}</div>
                    <div className="text-xs text-slate-500">{d.tipoSigla ? `${d.tipoSigla} · ` : ''}{d.tipoNome}{d.estabelecimentoNome ? ` · ${d.estabelecimentoNome}` : ''}</div>
                  </td>
                  {!s.empresaId && <td>{d.empresaNome}</td>}
                  <td className={d.aplicabilidade === 'a_avaliar' ? 'text-amber-700' : ''}>{APLICABILIDADES[d.aplicabilidade as keyof typeof APLICABILIDADES]}</td>
                  <td>{d.vigenteNumero ? <>v{d.vigenteNumero} · {d.vigenteResponsavel}</> : '—'}</td>
                  <td><TextoPrazo p={d.proximoPrazo} /></td>
                  <td>
                    <SituacaoDocumento s={d.situacao} />
                    {d.motivos[0] && !['regular', 'nao_aplicavel'].includes(d.situacao) && <div className="mt-0.5 max-w-xs text-xs text-slate-500">{d.motivos[0]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.data && <p className="mt-2 text-xs text-slate-500">"Próximo" considera o maior prazo de alerta configurado ({q.data.alertaDias} dias).</p>}
      <Modal titulo="Novo documento" aberto={novo} aoFechar={() => setNovo(false)} largura="max-w-lg">
        {novo && s.empresaId && <FormNovoDocumento empresaId={s.empresaId} aoSalvar={(d) => nav(`/documentos/${d.id}`)} />}
      </Modal>
    </>
  );
}

export function Documentos() {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'documentos';
  const ABAS: { aba: Aba; rotulo: string }[] = [{ aba: 'documentos', rotulo: 'Documentos' }, { aba: 'tipos', rotulo: 'Tipos de documento' }];
  return (
    <>
      <Titulo titulo="Programas e documentos" subtitulo="PGR, PCMSO, LTCAT, laudos e demais documentos, com versões e prazos de cada um" />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <button key={a.aba} onClick={() => setParams({ aba: a.aba })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.aba ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === 'documentos' && <ListaDocumentos />}
      {aba === 'tipos' && <Tipos />}
    </>
  );
}
