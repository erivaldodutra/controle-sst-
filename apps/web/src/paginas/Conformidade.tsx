import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Plus, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { APLICABILIDADES, AVALIACOES_CONFORMIDADE, CLASSES_EMPRESA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { FormAcao, OrigemFixa, SituacaoConformidade } from '../componentes/acoes';
import { SituacaoDocumento } from '../componentes/documentos';
import { useTiposDocumento } from '../componentes/documentos';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Etiqueta, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstabelecimentos } from './Estrutura';

type Aba = 'matriz' | 'empresas' | 'requisitos';

const COR_CLASSE: Record<string, string> = {
  com_vencidos: 'bg-red-100 text-red-800', com_pendencias: 'bg-amber-100 text-amber-800',
  prazos_proximos: 'bg-sky-100 text-sky-800', regular: 'bg-emerald-100 text-emerald-800',
};

function FormAvaliacao({ empresaId, estabelecimentoId, linha, aoSalvar }: { empresaId: string; estabelecimentoId: string | null; linha: any; aoSalvar: () => void }) {
  const c = linha.conformidade ?? {};
  const [d, setD] = useState<any>({
    aplicabilidade: c.aplicabilidade ?? 'a_avaliar', justificativa: c.justificativa ?? '', avaliacao: c.avaliacao ?? 'nao_avaliado',
    avaliacaoEm: c.avaliacaoEm ?? hojeIso(), responsavelNome: c.responsavelNome ?? '', pendencias: c.pendencias ?? '', prazo: c.prazo ?? '',
    observacoes: c.observacoes ?? '',
  });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const porDocumento = !!linha.requisito.documentoTipoId;
  return (
    <Formulario aoEnviar={async () => {
      const v = (k: string) => d[k] || null;
      await api.put('/conformidade', {
        empresaId, estabelecimentoId, requisitoId: linha.requisito.id, aplicabilidade: d.aplicabilidade, justificativa: v('justificativa'),
        avaliacao: porDocumento ? 'nao_avaliado' : d.avaliacao, avaliacaoEm: porDocumento || d.avaliacao === 'nao_avaliado' ? null : v('avaliacaoEm'),
        responsavelNome: v('responsavelNome'), pendencias: v('pendencias'), prazo: v('prazo'), observacoes: v('observacoes'),
      });
      aoSalvar();
    }}>
      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="font-medium">{linha.requisito.titulo}</div>
        {linha.requisito.fundamentacao && <div className="text-xs text-slate-500">{linha.requisito.fundamentacao}</div>}
      </div>
      {linha.sugestao && (
        <p className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Lightbulb size={15} className="shrink-0" />
          <span>Sugestão pelos critérios do requisito: {linha.sugestao.sugere ? 'provavelmente aplicável' : 'provavelmente não aplicável'} ({linha.sugestao.motivos.join('; ')}). A decisão é sua.</span>
        </p>
      )}
      <Campo rotulo="Aplicabilidade" obrigatorio>
        <select className="campo" value={d.aplicabilidade} onChange={set('aplicabilidade')}>{Object.entries(APLICABILIDADES).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
      </Campo>
      <Campo rotulo={d.aplicabilidade === 'nao_aplicavel' ? 'Justificativa da não aplicabilidade' : 'Justificativa'} obrigatorio={d.aplicabilidade === 'nao_aplicavel'}>
        <textarea className="campo" rows={2} value={d.justificativa} onChange={set('justificativa')} required={d.aplicabilidade === 'nao_aplicavel'} />
      </Campo>
      {d.aplicabilidade === 'aplicavel' && (porDocumento ? (
        <p className="text-xs text-slate-500">A situação deste requisito vem dos documentos do tipo {linha.requisito.documentoTipoSigla ?? linha.requisito.documentoTipoNome} cadastrados para a empresa.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Avaliação"><select className="campo" value={d.avaliacao} onChange={set('avaliacao')}>{Object.entries(AVALIACOES_CONFORMIDADE).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
          {d.avaliacao !== 'nao_avaliado' && <Campo rotulo="Data da avaliação" obrigatorio><input className="campo" type="date" value={d.avaliacaoEm} max={hojeIso()} onChange={set('avaliacaoEm')} required /></Campo>}
        </div>
      ))}
      {d.aplicabilidade === 'aplicavel' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Responsável"><input className="campo" value={d.responsavelNome} onChange={set('responsavelNome')} /></Campo>
            <Campo rotulo="Prazo para regularizar"><input className="campo" type="date" value={d.prazo} onChange={set('prazo')} /></Campo>
          </div>
          <Campo rotulo="Pendências"><textarea className="campo" rows={2} value={d.pendencias} onChange={set('pendencias')} /></Campo>
        </>
      )}
      <Campo rotulo="Observações"><textarea className="campo" rows={2} value={d.observacoes} onChange={set('observacoes')} /></Campo>
    </Formulario>
  );
}

