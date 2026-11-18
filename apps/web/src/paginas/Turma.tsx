import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MODALIDADES_TURMA, TIPOS_TURMA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { cpf, dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Formulario, SituacaoPrazo } from '../componentes/saude';
import { Aviso, Campo, Carregando, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstrutura } from './Estrutura';
import { FormTurma } from './Treinamentos';

function AdicionarParticipantes({ turma, aoSalvar }: { turma: any; aoSalvar: (t: any) => void }) {
  const [funcaoId, setFuncaoId] = useState('');
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const funcoes = useEstrutura(turma.empresaId, 'funcoes');
  const ja = new Set(turma.participantesLista.map((p: any) => p.funcionarioId));
  const lista = useQuery({
    queryKey: ['func-turma', turma.empresaId, funcaoId, busca],
    queryFn: () => api.get(`/funcionarios${qs({ empresaId: turma.empresaId, funcaoId, busca, situacao: 'ativo', limite: 200 })}`),
  });
  const itens = (lista.data?.itens ?? []).filter((f: any) => !ja.has(f.funcionarioId));
  const alternar = (id: string) => {
    const n = new Set(marcados);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setMarcados(n);
  };
  return (
    <Formulario botao={`Adicionar ${marcados.size || ''} à turma`} aoEnviar={async () => {
      if (!marcados.size) throw new Error('Marque ao menos um funcionário');
      aoSalvar(await api.post(`/turmas/${turma.id}/participantes`, { funcionarioIds: [...marcados] }));
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Filtrar por função">
          <select className="campo" value={funcaoId} onChange={(e) => setFuncaoId(e.target.value)}>
            <option value="">Todas</option>
            {funcoes.data?.map((f: any) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Buscar"><input className="campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CPF ou matrícula" /></Campo>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
        {lista.isLoading ? <Carregando /> : !itens.length ? <Vazio>Nenhum funcionário ativo disponível.</Vazio> : (
          <>
            <label className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium">
              <input type="checkbox" checked={itens.every((f: any) => marcados.has(f.funcionarioId))}
                onChange={(e) => setMarcados(new Set(e.target.checked ? [...marcados, ...itens.map((f: any) => f.funcionarioId)] : []))} />
              Marcar todos ({itens.length})
            </label>
            {itens.map((f: any) => (
              <label key={f.vinculoId} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={marcados.has(f.funcionarioId)} onChange={() => alternar(f.funcionarioId)} />
                <span className="flex-1">{f.nome} <span className="text-xs text-slate-500">· Matr. {f.matricula} · {f.funcao ?? 'sem função'}</span></span>
              </label>
            ))}
          </>
        )}
      </div>
    </Formulario>
  );
}

function Concluir({ turma, aoSalvar }: { turma: any; aoSalvar: (t: any) => void }) {
  const [p, setP] = useState(() =>
    Object.fromEntries(turma.participantesLista.map((x: any) => [x.id, { presente: true, aprovado: true, nota: '' }])) as Record<string, { presente: boolean; aprovado: boolean; nota: string }>,
  );
  const alt = (id: string, k: 'presente' | 'aprovado', v: boolean) =>
    setP({ ...p, [id]: { ...p[id]!, [k]: v, ...(k === 'presente' && !v ? { aprovado: false } : {}) } });
  return (
    <Formulario botao="Concluir turma e emitir certificados" aoEnviar={async () => {
      aoSalvar(await api.post(`/turmas/${turma.id}/conclusao`, {
        participantes: Object.entries(p).map(([id, x]) => ({ id, presente: x.presente, aprovado: x.aprovado, nota: x.nota === '' ? null : Number(x.nota.replace(',', '.')) })),
      }));
    }}>
      <p className="text-sm text-slate-600">
        Marque presença e aprovação. Os aprovados recebem certificado com código de verificação e a validade é calculada pela periodicidade do treinamento.
        Depois de concluída, a turma não pode ser alterada.
      </p>
      <table className="tabela">
        <thead><tr><th>Participante</th><th>Presente</th><th>Aprovado</th><th>Nota</th></tr></thead>
        <tbody>
          {turma.participantesLista.map((x: any) => (
            <tr key={x.id}>
              <td>{x.nome}</td>
              <td><input type="checkbox" checked={p[x.id]!.presente} onChange={(e) => alt(x.id, 'presente', e.target.checked)} /></td>
              <td><input type="checkbox" checked={p[x.id]!.aprovado} disabled={!p[x.id]!.presente} onChange={(e) => alt(x.id, 'aprovado', e.target.checked)} /></td>
              <td><input className="campo w-20" inputMode="decimal" value={p[x.id]!.nota} onChange={(e) => setP({ ...p, [x.id]: { ...p[x.id]!, nota: e.target.value } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Formulario>
  );
}

export function Turma() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['turma', id], queryFn: () => api.get(`/turmas/${id}`) });
  const [acao, setAcao] = useState<null | 'editar' | 'adicionar' | 'concluir' | 'cancelar'>(null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<unknown>();
  if (q.isLoading) return <Carregando />;
  if (!q.data) return <Aviso erro={q.error} />;
  const t = q.data;
  const planejada = t.situacao === 'planejada';
  const pode = s.pode('treinamentos.editar') && planejada;
  const atualizar = (nova: any) => {
    qc.setQueryData(['turma', id], nova);
    qc.invalidateQueries({ queryKey: ['turmas'] });
    setAcao(null);
  };
  const remover = async (pid: string) => {
    setErro(undefined);
    try {
      atualizar(await api.delete(`/turmas/${id}/participantes/${pid}`));
    } catch (x) {
      setErro(x);
    }
  };
  const podeConcluir = pode && t.participantesLista.length > 0 && t.dataFim <= hojeIso();
  return (
    <>
      <Link to="/treinamentos" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> Treinamentos</Link>
      <Titulo
        titulo={t.treinamentoNome}
        subtitulo={<>{t.norma && `${t.norma} · `}{TIPOS_TURMA[t.tipo as keyof typeof TIPOS_TURMA]} · {MODALIDADES_TURMA[t.modalidade as keyof typeof MODALIDADES_TURMA]} · {dataBr(t.dataInicio)} a {dataBr(t.dataFim)}</>}
        acoes={pode && (
          <>
            <button className="btn-secundario" onClick={() => setAcao('editar')}>Editar</button>
            <button className="btn-secundario" onClick={() => setAcao('cancelar')}>Cancelar turma</button>
            <button className="btn-primario" disabled={!podeConcluir} title={t.dataFim > hojeIso() ? 'Disponível após a data de término' : undefined} onClick={() => setAcao('concluir')}>Concluir turma</button>
          </>
        )}
      />
      <Aviso erro={erro} />
      <div className="cartao mb-4 grid grid-cols-2 gap-3 p-4 text-sm md:grid-cols-4">
        <div><div className="rotulo">Situação</div><SituacaoPrazo s={t.situacao} /></div>
        <div><div className="rotulo">Carga horária</div>{String(t.cargaHoraria).replace('.', ',')} h</div>
        <div><div className="rotulo">Instrutor</div>{t.instrutorNome}{t.instrutorQualificacao && <div className="text-xs text-slate-500">{t.instrutorQualificacao}</div>}</div>
        <div><div className="rotulo">Local</div>{t.local ?? '—'}</div>
        {t.responsavelTecnico && <div className="col-span-2"><div className="rotulo">Responsável técnico</div>{t.responsavelTecnico}</div>}
        {t.observacoes && <div className="col-span-2 whitespace-pre-line"><div className="rotulo">Observações</div>{t.observacoes}</div>}
      </div>
      <div className="mb-2 flex items-center">
        <h2 className="font-semibold">Participantes ({t.participantesLista.length})</h2>
        {pode && <button className="btn-secundario ml-auto" onClick={() => setAcao('adicionar')}><UserPlus size={16} /> Adicionar</button>}
      </div>
      <div className="cartao overflow-x-auto">
        {!t.participantesLista.length ? <Vazio>Nenhum participante.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Nome</th><th>CPF</th><th>Matrícula</th>{!planejada && <><th>Presença</th><th>Resultado</th><th>Validade</th><th /></>}{pode && <th />}</tr></thead>
            <tbody>
              {t.participantesLista.map((p: any) => (
                <tr key={p.id}>
                  <td><Link className="font-medium hover:underline" to={`/funcionarios/${p.funcionarioId}`}>{p.nome}</Link></td>
                  <td>{cpf(p.cpf)}</td><td>{p.matricula ?? '—'}</td>
                  {!planejada && (
                    <>
                      <td>{p.presente ? 'Presente' : 'Ausente'}</td>
                      <td>{p.aprovado ? 'Aprovado' : 'Não aprovado'}{p.nota != null && ` (${String(p.nota).replace('.', ',')})`}</td>
                      <td>{p.aprovado ? (p.validade ? dataBr(p.validade) : 'Sem reciclagem') : '—'}</td>
                      <td className="text-right">
                        {p.certificadoCodigo && <a className="inline-flex items-center gap-1 text-marca-700 hover:underline" href={`/api/participantes/${p.id}/certificado`}><FileDown size={14} /> Certificado</a>}
                      </td>
                    </>
                  )}
                  {pode && (
                    <td className="text-right">
                      <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover" onClick={() => remover(p.id)}><Trash2 size={15} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Editar turma" aberto={acao === 'editar'} aoFechar={() => setAcao(null)}>
        {acao === 'editar' && <FormTurma empresaId={t.empresaId} inicial={t} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="Adicionar participantes" aberto={acao === 'adicionar'} aoFechar={() => setAcao(null)}>
        {acao === 'adicionar' && <AdicionarParticipantes turma={t} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="Concluir turma" aberto={acao === 'concluir'} aoFechar={() => setAcao(null)}>
        {acao === 'concluir' && <Concluir turma={t} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="Cancelar turma" aberto={acao === 'cancelar'} aoFechar={() => setAcao(null)} largura="max-w-lg">
        <Formulario perigo botao="Cancelar turma" aoEnviar={async () => atualizar(await api.post(`/turmas/${id}/cancelamento`, { motivo }))}>
          <Campo rotulo="Motivo" obrigatorio><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></Campo>
        </Formulario>
      </Modal>
    </>
  );
}
