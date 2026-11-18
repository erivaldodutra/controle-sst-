import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ORDENS_EXAME, RESULTADOS_ASO, RESULTADOS_EXAME, TIPOS_ASO } from '@sst/shared';
import { api, qs } from '../lib/api';
import { cpf, dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Formulario, SeletorFuncionario, SituacaoPrazo, somarMeses, useCadastroSaude } from '../componentes/saude';
import { Aviso, Campo, Carregando, Etiqueta, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';

const TIPOS = Object.entries(TIPOS_ASO) as [string, string][];

/** Formulário de ASO (novo ou correção). */
export function FormAso({ empresaId, inicial, funcionario, aoSalvar }: {
  empresaId: string; inicial?: any; funcionario?: any; aoSalvar: (aso: any) => void;
}) {
  const medicos = useCadastroSaude('medicos');
  const clinicas = useCadastroSaude('clinicas');
  const tipos = useCadastroSaude('tipos-exame');
  const [func, setFunc] = useState<any>(
    inicial ? { vinculoId: inicial.vinculoId, nome: inicial.funcionarioNome, cpf: inicial.funcionarioCpf, matricula: inicial.matricula } : funcionario ?? null,
  );
  const [d, setD] = useState<any>(() => ({
    tipo: '1', dataExame: hojeIso(), resultado: '1', medicoId: '', clinicaId: '', vencimento: '', riscos: '', observacoes: '',
    ...(inicial ? {
      tipo: String(inicial.tipo), dataExame: inicial.dataExame, resultado: String(inicial.resultado), medicoId: inicial.medicoId,
      clinicaId: inicial.clinicaId ?? '', vencimento: inicial.vencimento ?? '', riscos: inicial.riscos ?? '', observacoes: inicial.observacoes ?? '',
    } : {}),
  }));
  const [exames, setExames] = useState<any[]>(
    inicial?.exames?.map((e: any) => ({ exameTipoId: e.exameTipoId, dataRealizacao: e.dataRealizacao, ordem: e.ordem ? String(e.ordem) : '' })) ?? [],
  );
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const demissional = d.tipo === '9';
  const salvar = async () => {
    if (!func) throw new Error('Escolha o funcionário');
    const corpo = {
      vinculoId: func.vinculoId, tipo: Number(d.tipo), dataExame: d.dataExame, resultado: Number(d.resultado), medicoId: d.medicoId,
      clinicaId: d.clinicaId || null, vencimento: demissional ? null : d.vencimento || null, riscos: d.riscos || null,
      observacoes: d.observacoes || null,
      exames: exames.filter((e) => e.exameTipoId).map((e) => ({ exameTipoId: e.exameTipoId, dataRealizacao: e.dataRealizacao, ordem: e.ordem ? Number(e.ordem) : null })),
    };
    const r = inicial ? await api.put(`/asos/${inicial.id}`, corpo) : await api.post('/asos', corpo);
    aoSalvar(r);
  };
  return (
    <Formulario aoEnviar={salvar}>
      <Campo rotulo="Funcionário" obrigatorio>
        {inicial ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{func.nome} · Matr. {func.matricula}</div>
        ) : <SeletorFuncionario empresaId={empresaId} valor={func} onChange={setFunc} />}
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo de exame" obrigatorio>
          <select className="campo" value={d.tipo} onChange={set('tipo')}>{TIPOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <Campo rotulo="Data do exame clínico" obrigatorio><input className="campo" type="date" max={hojeIso()} value={d.dataExame} onChange={set('dataExame')} required /></Campo>
        <Campo rotulo="Conclusão" obrigatorio>
          <select className="campo" value={d.resultado} onChange={set('resultado')}>{Object.entries(RESULTADOS_ASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        {!demissional && (
          <Campo rotulo="Próximo exame até (vencimento)">
            <input className="campo" type="date" value={d.vencimento} onChange={set('vencimento')} />
            <span className="mt-1 flex gap-2 text-xs">
              {[6, 12, 24].map((m) => (
                <button type="button" key={m} className="text-marca-700 hover:underline" onClick={() => setD({ ...d, vencimento: somarMeses(d.dataExame, m) })}>+{m} meses</button>
              ))}
            </span>
          </Campo>
        )}
        <Campo rotulo="Médico examinador" obrigatorio>
          <select className="campo" value={d.medicoId} onChange={set('medicoId')} required>
            <option value="" />
            {medicos.data?.map((m) => <option key={m.id} value={m.id}>{m.nome} · CRM {m.crm}/{m.ufCrm}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Clínica">
          <select className="campo" value={d.clinicaId} onChange={set('clinicaId')}>
            <option value="" />
            {clinicas.data?.map((c) => <option key={c.id} value={c.id}>{c.nomeFantasia || c.razaoSocial}</option>)}
          </select>
        </Campo>
      </div>
      {!medicos.data?.length && <Aviso tipo="info">Cadastre os médicos em Cadastros de saúde antes de registrar ASOs.</Aviso>}
      <Campo rotulo="Perigos ou fatores de risco ocupacionais (conforme o PGR)">
        <textarea className="campo" rows={3} value={d.riscos} onChange={set('riscos')} placeholder="ex.: Ruído contínuo acima do nível de ação; poeira mineral" />
      </Campo>
      <div>
        <div className="rotulo">Exames complementares</div>
        <div className="space-y-2">
          {exames.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_150px_130px_32px] gap-2">
              <select className="campo" value={e.exameTipoId} onChange={(x) => setExames(exames.map((y, j) => (j === i ? { ...y, exameTipoId: x.target.value } : y)))} required>
                <option value="">Exame…</option>
                {tipos.data?.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
              <input className="campo" type="date" max={hojeIso()} value={e.dataRealizacao} required
                onChange={(x) => setExames(exames.map((y, j) => (j === i ? { ...y, dataRealizacao: x.target.value } : y)))} />
              <select className="campo" value={e.ordem} onChange={(x) => setExames(exames.map((y, j) => (j === i ? { ...y, ordem: x.target.value } : y)))}>
                <option value="">Ordem…</option>
                {Object.entries(ORDENS_EXAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover exame"
                onClick={() => setExames(exames.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm text-marca-700 hover:underline" onClick={() => setExames([...exames, { exameTipoId: '', dataRealizacao: d.dataExame, ordem: '' }])}>
          + Adicionar exame
        </button>
        <p className="mt-1 text-xs text-slate-500">Os resultados dos exames são lançados depois, só por quem tem acesso a dado clínico (perfil Médico).</p>
      </div>
      <Campo rotulo="Observações (sem informação clínica)"><textarea className="campo" rows={2} value={d.observacoes} onChange={set('observacoes')} /></Campo>
    </Formulario>
  );
}

function ResultadoExame({ exame, aoSalvar }: { exame: any; aoSalvar: (a: any) => void }) {
  const [d, setD] = useState({ resultado: exame.resultado ? String(exame.resultado) : '', observacao: exame.observacao ?? '' });
  return (
    <Formulario botao="Salvar resultado" aoEnviar={async () => {
      aoSalvar(await api.put(`/aso-exames/${exame.id}/resultado`, { resultado: d.resultado ? Number(d.resultado) : null, observacao: d.observacao || null }));
    }}>
      <Campo rotulo="Resultado">
        <select className="campo" value={d.resultado} onChange={(e) => setD({ ...d, resultado: e.target.value })}>
          <option value="">Não informado</option>
          {Object.entries(RESULTADOS_EXAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Observação clínica"><textarea className="campo" rows={3} value={d.observacao} onChange={(e) => setD({ ...d, observacao: e.target.value })} /></Campo>
    </Formulario>
  );
}

/** Detalhe do ASO: exames, resultados (se permitido), anexo, PDF, correção e cancelamento. */
export function DetalheAso({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const s = useSessao();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['aso', id], queryFn: () => api.get(`/asos/${id}`) });
  const [modo, setModo] = useState<'ver' | 'editar' | 'cancelar' | { exame: any }>('ver');
  const [motivo, setMotivo] = useState('');
  const [erroAnexo, setErroAnexo] = useState<unknown>();
  const atualizar = (a: any) => {
    qc.setQueryData(['aso', id], a);
    setModo('ver');
    aoMudar();
  };
  if (q.isLoading || !q.data) return <Carregando />;
  const a = q.data;
  const podeEditar = s.pode('saude.editar') && a.situacao !== 'cancelado';
  if (modo === 'editar') return <FormAso empresaId={a.empresaId} inicial={a} aoSalvar={atualizar} />;
  if (modo === 'cancelar')
    return (
      <Formulario perigo botao="Cancelar ASO" extra={<button type="button" className="btn-secundario" onClick={() => setModo('ver')}>Voltar</button>}
        aoEnviar={async () => atualizar(await api.post(`/asos/${id}/cancelamento`, { motivo }))}>
        <p className="text-sm text-slate-600">O ASO não é apagado: fica registrado como cancelado, com o motivo, e deixa de contar nos vencimentos.</p>
        <Campo rotulo="Motivo do cancelamento" obrigatorio><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></Campo>
      </Formulario>
    );
  if (typeof modo === 'object')
    return (
      <>
        <p className="mb-3 text-sm"><b>{modo.exame.nome}</b> · {dataBr(modo.exame.dataRealizacao)}</p>
        <ResultadoExame exame={modo.exame} aoSalvar={atualizar} />
      </>
    );
  const anexar = async (arq: File) => {
    setErroAnexo(undefined);
    const f = new FormData();
    f.append('arquivo', arq);
    try {
      atualizar(await api.post(`/asos/${id}/arquivo`, f));
    } catch (x) {
      setErroAnexo(x);
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SituacaoPrazo s={a.situacao} dias={a.situacao === 'vencido' || a.situacao === 'vencendo' ? a.diasParaVencer : null} />
        <Etiqueta cor={a.resultado === 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}>{RESULTADOS_ASO[a.resultado as 1 | 2]}</Etiqueta>
      </div>
      {a.situacao === 'cancelado' && <Aviso>Cancelado: {a.motivoCancelamento}</Aviso>}
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="rotulo">Funcionário</dt><dd>{a.funcionarioNome}<br /><span className="text-xs text-slate-500">CPF {cpf(a.funcionarioCpf)} · Matr. {a.matricula}</span></dd></div>
        <div><dt className="rotulo">Tipo</dt><dd>{TIPOS_ASO[a.tipo as keyof typeof TIPOS_ASO]}</dd></div>
        <div><dt className="rotulo">Exame clínico</dt><dd>{dataBr(a.dataExame)}</dd></div>
        <div><dt className="rotulo">Vencimento</dt><dd>{dataBr(a.vencimento)}</dd></div>
        <div><dt className="rotulo">Médico</dt><dd>{a.medicoNome} · CRM {a.medicoCrm}/{a.medicoUfCrm}</dd></div>
        <div><dt className="rotulo">Clínica</dt><dd>{a.clinicaNome ?? '—'}</dd></div>
      </dl>
      {a.riscos && <div><div className="rotulo">Riscos ocupacionais</div><p className="whitespace-pre-line">{a.riscos}</p></div>}
      <div>
        <div className="rotulo">Exames complementares</div>
        {!a.exames.length ? <p className="text-slate-500">Nenhum.</p> : (
          <table className="tabela">
            <thead><tr><th>Exame</th><th>Realizado</th><th>Ordem</th>{a.clinicoVisivel && <th>Resultado</th>}</tr></thead>
            <tbody>
              {a.exames.map((e: any) => (
                <tr key={e.id} className={a.clinicoVisivel && podeEditar ? 'cursor-pointer' : ''} onClick={() => a.clinicoVisivel && podeEditar && setModo({ exame: e })}>
                  <td>{e.nome}{e.codigoEsocial && <span className="text-xs text-slate-500"> · {e.codigoEsocial}</span>}</td>
                  <td>{dataBr(e.dataRealizacao)}</td>
                  <td>{e.ordem ? ORDENS_EXAME[e.ordem as 1 | 2] : '—'}</td>
                  {a.clinicoVisivel && <td>{e.resultado ? RESULTADOS_EXAME[e.resultado as 1 | 2 | 3 | 4] : <span className="text-slate-400">Lançar</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!a.clinicoVisivel && a.exames.length > 0 && <p className="mt-1 text-xs text-slate-500">Resultados de exames são visíveis só para o perfil Médico (dado sensível de saúde).</p>}
      </div>
      {a.observacoes && <div><div className="rotulo">Observações</div><p className="whitespace-pre-line">{a.observacoes}</p></div>}
      <Aviso erro={erroAnexo} />
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <a className="btn-secundario" href={`/api/asos/${id}/pdf`}><FileDown size={16} /> PDF do ASO</a>
        {a.arquivoId && <a className="btn-secundario" href={`/api/asos/${id}/arquivo`}><Paperclip size={16} /> {a.arquivoNome}</a>}
        {podeEditar && (
          <label className="btn-secundario cursor-pointer">
            <Paperclip size={16} /> {a.arquivoId ? 'Trocar anexo' : 'Anexar ASO assinado'}
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && anexar(e.target.files[0])} />
          </label>
        )}
        {podeEditar && <button className="btn-secundario" onClick={() => setModo('editar')}>Corrigir</button>}
        {podeEditar && <button className="btn-secundario text-red-700" onClick={() => setModo('cancelar')}>Cancelar ASO</button>}
      </div>
    </div>
  );
}

export function Asos() {
  const s = useSessao();
  const qc = useQueryClient();
  const [f, setF] = useState({ situacao: '', tipo: '', pagina: 1 });
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['asos', s.empresaId, f],
    queryFn: () => api.get(`/asos${qs({ empresaId: s.empresaId, situacao: f.situacao, tipo: f.tipo, pagina: f.pagina, limite: 50 })}`),
  });
  const recarregar = () => qc.invalidateQueries({ queryKey: ['asos'] });
  return (
    <>
      <Titulo
        titulo="ASO"
        subtitulo="Atestados de saúde ocupacional, exames e vencimentos"
        acoes={s.pode('saude.editar') && s.empresaId && <button className="btn-primario" onClick={() => setNovo(true)}><Plus size={16} /> Registrar ASO</button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="campo max-w-48" value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value, pagina: 1 })} aria-label="Situação">
          <option value="">Todas as situações</option>
          {['vigente', 'vencendo', 'vencido', 'sem_vencimento', 'substituido', 'cancelado'].map((x) => (
            <option key={x} value={x}>{({ vigente: 'Vigente', vencendo: 'Vencendo', vencido: 'Vencido', sem_vencimento: 'Sem vencimento', substituido: 'Substituído', cancelado: 'Cancelado' } as any)[x]}</option>
          ))}
        </select>
        <select className="campo max-w-56" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value, pagina: 1 })} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {TIPOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : !lista.data?.itens.length ? <Vazio>Nenhum ASO encontrado.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Funcionário</th><th>Tipo</th><th>Exame</th><th>Conclusão</th><th>Vencimento</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.data.itens.map((a: any) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => setAberto(a.id)}>
                  <td><div className="font-medium">{a.funcionarioNome}</div><div className="text-xs text-slate-500">Matr. {a.matricula}</div></td>
                  <td>{TIPOS_ASO[a.tipo as keyof typeof TIPOS_ASO]}</td>
                  <td>{dataBr(a.dataExame)}</td>
                  <td>{RESULTADOS_ASO[a.resultado as 1 | 2]}</td>
                  <td>{dataBr(a.vencimento)}</td>
                  <td><SituacaoPrazo s={a.situacao} dias={a.situacao === 'vencido' || a.situacao === 'vencendo' ? a.diasParaVencer : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {lista.data && lista.data.total > lista.data.limite && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-secundario" disabled={f.pagina <= 1} onClick={() => setF({ ...f, pagina: f.pagina - 1 })}>Anterior</button>
          <span>Página {f.pagina} de {Math.ceil(lista.data.total / lista.data.limite)}</span>
          <button className="btn-secundario" disabled={f.pagina * lista.data.limite >= lista.data.total} onClick={() => setF({ ...f, pagina: f.pagina + 1 })}>Próxima</button>
        </div>
      )}
      <Modal titulo="Registrar ASO" aberto={novo} aoFechar={() => setNovo(false)}>
        <ExigeEmpresa empresaId={s.empresaId}>
          {novo && s.empresaId && <FormAso empresaId={s.empresaId} aoSalvar={(a) => { setNovo(false); recarregar(); setAberto(a.id); }} />}
        </ExigeEmpresa>
      </Modal>
      <Modal titulo="ASO" aberto={!!aberto} aoFechar={() => setAberto(null)}>
        {aberto && <DetalheAso id={aberto} aoMudar={recarregar} />}
      </Modal>
    </>
  );
}
