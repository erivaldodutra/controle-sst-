import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GRAVIDADES, SITUACOES_OCORRENCIA, TIPOS_INSPECAO, TIPOS_OCORRENCIA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Formulario } from '../componentes/saude';
import { Campo, Carregando, Etiqueta, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstabelecimentos, useEstrutura } from './Estrutura';

type Aba = 'inspecoes' | 'ocorrencias';

const COR_OC: Record<string, string> = {
  aberta: 'bg-red-100 text-red-800', em_investigacao: 'bg-amber-100 text-amber-800', encerrada: 'bg-emerald-100 text-emerald-800',
};
const COR_GRAV: Record<string, string> = {
  sem_lesao: 'bg-slate-100 text-slate-600', leve: 'bg-sky-50 text-sky-700', moderada: 'bg-amber-100 text-amber-800',
  grave: 'bg-red-100 text-red-800', fatal: 'bg-red-600 text-white',
};
export const SituacaoOcorrencia = ({ s }: { s: string }) =>
  <Etiqueta cor={COR_OC[s] ?? ''}>{SITUACOES_OCORRENCIA[s as keyof typeof SITUACOES_OCORRENCIA]}</Etiqueta>;
export const Gravidade = ({ g }: { g: string }) => <Etiqueta cor={COR_GRAV[g] ?? ''}>{GRAVIDADES[g as keyof typeof GRAVIDADES]}</Etiqueta>;
export const SituacaoInspecao = ({ s }: { s: string }) =>
  <Etiqueta cor={s === 'aberta' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'}>{s === 'aberta' ? 'Aberta' : 'Concluída'}</Etiqueta>;

/** Estabelecimento e setor (o setor depende do estabelecimento). */
export function LocalCampos({ empresaId, d, setD, obrigatorio = true }: { empresaId: string; d: any; setD: (d: any) => void; obrigatorio?: boolean }) {
  const ests = useEstabelecimentos(empresaId);
  const setores = useEstrutura(empresaId, 'setores');
  return (
    <div className="grid grid-cols-2 gap-3">
      <Campo rotulo="Estabelecimento" obrigatorio={obrigatorio}>
        <select className="campo" value={d.estabelecimentoId ?? ''} onChange={(e) => setD({ ...d, estabelecimentoId: e.target.value, setorId: '' })} required={obrigatorio}>
          <option value="" />
          {ests.data?.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Setor">
        <select className="campo" value={d.setorId ?? ''} onChange={(e) => setD({ ...d, setorId: e.target.value })}>
          <option value="" />
          {setores.data?.filter((x: any) => x.estabelecimentoId === d.estabelecimentoId).map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </Campo>
    </div>
  );
}

export function FormInspecao({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial?: any; aoSalvar: (r: any) => void }) {
  const [d, setD] = useState<any>(inicial ?? { data: hojeIso(), tipo: 'rotina' });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const corpo = { estabelecimentoId: d.estabelecimentoId, setorId: d.setorId || null, data: d.data, tipo: d.tipo,
        responsavelNome: d.responsavelNome, escopo: d.escopo || null };
      aoSalvar(inicial ? await api.put(`/inspecoes/${inicial.id}`, corpo) : await api.post('/inspecoes', { empresaId, ...corpo }));
    }}>
      <LocalCampos empresaId={empresaId} d={d} setD={setD} />
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Data" obrigatorio><input className="campo" type="date" value={d.data} max={hojeIso()} onChange={set('data')} required /></Campo>
        <Campo rotulo="Tipo" obrigatorio><select className="campo" value={d.tipo} onChange={set('tipo')}>{Object.entries(TIPOS_INSPECAO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
      </div>
      <Campo rotulo="Responsável pela inspeção" obrigatorio><input className="campo" value={d.responsavelNome ?? ''} onChange={set('responsavelNome')} required /></Campo>
      <Campo rotulo="Escopo"><textarea className="campo" rows={2} value={d.escopo ?? ''} onChange={set('escopo')} placeholder="Áreas, atividades ou equipamentos verificados" /></Campo>
    </Formulario>
  );
}

export function FormOcorrencia({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial?: any; aoSalvar: (r: any) => void }) {
  const [d, setD] = useState<any>(inicial ?? { tipo: 'acidente_tipico', gravidade: 'leve', houveAfastamento: false });
  const [buscaFunc, setBuscaFunc] = useState('');
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const funcs = useQuery({
    queryKey: ['funcionarios-busca', empresaId, buscaFunc],
    queryFn: () => api.get(`/funcionarios${qs({ empresaId, busca: buscaFunc, limite: 20 })}`),
    enabled: buscaFunc.trim().length >= 3,
  });
  const agora = new Date();
  const max = `${hojeIso()}T${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  return (
    <Formulario aoEnviar={async () => {
      const corpo = {
        estabelecimentoId: d.estabelecimentoId, setorId: d.setorId || null, funcionarioId: d.funcionarioId || null, dataHora: d.dataHora,
        tipo: d.tipo, gravidade: d.gravidade, local: d.local || null, descricao: d.descricao, medidasImediatas: d.medidasImediatas || null,
        houveAfastamento: !!d.houveAfastamento,
      };
      aoSalvar(inicial ? await api.put(`/ocorrencias/${inicial.id}`, corpo) : await api.post('/ocorrencias', { empresaId, ...corpo }));
    }}>
      <LocalCampos empresaId={empresaId} d={d} setD={setD} />
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Data e hora" obrigatorio><input className="campo" type="datetime-local" value={d.dataHora ?? ''} max={max} onChange={set('dataHora')} required /></Campo>
        <Campo rotulo="Tipo" obrigatorio><select className="campo" value={d.tipo} onChange={set('tipo')}>{Object.entries(TIPOS_OCORRENCIA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
        <Campo rotulo="Gravidade" obrigatorio><select className="campo" value={d.gravidade} onChange={set('gravidade')}>{Object.entries(GRAVIDADES).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
      </div>
      <Campo rotulo="Funcionário envolvido">
        {d.funcionarioId ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{d.funcionarioNome}</span>
            <button type="button" className="text-marca-700 hover:underline" onClick={() => setD({ ...d, funcionarioId: null, funcionarioNome: null })}>trocar</button>
          </div>
        ) : (
          <>
            <input className="campo" value={buscaFunc} onChange={(e) => setBuscaFunc(e.target.value)} placeholder="Digite 3 letras do nome ou o CPF (opcional)" />
            {funcs.data?.itens?.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200">
                {funcs.data.itens.map((f: any) => (
                  <button type="button" key={f.vinculoId} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => { setD({ ...d, funcionarioId: f.funcionarioId, funcionarioNome: f.nome }); setBuscaFunc(''); }}>
                    {f.nome} <span className="text-xs text-slate-500">{f.matricula ? `· ${f.matricula}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Campo>
      <Campo rotulo="Local"><input className="campo" value={d.local ?? ''} onChange={set('local')} /></Campo>
      <Campo rotulo="Descrição do ocorrido" obrigatorio><textarea className="campo" rows={3} value={d.descricao ?? ''} onChange={set('descricao')} required /></Campo>
      <Campo rotulo="Medidas imediatas"><textarea className="campo" rows={2} value={d.medidasImediatas ?? ''} onChange={set('medidasImediatas')} /></Campo>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.houveAfastamento} onChange={(e) => setD({ ...d, houveAfastamento: e.target.checked })} /> Houve afastamento</label>
      <p className="text-xs text-slate-500">Este registro é interno. A CAT e o evento S-2210 do eSocial serão tratados na fase do eSocial; nada é transmitido daqui.</p>
    </Formulario>
  );
}

