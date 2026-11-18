import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MODALIDADES_TURMA, TIPOS_TURMA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Formulario, SituacaoPrazo, useBiblioteca } from '../componentes/saude';
import { Campo, Carregando, Etiqueta, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstrutura } from './Estrutura';

type Aba = 'turmas' | 'biblioteca' | 'matriz';

const horas = (n: number | null | undefined) => (n == null ? '—' : `${String(n).replace('.', ',')} h`);

function FormTreinamento({ inicial, aoSalvar }: { inicial?: any; aoSalvar: () => void }) {
  const [d, setD] = useState<any>({ ativo: true, ...(inicial ?? {}) });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const num = (v: any) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
  return (
    <Formulario aoEnviar={async () => {
      const corpo = {
        nome: d.nome, norma: d.norma || null, cargaHoraria: num(d.cargaHoraria), cargaHorariaReciclagem: num(d.cargaHorariaReciclagem),
        periodicidadeMeses: num(d.periodicidadeMeses), conteudoProgramatico: d.conteudoProgramatico || null, ativo: d.ativo,
      };
      if (inicial) await api.put(`/treinamentos/${inicial.id}`, corpo);
      else await api.post('/treinamentos', corpo);
      aoSalvar();
    }}>
      <Campo rotulo="Nome do treinamento" obrigatorio><input className="campo" value={d.nome ?? ''} onChange={set('nome')} required /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Norma de referência"><input className="campo" value={d.norma ?? ''} onChange={set('norma')} placeholder="ex.: NR-35" /></Campo>
        <Campo rotulo="Reciclagem a cada (meses)"><input className="campo" type="number" min={1} max={120} value={d.periodicidadeMeses ?? ''} onChange={set('periodicidadeMeses')} placeholder="vazio = sem reciclagem" /></Campo>
        <Campo rotulo="Carga horária inicial (h)" obrigatorio><input className="campo" inputMode="decimal" value={d.cargaHoraria ?? ''} onChange={set('cargaHoraria')} required /></Campo>
        <Campo rotulo="Carga horária da reciclagem (h)"><input className="campo" inputMode="decimal" value={d.cargaHorariaReciclagem ?? ''} onChange={set('cargaHorariaReciclagem')} /></Campo>
      </div>
      <Campo rotulo="Conteúdo programático (sai no certificado)"><textarea className="campo" rows={6} value={d.conteudoProgramatico ?? ''} onChange={set('conteudoProgramatico')} /></Campo>
      <p className="text-xs text-slate-500">Confira a carga horária e a periodicidade na norma vigente. Mudanças valem para as próximas turmas; validades já emitidas não mudam.</p>
      {inicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
    </Formulario>
  );
}

export function FormTurma({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial?: any; aoSalvar: (t: any) => void }) {
  const bib = useBiblioteca();
  const [d, setD] = useState<any>({
    tipo: 'inicial', modalidade: 'presencial', dataInicio: hojeIso(), dataFim: hojeIso(), ...(inicial ?? {}),
  });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const escolherTreinamento = (id: string) => {
    const t = bib.data?.find((x) => x.id === id);
    const ch = t ? (d.tipo === 'reciclagem' ? t.cargaHorariaReciclagem ?? t.cargaHoraria : t.cargaHoraria) : '';
    setD({ ...d, treinamentoId: id, cargaHoraria: d.cargaHoraria || ch });
  };
  return (
    <Formulario aoEnviar={async () => {
      const corpo = {
        treinamentoId: d.treinamentoId, tipo: d.tipo, modalidade: d.modalidade, dataInicio: d.dataInicio, dataFim: d.dataFim,
        cargaHoraria: Number(String(d.cargaHoraria).replace(',', '.')), instrutorNome: d.instrutorNome,
        instrutorQualificacao: d.instrutorQualificacao || null, responsavelTecnico: d.responsavelTecnico || null,
        local: d.local || null, observacoes: d.observacoes || null,
      };
      aoSalvar(inicial ? await api.put(`/turmas/${inicial.id}`, corpo) : await api.post(`/empresas/${empresaId}/turmas`, corpo));
    }}>
      <Campo rotulo="Treinamento" obrigatorio>
        <select className="campo" value={d.treinamentoId ?? ''} onChange={(e) => escolherTreinamento(e.target.value)} required>
          <option value="" />
          {bib.data?.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.norma ? ` (${t.norma})` : ''}</option>)}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo" obrigatorio>
          <select className="campo" value={d.tipo} onChange={set('tipo')}>{Object.entries(TIPOS_TURMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <Campo rotulo="Modalidade" obrigatorio>
          <select className="campo" value={d.modalidade} onChange={set('modalidade')}>{Object.entries(MODALIDADES_TURMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <Campo rotulo="Início" obrigatorio><input className="campo" type="date" value={d.dataInicio} onChange={set('dataInicio')} required /></Campo>
        <Campo rotulo="Término" obrigatorio><input className="campo" type="date" value={d.dataFim} onChange={set('dataFim')} required /></Campo>
        <Campo rotulo="Carga horária (h)" obrigatorio><input className="campo" inputMode="decimal" value={d.cargaHoraria ?? ''} onChange={set('cargaHoraria')} required /></Campo>
        <Campo rotulo="Local"><input className="campo" value={d.local ?? ''} onChange={set('local')} /></Campo>
        <Campo rotulo="Instrutor" obrigatorio><input className="campo" value={d.instrutorNome ?? ''} onChange={set('instrutorNome')} required /></Campo>
        <Campo rotulo="Qualificação do instrutor"><input className="campo" value={d.instrutorQualificacao ?? ''} onChange={set('instrutorQualificacao')} /></Campo>
      </div>
      <Campo rotulo="Responsável técnico pelo treinamento"><input className="campo" value={d.responsavelTecnico ?? ''} onChange={set('responsavelTecnico')} placeholder="Nome e registro profissional" /></Campo>
      <Campo rotulo="Observações"><textarea className="campo" rows={2} value={d.observacoes ?? ''} onChange={set('observacoes')} /></Campo>
    </Formulario>
  );
}

function Turmas({ empresaId }: { empresaId: string | null }) {
  const s = useSessao();
  const nav = useNavigate();
  const [situacao, setSituacao] = useState('');
  const [nova, setNova] = useState(false);
  const lista = useQuery({
    queryKey: ['turmas', empresaId, situacao],
    queryFn: () => api.get<any[]>(`/turmas${qs({ empresaId, situacao })}`),
  });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="campo max-w-48" value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação">
          <option value="">Todas</option><option value="planejada">Planejadas</option><option value="realizada">Realizadas</option><option value="cancelada">Canceladas</option>
        </select>
        {s.pode('treinamentos.editar') && empresaId && <button className="btn-primario ml-auto" onClick={() => setNova(true)}><Plus size={16} /> Nova turma</button>}
      </div>
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : !lista.data?.length ? <Vazio>Nenhuma turma.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Treinamento</th><th>Período</th><th>Tipo</th><th>Instrutor</th><th className="text-right">Participantes</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.data.map((t) => (
                <tr key={t.id} className="cursor-pointer" onClick={() => nav(`/turmas/${t.id}`)}>
                  <td><div className="font-medium">{t.treinamentoNome}</div>{t.norma && <div className="text-xs text-slate-500">{t.norma}</div>}</td>
                  <td>{dataBr(t.dataInicio)}{t.dataFim !== t.dataInicio && ` a ${dataBr(t.dataFim)}`}</td>
                  <td>{TIPOS_TURMA[t.tipo as keyof typeof TIPOS_TURMA]}</td>
                  <td>{t.instrutorNome}</td>
                  <td className="text-right tabular-nums">{t.situacao === 'realizada' ? `${t.aprovados}/${t.participantes} aprovados` : t.participantes}</td>
                  <td><SituacaoPrazo s={t.situacao} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Nova turma" aberto={nova} aoFechar={() => setNova(false)}>
        {nova && empresaId && <FormTurma empresaId={empresaId} aoSalvar={(t) => nav(`/turmas/${t.id}`)} />}
      </Modal>
    </>
  );
}

function Biblioteca() {
  const s = useSessao();
  const qc = useQueryClient();
  const [inativos, setInativos] = useState(false);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const lista = useBiblioteca(inativos);
  const pode = s.pode('treinamentos.editar');
  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
        {pode && <button className="btn-primario ml-auto" onClick={() => setEdit(null)}><Plus size={16} /> Novo treinamento</button>}
      </div>
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : !lista.data?.length ? <Vazio>Nenhum treinamento na biblioteca. Cadastre os treinamentos que sua consultoria aplica.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Treinamento</th><th>Norma</th><th>Carga inicial</th><th>Reciclagem</th><th>Periodicidade</th><th /></tr></thead>
            <tbody>
              {lista.data.map((t) => (
                <tr key={t.id} className={pode ? 'cursor-pointer' : ''} onClick={() => pode && setEdit(t)}>
                  <td className="font-medium">{t.nome}</td><td>{t.norma ?? '—'}</td><td>{horas(t.cargaHoraria)}</td><td>{horas(t.cargaHorariaReciclagem)}</td>
                  <td>{t.periodicidadeMeses ? `${t.periodicidadeMeses} meses` : 'Sem reciclagem'}</td>
                  <td>{!t.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo={edit ? 'Editar treinamento' : 'Novo treinamento'} aberto={edit !== undefined} aoFechar={() => setEdit(undefined)} largura="max-w-lg">
        {edit !== undefined && <FormTreinamento key={edit?.id ?? 'novo'} inicial={edit ?? undefined} aoSalvar={() => { setEdit(undefined); qc.invalidateQueries({ queryKey: ['treinamentos'] }); }} />}
      </Modal>
    </>
  );
}

function Matriz({ empresaId }: { empresaId: string }) {
  const s = useSessao();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['matriz', empresaId], queryFn: () => api.get<any[]>(`/empresas/${empresaId}/matriz-treinamentos`) });
  const bib = useBiblioteca();
  const funcoes = useEstrutura(empresaId, 'funcoes');
  const ghes = useEstrutura(empresaId, 'ghes');
  const [d, setD] = useState({ treinamentoId: '', alvo: '' });
  const pode = s.pode('treinamentos.editar');
  const recarregar = () => qc.invalidateQueries({ queryKey: ['matriz', empresaId] });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : !lista.data?.length ? <Vazio>Nenhum treinamento exigido ainda. Defina quais treinamentos cada função ou GHE precisa.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Treinamento</th><th>Exigido de</th><th>Periodicidade</th>{pode && <th />}</tr></thead>
            <tbody>
              {lista.data.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.treinamentoNome}{m.norma && <span className="text-xs text-slate-500"> · {m.norma}</span>}</td>
                  <td>{m.funcaoId ? <>Função <b>{m.funcaoNome}</b></> : <>GHE <b>{m.gheCodigo}</b> {m.gheNome}</>}</td>
                  <td>{m.periodicidadeMeses ? `${m.periodicidadeMeses} meses` : '—'}</td>
                  {pode && (
                    <td className="text-right">
                      <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover"
                        onClick={async () => { await api.delete(`/matriz-treinamentos/${m.id}`); recarregar(); }}><Trash2 size={15} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pode && (
        <div className="cartao p-4">
          <h3 className="mb-3 text-sm font-semibold">Exigir treinamento</h3>
          <Formulario botao="Adicionar" aoEnviar={async () => {
            const [tipo, id] = d.alvo.split(':');
            await api.post(`/empresas/${empresaId}/matriz-treinamentos`, { treinamentoId: d.treinamentoId, funcaoId: tipo === 'f' ? id : null, gheId: tipo === 'g' ? id : null });
            setD({ ...d, alvo: '' });
            recarregar();
          }}>
            <Campo rotulo="Treinamento" obrigatorio>
              <select className="campo" value={d.treinamentoId} onChange={(e) => setD({ ...d, treinamentoId: e.target.value })} required>
                <option value="" />
                {bib.data?.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Para a função ou GHE" obrigatorio>
              <select className="campo" value={d.alvo} onChange={(e) => setD({ ...d, alvo: e.target.value })} required>
                <option value="" />
                <optgroup label="Funções">{funcoes.data?.map((f: any) => <option key={f.id} value={`f:${f.id}`}>{f.nome}</option>)}</optgroup>
                <optgroup label="GHE">{ghes.data?.map((g: any) => <option key={g.id} value={`g:${g.id}`}>{g.codigo} {g.nome}</option>)}</optgroup>
              </select>
            </Campo>
          </Formulario>
        </div>
      )}
    </div>
  );
}

export function Treinamentos() {
  const s = useSessao();
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'turmas';
  const ABAS: { aba: Aba; rotulo: string }[] = [
    { aba: 'turmas', rotulo: 'Turmas' }, { aba: 'matriz', rotulo: 'Matriz por função e GHE' }, { aba: 'biblioteca', rotulo: 'Biblioteca de treinamentos' },
  ];
  return (
    <>
      <Titulo titulo="Treinamentos" subtitulo={<>Turmas, presença, certificados e treinamentos exigidos. Pendências em <Link className="text-marca-700 hover:underline" to="/vencimentos?tipo=treinamento">Vencimentos</Link>.</>} />
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <button key={a.aba} onClick={() => setParams({ aba: a.aba })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.aba ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === 'turmas' && <Turmas empresaId={s.empresaId} />}
      {aba === 'biblioteca' && <Biblioteca />}
      {aba === 'matriz' && <ExigeEmpresa empresaId={s.empresaId}>{s.empresaId && <Matriz empresaId={s.empresaId} />}</ExigeEmpresa>}
    </>
  );
}
