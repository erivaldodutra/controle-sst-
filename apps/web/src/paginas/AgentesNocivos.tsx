import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AGENTES_EXIGEM_DESCRICAO, AGENTES_LIMITE_TOLERANCIA, REQUISITOS_EPI, SEM_AGENTE_NOCIVO, TIPOS_AVALIACAO, UNIDADES_MEDIDA,
  UTILIZACAO_EPC, UTILIZACAO_EPI,
} from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { CodigoTabela } from '../componentes/esocial';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstrutura } from './Estrutura';

const VAZIO = {
  codigo: '', descricao: '', tpAval: '', intConc: '', limTol: '', unMed: '', tecMedicao: '', nrProcJud: '',
  utilizEpc: '', eficEpc: '', utilizEpi: '', eficEpi: '', epis: [] as string[], epiCompl: null as Record<string, 'S' | 'N'> | null, inicio: '', fim: '',
};
const num = (v: any) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));

function SimNao({ valor, onChange, rotulo }: { valor: string; onChange: (v: 'S' | 'N') => void; rotulo: string }) {
  return (
    <div className="flex items-center gap-3 text-sm" role="radiogroup" aria-label={rotulo}>
      {(['S', 'N'] as const).map((v) => (
        <label key={v} className="inline-flex items-center gap-1.5">
          <input type="radio" name={rotulo} checked={valor === v} onChange={() => onChange(v)} required /> {v === 'S' ? 'Sim' : 'Não'}
        </label>
      ))}
    </div>
  );
}

/** Pergunta com rádios (não pode ficar dentro de <label>). */
const Pergunta = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <div><span className="rotulo">{rotulo}<span className="text-red-600"> *</span></span><div className="py-2">{children}</div></div>
);