function ListaInspecoes() {
  const s = useSessao();
  const nav = useNavigate();
  const [nova, setNova] = useState(false);
  const q = useQuery({ queryKey: ['inspecoes', s.empresaId], queryFn: () => api.get(`/inspecoes${qs({ empresaId: s.empresaId })}`) });
  return (
    <>
      <div className="mb-3 flex justify-end">
        {s.pode('inspecoes.editar') && s.empresaId && <button className="btn-primario" onClick={() => setNova(true)}><Plus size={16} /> Nova inspeção</button>}
      </div>
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !q.data?.length ? <Vazio>Nenhuma inspeção registrada.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Inspeção</th>{!s.empresaId && <th>Empresa</th>}<th>Local</th><th>Responsável</th><th>Itens</th><th>Ações</th><th>Situação</th></tr></thead>
            <tbody>
              {q.data.map((i: any) => (
                <tr key={i.id} className="cursor-pointer" onClick={() => nav(`/inspecoes/${i.id}`)}>
                  <td><div className="font-medium">{i.codigo}</div><div className="text-xs text-slate-500">{dataBr(i.data)} · {TIPOS_INSPECAO[i.tipo as keyof typeof TIPOS_INSPECAO]}</div></td>
                  {!s.empresaId && <td>{i.empresaNome}</td>}
                  <td>{i.estabelecimentoNome}{i.setorNome ? ` · ${i.setorNome}` : ''}</td>
                  <td>{i.responsavelNome}</td>
                  <td className="tabular-nums">{i.itens}{i.naoConformes > 0 && <span className="text-red-700"> · {i.naoConformes} não conforme(s)</span>}</td>
                  <td className="tabular-nums">{i.acoes}</td>
                  <td><SituacaoInspecao s={i.situacao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Nova inspeção" aberto={nova} aoFechar={() => setNova(false)} largura="max-w-xl">
        {nova && s.empresaId && <FormInspecao empresaId={s.empresaId} aoSalvar={(r) => nav(`/inspecoes/${r.id}`)} />}
      </Modal>
    </>
  );
}

function ListaOcorrencias() {
  const s = useSessao();
  const nav = useNavigate();
  const [nova, setNova] = useState(false);
  const q = useQuery({ queryKey: ['ocorrencias', s.empresaId], queryFn: () => api.get(`/ocorrencias${qs({ empresaId: s.empresaId })}`) });
  return (
    <>
      <div className="mb-3 flex justify-end">
        {s.pode('inspecoes.editar') && s.empresaId && <button className="btn-primario" onClick={() => setNova(true)}><Plus size={16} /> Registrar ocorrência</button>}
      </div>
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !q.data?.length ? <Vazio>Nenhuma ocorrência registrada.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Ocorrência</th>{!s.empresaId && <th>Empresa</th>}<th>Tipo</th><th>Gravidade</th><th>Envolvido</th><th>Ações</th><th>Situação</th></tr></thead>
            <tbody>
              {q.data.map((o: any) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => nav(`/ocorrencias/${o.id}`)}>
                  <td><div className="font-medium">{o.codigo}</div><div className="text-xs text-slate-500">{dataBr(o.dataHora)} {o.dataHora.slice(11)} · {o.estabelecimentoNome}</div></td>
                  {!s.empresaId && <td>{o.empresaNome}</td>}
                  <td>{TIPOS_OCORRENCIA[o.tipo as keyof typeof TIPOS_OCORRENCIA]}</td>
                  <td><Gravidade g={o.gravidade} /></td>
                  <td>{o.funcionarioNome ?? '—'}</td>
                  <td className="tabular-nums">{o.acoes}</td>
                  <td><SituacaoOcorrencia s={o.situacao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Registrar ocorrência" aberto={nova} aoFechar={() => setNova(false)} largura="max-w-2xl">
        {nova && s.empresaId && <FormOcorrencia empresaId={s.empresaId} aoSalvar={(r) => nav(`/ocorrencias/${r.id}`)} />}
      </Modal>
    </>
  );
}

export function Inspecoes() {
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'inspecoes';
  const ABAS: { aba: Aba; rotulo: string }[] = [{ aba: 'inspecoes', rotulo: 'Inspeções' }, { aba: 'ocorrencias', rotulo: 'Acidentes e ocorrências' }];
  return (
    <>
      <Titulo titulo="Inspeções e ocorrências" subtitulo="Inspeções de segurança, acidentes, quase acidentes e investigações, com as ações que geraram" />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <button key={a.aba} onClick={() => setParams({ aba: a.aba })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.aba ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === 'inspecoes' ? <ListaInspecoes /> : <ListaOcorrencias />}
    </>
  );
}