function Matriz() {
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [estab, setEstab] = useState('');
  const [filtro, setFiltro] = useState('');
  const [janela, setJanela] = useState<null | { avaliar: any } | { acao: OrigemFixa }>(null);
  const ests = useEstabelecimentos(s.empresaId);
  const q = useQuery({
    queryKey: ['conformidade', s.empresaId, estab],
    queryFn: () => api.get(`/conformidade${qs({ empresaId: s.empresaId, estabelecimentoId: estab })}`),
    enabled: !!s.empresaId,
  });
  const r = q.data?.resumo;
  const itens = (q.data?.itens ?? []).filter((l: any) => !filtro || l.situacao === filtro);
  const editar = s.pode('conformidade.editar');
  return (
    <ExigeEmpresa empresaId={s.empresaId}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="campo max-w-72" value={estab} onChange={(e) => setEstab(e.target.value)} aria-label="Estabelecimento">
          <option value="">Empresa toda</option>
          {ests.data?.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select className="campo max-w-56" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="nao_conforme">Não conformes</option>
          <option value="parcial">Parcialmente conformes</option>
          <option value="conforme">Conformes</option>
          <option value="a_avaliar">Aplicabilidade a avaliar</option>
          <option value="nao_avaliado">Não avaliados</option>
          <option value="nao_aplicavel">Não aplicáveis</option>
        </select>
      </div>
      {r && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="cartao p-4"><div className="text-[13px] font-medium text-slate-500">Atendimento</div><div className="mt-1 text-2xl font-semibold tabular-nums">{r.percentual == null ? '—' : `${r.percentual.toLocaleString('pt-BR')}%`}</div></div>
          <div className="cartao p-4"><div className="text-[13px] font-medium text-slate-500">Conformes</div><div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{r.conforme}</div></div>
          <div className="cartao p-4"><div className="text-[13px] font-medium text-slate-500">Parciais</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${r.parcial ? 'text-amber-600' : ''}`}>{r.parcial}</div></div>
          <div className="cartao p-4"><div className="text-[13px] font-medium text-slate-500">Não conformes</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${r.nao_conforme ? 'text-red-600' : ''}`}>{r.nao_conforme}</div></div>
          <div className="cartao p-4"><div className="text-[13px] font-medium text-slate-500">A avaliar</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${r.a_avaliar + r.nao_avaliado ? 'text-sky-700' : ''}`}>{r.a_avaliar + r.nao_avaliado}</div></div>
          <div className="cartao p-4"><div className="text-[13px] font-medium text-slate-500">Não aplicáveis</div><div className="mt-1 text-2xl font-semibold tabular-nums">{r.nao_aplicavel}</div></div>
        </div>
      )}
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !q.data?.itens.length ? (
          <Vazio>Nenhum requisito cadastrado. Na aba "Requisitos", gere os requisitos a partir dos tipos de documento ou cadastre os seus.</Vazio>
        ) : !itens.length ? <Vazio>Nenhum requisito nesta situação.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Requisito</th><th>Aplicabilidade</th><th>Situação</th><th>Responsável e prazo</th><th>Ações</th><th /></tr></thead>
            <tbody>
              {itens.map((l: any) => (
                <tr key={l.requisito.id}>
                  <td>
                    <div className="font-medium">{l.requisito.titulo}</div>
                    <div className="text-xs text-slate-500">{[l.requisito.fundamentacao, l.requisito.documentoTipoId ? 'pela situação do documento' : 'avaliação manual'].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <span className={l.aplicabilidade === 'a_avaliar' ? 'text-amber-700' : ''}>{APLICABILIDADES[l.aplicabilidade as keyof typeof APLICABILIDADES]}</span>
                    {l.sugestao && <div className="text-xs text-slate-500" title={l.sugestao.motivos.join('; ')}>sugestão: {l.sugestao.sugere ? 'aplicável' : 'não aplicável'}</div>}
                    {l.aplicabilidade === 'nao_aplicavel' && <div className="max-w-xs text-xs text-slate-500">{l.conformidade?.justificativa}</div>}
                  </td>
                  <td>
                    <SituacaoConformidade s={l.situacao} />
                    {l.motivo && l.situacao !== 'a_avaliar' && <div className="mt-0.5 max-w-xs text-xs text-slate-500">{l.motivo}</div>}
                    {l.documentos.map((d: any) => (
                      <Link key={d.id} to={`/documentos/${d.id}`} className="mt-1 flex items-center gap-1 text-xs text-marca-700 hover:underline">{d.identificacao} <SituacaoDocumento s={d.situacao} /></Link>
                    ))}
                  </td>
                  <td className="text-sm">
                    {l.conformidade?.responsavelNome ?? '—'}
                    {l.conformidade?.prazo && <div className="text-xs text-slate-500">até {dataBr(l.conformidade.prazo)}</div>}
                    {l.conformidade?.pendencias && <div className="max-w-xs text-xs text-slate-500">{l.conformidade.pendencias}</div>}
                  </td>
                  <td className="text-sm tabular-nums">
                    {l.acoesAbertas > 0 && <Link className="text-marca-700 hover:underline" to={`/acoes?situacao=abertas`}>{l.acoesAbertas} aberta(s)</Link>}
                    {l.acoesAtrasadas > 0 && <div className="text-xs text-red-700">{l.acoesAtrasadas} atrasada(s)</div>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {editar && <button className="text-sm text-marca-700 hover:underline" onClick={() => setJanela({ avaliar: l })}>Avaliar</button>}
                    {l.conformidade && ['nao_conforme', 'parcial'].includes(l.situacao) && s.pode('acoes.editar') && (
                      <button className="ml-3 text-sm text-marca-700 hover:underline" onClick={() => setJanela({ acao: {
                        origem: 'conformidade', rotulo: l.requisito.titulo, conformidadeId: l.conformidade.id, estabelecimentoId: estab || null,
                        descricao: l.conformidade.pendencias ?? '',
                      } })}>+ ação</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">O percentual conta só os requisitos aplicáveis já avaliados (parcialmente conforme vale meio). Sugestões de aplicabilidade nunca são aplicadas sozinhas.</p>
      <Modal titulo="Avaliar requisito" aberto={!!janela && 'avaliar' in janela} aoFechar={() => setJanela(null)} largura="max-w-xl">
        {janela && 'avaliar' in janela && s.empresaId && (
          <FormAvaliacao empresaId={s.empresaId} estabelecimentoId={estab || null} linha={janela.avaliar}
            aoSalvar={() => { setJanela(null); qc.invalidateQueries({ queryKey: ['conformidade'] }); }} />
        )}
      </Modal>
      <Modal titulo="Nova ação" aberto={!!janela && 'acao' in janela} aoFechar={() => setJanela(null)}>
        {janela && 'acao' in janela && s.empresaId && <FormAcao empresaId={s.empresaId} fixa={janela.acao} aoSalvar={(a) => nav(`/acoes/${a.id}`)} />}
      </Modal>
    </ExigeEmpresa>
  );
}

function VisaoEmpresas({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const q = useQuery({ queryKey: ['conformidade-empresas'], queryFn: () => api.get('/conformidade/empresas') });
  const [classe, setClasse] = useState('');
  const lista = (q.data?.empresas ?? []).filter((e: any) => !classe || e.classe === classe);
  return (
    <>
      {q.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Object.entries(CLASSES_EMPRESA).map(([k, r]) => (
            <button key={k} className={`cartao p-4 text-left transition hover:border-marca-200 ${classe === k ? 'border-marca-500 ring-4 ring-marca-500/10' : ''}`} onClick={() => setClasse(classe === k ? '' : k)}>
              <div className="text-[13px] font-medium text-slate-500">{r}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{q.data.resumo[k]}</div>
            </button>
          ))}
        </div>
      )}
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !lista.length ? <Vazio>Nenhuma empresa nesta condição.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Empresa</th><th>Atendimento</th><th>Não conformes</th><th>A avaliar</th><th>Documentos vencidos</th><th>Prazos próximos</th><th>Ações abertas</th><th>Condição</th></tr></thead>
            <tbody>
              {lista.map((e: any) => (
                <tr key={e.id} className="cursor-pointer" onClick={() => aoAbrir(e.id)}>
                  <td className="font-medium">{e.razaoSocial}</td>
                  <td className="tabular-nums">{e.percentual == null ? '—' : `${e.percentual.toLocaleString('pt-BR')}%`}<div className="text-xs text-slate-500">{e.conformes} de {e.aplicaveis} aplicáveis</div></td>
                  <td className={`tabular-nums ${e.naoConformes + e.parciais ? 'text-red-700' : ''}`}>{e.naoConformes}{e.parciais ? ` + ${e.parciais} parcial(is)` : ''}</td>
                  <td className="tabular-nums">{e.aAvaliar + e.naoAvaliados}</td>
                  <td className={`tabular-nums ${e.documentosVencidos ? 'text-red-700' : ''}`}>{e.documentosVencidos}{e.documentosPendentes ? <span className="text-xs text-slate-500"> · {e.documentosPendentes} pendente(s)</span> : ''}</td>
                  <td className="tabular-nums">{e.documentosProximos + e.acoesProximas}</td>
                  <td className="tabular-nums">{e.acoesAbertas}{e.acoesAtrasadas ? <span className="text-red-700"> · {e.acoesAtrasadas} atrasada(s)</span> : ''}</td>
                  <td><Etiqueta cor={COR_CLASSE[e.classe]}>{CLASSES_EMPRESA[e.classe as keyof typeof CLASSES_EMPRESA]}</Etiqueta></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">A condição considera a matriz da empresa toda, os documentos e as ações. A pior condição prevalece.</p>
    </>
  );
}

function FormRequisito({ inicial, aoSalvar }: { inicial?: any; aoSalvar: () => void }) {
  const tipos = useTiposDocumento();
  const [d, setD] = useState<any>({
    ativo: true, ...(inicial ?? {}),
    graus: (inicial?.sugestaoGrausRisco ?? []) as number[],
    cnaes: (inicial?.sugestaoCnaePrefixos ?? []).join(', '),
  });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const corpo = {
        titulo: d.titulo, fundamentacao: d.fundamentacao || null, descricao: d.descricao || null, documentoTipoId: d.documentoTipoId || null,
        sugestaoGrausRisco: d.graus, sugestaoCnaePrefixos: String(d.cnaes).split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean),
        sugestaoMinEmpregados: d.sugestaoMinEmpregados ? Number(d.sugestaoMinEmpregados) : null, ativo: d.ativo,
      };
      if (inicial) await api.put(`/requisitos/${inicial.id}`, corpo);
      else await api.post('/requisitos', corpo);
      aoSalvar();
    }}>
      <Campo rotulo="Requisito" obrigatorio><input className="campo" value={d.titulo ?? ''} onChange={set('titulo')} required placeholder="ex.: SESMT dimensionado conforme NR-04" /></Campo>
      <Campo rotulo="Fundamentação legal"><input className="campo" value={d.fundamentacao ?? ''} onChange={set('fundamentacao')} placeholder="ex.: NR-04, item 4.3" /></Campo>
      <Campo rotulo="Descrição"><textarea className="campo" rows={2} value={d.descricao ?? ''} onChange={set('descricao')} /></Campo>
      <Campo rotulo="Atendido por documento do tipo">
        <select className="campo" value={d.documentoTipoId ?? ''} onChange={set('documentoTipoId')}>
          <option value="">Nenhum (avaliação manual)</option>
          {tipos.data?.map((t: any) => <option key={t.id} value={t.id}>{t.sigla ? `${t.sigla} · ` : ''}{t.nome}</option>)}
        </select>
      </Campo>
      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-600">Critérios para sugerir aplicabilidade (opcionais)</legend>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">Graus de risco:</span>
          {[1, 2, 3, 4].map((g) => (
            <label key={g} className="flex items-center gap-1">
              <input type="checkbox" checked={d.graus.includes(g)} onChange={(e) => setD({ ...d, graus: e.target.checked ? [...d.graus, g].sort() : d.graus.filter((x: number) => x !== g) })} /> {g}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Início do CNAE (separe por vírgula)"><input className="campo" value={d.cnaes} onChange={set('cnaes')} placeholder="ex.: 41, 42, 43" /></Campo>
          <Campo rotulo="A partir de quantos empregados"><input className="campo" type="number" min={1} value={d.sugestaoMinEmpregados ?? ''} onChange={set('sugestaoMinEmpregados')} /></Campo>
        </div>
        <p className="mt-2 text-xs text-slate-500">Servem só para a triagem: o sistema mostra uma sugestão, e o profissional decide em cada empresa.</p>
      </fieldset>
      {inicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
    </Formulario>
  );
}

function Requisitos() {
  const s = useSessao();
  const qc = useQueryClient();
  const [inativos, setInativos] = useState(false);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [msg, setMsg] = useState<string>();
  const [erro, setErro] = useState<unknown>();
  const q = useQuery({ queryKey: ['requisitos', inativos], queryFn: () => api.get(`/requisitos${qs({ inativos: inativos ? 1 : undefined })}`) });
  const pode = s.pode('conformidade.editar');
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['requisitos'] }); qc.invalidateQueries({ queryKey: ['conformidade'] }); };
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
                const r = await api.post('/requisitos/dos-tipos-de-documento');
                setMsg(r.incluidos ? `${r.incluidos} requisito(s) criados a partir dos tipos de documento.` : 'Todos os tipos de documento ativos já têm requisito.');
                recarregar();
              } catch (x) { setErro(x); }
            }}><Wand2 size={16} /> Gerar dos tipos de documento</button>
            <button className="btn-primario" onClick={() => setEdit(null)}><Plus size={16} /> Novo requisito</button>
          </div>
        )}
      </div>
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !q.data?.length ? <Vazio>Nenhum requisito cadastrado.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Requisito</th><th>Fundamentação</th><th>Situação vem de</th><th>Critérios de sugestão</th><th /></tr></thead>
            <tbody>
              {q.data.map((r: any) => (
                <tr key={r.id} className={pode ? 'cursor-pointer' : ''} onClick={() => pode && setEdit(r)}>
                  <td className="font-medium">{r.titulo}</td>
                  <td>{r.fundamentacao ?? '—'}</td>
                  <td>{r.documentoTipoId ? `Documento ${r.documentoTipoSigla ?? r.documentoTipoNome}` : 'Avaliação manual'}</td>
                  <td className="text-xs text-slate-600">
                    {[r.sugestaoGrausRisco.length ? `GR ${r.sugestaoGrausRisco.join(', ')}` : '', r.sugestaoCnaePrefixos.length ? `CNAE ${r.sugestaoCnaePrefixos.join(', ')}` : '',
                      r.sugestaoMinEmpregados ? `≥ ${r.sugestaoMinEmpregados} empregados` : ''].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>{!r.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo={edit ? 'Editar requisito' : 'Novo requisito'} aberto={edit !== undefined} aoFechar={() => setEdit(undefined)} largura="max-w-xl">
        {edit !== undefined && <FormRequisito key={edit?.id ?? 'novo'} inicial={edit ?? undefined} aoSalvar={() => { setEdit(undefined); recarregar(); }} />}
      </Modal>
    </>
  );
}

export function Conformidade() {
  const s = useSessao();
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'matriz';
  const ABAS: { aba: Aba; rotulo: string }[] = [
    { aba: 'matriz', rotulo: 'Matriz da empresa' }, { aba: 'empresas', rotulo: 'Visão por empresa' }, { aba: 'requisitos', rotulo: 'Requisitos' },
  ];
  return (
    <>
      <Titulo titulo="Matriz de conformidade" subtitulo="Requisitos legais por empresa: aplicabilidade decidida pelo profissional, situação pelos documentos ou pela avaliação" />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <button key={a.aba} onClick={() => setParams({ aba: a.aba })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.aba ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === 'matriz' && <Matriz />}
      {aba === 'empresas' && <VisaoEmpresas aoAbrir={(id) => { s.setEmpresaId(id); setParams({ aba: 'matriz' }); }} />}
      {aba === 'requisitos' && <Requisitos />}
    </>
  );
}