function FormAgente({ gheId, a, aoSalvar }: { gheId: string; a: any | null; aoSalvar: () => void }) {
  const [d, setD] = useState<any>(a ? {
    ...VAZIO, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === null ? (k === 'epiCompl' ? null : '') : v])),
  } : { ...VAZIO });
  const [ca, setCa] = useState('');
  const m = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const sem = d.codigo === SEM_AGENTE_NOCIVO;
  const quant = Number(d.tpAval) === 1;
  const epi = Number(d.utilizEpi) === 2;
  return (
    <Formulario aoEnviar={async () => {
      const corpo = {
        gheId, codigo: d.codigo, descricao: d.descricao || null, tpAval: sem ? null : num(d.tpAval),
        intConc: quant ? num(d.intConc) : null, limTol: quant && AGENTES_LIMITE_TOLERANCIA.includes(d.codigo) ? num(d.limTol) : null,
        unMed: quant ? num(d.unMed) : null, tecMedicao: quant ? d.tecMedicao || null : null,
        nrProcJud: d.codigo === '05.01.001' ? d.nrProcJud || null : null,
        utilizEpc: sem ? null : num(d.utilizEpc), eficEpc: !sem && Number(d.utilizEpc) === 2 ? d.eficEpc || null : null,
        utilizEpi: sem ? null : num(d.utilizEpi), eficEpi: !sem && epi ? d.eficEpi || null : null,
        epis: !sem && epi ? d.epis : [], epiCompl: !sem && epi ? d.epiCompl : null,
        inicio: d.inicio, fim: d.fim || null,
      };
      if (a) await api.put(`/esocial/agentes/${a.id}`, corpo); else await api.post('/esocial/agentes', corpo);
      aoSalvar();
    }}>
      <Campo rotulo="Agente nocivo (Tabela 24 do eSocial)" obrigatorio>
        <CodigoTabela tabela={24} valor={d.codigo} onChange={(c) => setD({ ...d, codigo: c })} required />
      </Campo>
      {sem && <Aviso tipo="info">09.01.001 indica ausência de agente nocivo. Não pode ser combinado com outros agentes no mesmo GHE.</Aviso>}
      {(!sem || !d.inicio || d.inicio < '2024-04-22') && (
        <Campo rotulo={`Descrição do agente${AGENTES_EXIGEM_DESCRICAO.includes(d.codigo) ? ' (obrigatória para este código)' : ' (opcional)'}`}>
          <input className="campo" maxLength={100} value={d.descricao} onChange={m('descricao')} required={AGENTES_EXIGEM_DESCRICAO.includes(d.codigo)} />
        </Campo>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Vigente desde" obrigatorio><input type="date" className="campo" required value={d.inicio} onChange={m('inicio')} /></Campo>
        <Campo rotulo="Até (vazio se atual)"><input type="date" className="campo" value={d.fim} onChange={m('fim')} /></Campo>
      </div>
      {!sem && (
        <>
          <Campo rotulo="Tipo de avaliação" obrigatorio>
            <select className="campo" required value={d.tpAval} onChange={m('tpAval')}>
              <option value="" />{Object.entries(TIPOS_AVALIACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          {quant && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Intensidade ou concentração" obrigatorio><input className="campo" inputMode="decimal" required value={d.intConc} onChange={m('intConc')} /></Campo>
              <Campo rotulo="Unidade de medida" obrigatorio>
                <select className="campo" required value={d.unMed} onChange={m('unMed')}>
                  <option value="" />{Object.entries(UNIDADES_MEDIDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
              {AGENTES_LIMITE_TOLERANCIA.includes(d.codigo) && (
                <Campo rotulo="Limite de tolerância" obrigatorio><input className="campo" inputMode="decimal" required value={d.limTol} onChange={m('limTol')} /></Campo>
              )}
              <Campo rotulo="Técnica de medição" obrigatorio className="sm:col-span-3"><input className="campo" maxLength={40} required value={d.tecMedicao} onChange={m('tecMedicao')} placeholder="Ex.: NHO 01" /></Campo>
            </div>
          )}
          {d.codigo === '05.01.001' && (
            <Campo rotulo="Número do processo administrativo ou judicial"><input className="campo" value={d.nrProcJud} onChange={m('nrProcJud')} /></Campo>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="EPC (proteção coletiva)" obrigatorio>
              <select className="campo" required value={d.utilizEpc} onChange={m('utilizEpc')}>
                <option value="" />{Object.entries(UTILIZACAO_EPC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            {Number(d.utilizEpc) === 2 && <Pergunta rotulo="O EPC é eficaz?"><SimNao rotulo="EPC eficaz" valor={d.eficEpc} onChange={(v) => setD({ ...d, eficEpc: v })} /></Pergunta>}
            <Campo rotulo="EPI (proteção individual)" obrigatorio>
              <select className="campo" required value={d.utilizEpi} onChange={m('utilizEpi')}>
                <option value="" />{Object.entries(UTILIZACAO_EPI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            {epi && <Pergunta rotulo="O EPI é eficaz?"><SimNao rotulo="EPI eficaz" valor={d.eficEpi} onChange={(v) => setD({ ...d, eficEpi: v })} /></Pergunta>}
          </div>
          {epi && (
            <>
              <div><span className="rotulo">EPIs: número do CA ou do documento de avaliação</span>
                <div className="flex gap-2">
                  <input className="campo" value={ca} maxLength={255} onChange={(e) => setCa(e.target.value)} aria-label="CA do EPI"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ca.trim()) { setD({ ...d, epis: [...d.epis, ca.trim()] }); setCa(''); } } }} />
                  <button type="button" className="btn-secundario" onClick={() => { if (ca.trim()) { setD({ ...d, epis: [...d.epis, ca.trim()] }); setCa(''); } }}><Plus size={15} /> Incluir</button>
                </div>
              </div>
              {d.epis.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {d.epis.map((x: string, i: number) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs">
                      {x}<button type="button" aria-label={`Remover ${x}`} onClick={() => setD({ ...d, epis: d.epis.filter((_: string, j: number) => j !== i) })}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <fieldset className="rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-medium">Requisitos das NR-06 e NR-09 para o EPI</legend>
                <div className="space-y-2">
                  {Object.entries(REQUISITOS_EPI).map(([k, r]) => (
                    <div key={k} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{r}</span>
                      <SimNao rotulo={r} valor={d.epiCompl?.[k] ?? ''} onChange={(v) => setD({ ...d, epiCompl: { ...(d.epiCompl ?? {}), [k]: v } })} />
                    </div>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </>
      )}
      <p className="text-xs text-slate-500">
        Estes dados vêm do laudo e do PGR e precisam ser conferidos pelo profissional responsável. O sistema só confere as regras de preenchimento do eSocial.
      </p>
    </Formulario>
  );
}

export function AgentesNocivos() {
  const s = useSessao();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const gheId = params.get('ghe') ?? '';
  const [janela, setJanela] = useState<null | { a: any | null }>(null);
  const [remover, setRemover] = useState<any>(null);
  const ghes = useEstrutura(s.empresaId, 'ghes');
  const q = useQuery({
    queryKey: ['esocial-agentes', s.empresaId, gheId],
    queryFn: () => api.get(`/esocial/agentes${qs({ empresaId: s.empresaId, gheId })}`),
    enabled: !!s.empresaId,
  });
  const editar = !!s.empresaId && s.pode('esocial.preparar');
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['esocial-agentes'] });
    qc.invalidateQueries({ queryKey: ['esocial-pendencias'] });
  };
  const porGhe = new Map<string, any[]>();
  for (const a of q.data ?? []) porGhe.set(a.gheId, [...(porGhe.get(a.gheId) ?? []), a]);
  const lista = (ghes.data ?? []).filter((g: any) => !gheId || g.id === gheId);
  return (
    <>
      <Titulo titulo="Agentes nocivos por GHE" subtitulo="Fatores de risco informados no S-2240 de cada trabalhador lotado no GHE. Use 09.01.001 quando não houver exposição." />
      <ExigeEmpresa empresaId={s.empresaId}>
        <div className="mb-3 flex flex-wrap gap-2">
          <select className="campo max-w-sm" value={gheId} onChange={(e) => setParams(e.target.value ? { ghe: e.target.value } : {})} aria-label="GHE">
            <option value="">Todos os GHEs</option>
            {(ghes.data ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.codigo} · {g.nome}</option>)}
          </select>
        </div>
        {ghes.isLoading || q.isLoading ? <Carregando /> : !lista.length ? (
          <div className="cartao"><Vazio>Nenhum GHE cadastrado. Cadastre os GHEs em Estrutura da empresa.</Vazio></div>
        ) : lista.map((g: any) => {
          const ag = porGhe.get(g.id) ?? [];
          return (
            <section key={g.id} className="cartao mb-4 overflow-x-auto">
              <div className="flex items-center justify-between gap-3 px-5 pt-4">
                <h2 className="text-sm font-semibold">{g.codigo} · {g.nome}</h2>
                {editar && <button className="btn-secundario" onClick={() => setJanela({ a: { gheId: g.id, novo: true } })}><Plus size={15} /> Agente</button>}
              </div>
              {!ag.length ? <p className="px-5 py-4 text-sm text-amber-700">Nenhum agente cadastrado. O S-2240 dos trabalhadores deste GHE não pode ser gerado.</p> : (
                <table className="tabela mt-2">
                  <thead><tr><th>Código</th><th>Agente</th><th>Avaliação</th><th>EPC / EPI</th><th>Vigência</th><th /></tr></thead>
                  <tbody>{ag.map((a: any) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs">{a.codigo}</td>
                      <td>{a.nomeTabela}{a.descricao ? <div className="text-xs text-slate-500">{a.descricao}</div> : null}</td>
                      <td className="text-sm">
                        {a.tpAval ? TIPOS_AVALIACAO[a.tpAval as 1 | 2] : '—'}
                        {a.tpAval === 1 && <div className="text-xs text-slate-500">{String(a.intConc).replace('.', ',')} {UNIDADES_MEDIDA[a.unMed]} · {a.tecMedicao}</div>}
                      </td>
                      <td className="text-sm">
                        {a.utilizEpc === null ? '—' : `EPC: ${UTILIZACAO_EPC[a.utilizEpc as 0 | 1 | 2]}${a.eficEpc ? ` (${a.eficEpc === 'S' ? 'eficaz' : 'não eficaz'})` : ''}`}
                        {a.utilizEpi !== null && <div>EPI: {UTILIZACAO_EPI[a.utilizEpi as 0 | 1 | 2]}{a.eficEpi ? ` (${a.eficEpi === 'S' ? 'eficaz' : 'não eficaz'})` : ''}{a.epis?.length ? ` · CA ${a.epis.join(', ')}` : ''}</div>}
                      </td>
                      <td>{dataBr(a.inicio)} a {a.fim ? dataBr(a.fim) : 'atual'}</td>
                      <td className="whitespace-nowrap text-right">
                        {editar && <>
                          <button className="btn-secundario mr-1 px-2" aria-label="Editar" title="Editar" onClick={() => setJanela({ a })}><Pencil size={14} /></button>
                          <button className="btn-secundario px-2" aria-label="Remover" title="Remover" onClick={() => setRemover(a)}><Trash2 size={14} /></button>
                        </>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </section>
          );
        })}
      </ExigeEmpresa>
      <Modal titulo={janela?.a?.novo ? 'Novo agente nocivo' : 'Editar agente nocivo'} aberto={!!janela} aoFechar={() => setJanela(null)}>
        {janela && <FormAgente gheId={janela.a.gheId} a={janela.a.novo ? null : janela.a} aoSalvar={() => { atualizar(); setJanela(null); }} />}
      </Modal>
      <Modal titulo="Remover agente" aberto={!!remover} aoFechar={() => setRemover(null)} largura="max-w-lg">
        {remover && (
          <Formulario perigo botao="Remover" aoEnviar={async () => { await api.delete(`/esocial/agentes/${remover.id}`); atualizar(); setRemover(null); }}>
            <p className="text-sm text-slate-700">
              Remove {remover.codigo} do GHE. Eventos já gerados não mudam. Se o agente deixou de existir em uma data, prefira informar o fim da vigência.
            </p>
          </Formulario>
        )}
      </Modal>
    </>
  );
}
