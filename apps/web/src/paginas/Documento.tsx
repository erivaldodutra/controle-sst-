import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { APLICABILIDADES, SITUACOES_VERSAO, TIPOS_PRAZO } from '@sst/shared';
import { api, ErroApi, qs } from '../lib/api';
import { dataBr, dataHoraBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { meses, SituacaoDocumento } from '../componentes/documentos';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Modal, Titulo, Vazio } from '../componentes/ui';
import { CamposPrazos, corpoPrazos } from './Documentos';
import { useEstabelecimentos } from './Estrutura';

type Janela = null | 'dados' | 'aplicabilidade' | 'mudanca' | 'substituir' | 'acompanhamento' | { versao: any | null } | { cancelar: any };

const ESTADO: Record<string, string> = { atrasado: 'text-red-700 font-medium', proximo: 'text-amber-700 font-medium', em_dia: 'text-slate-700' };

function FormDados({ doc, aoSalvar }: { doc: any; aoSalvar: (d: any) => void }) {
  const ests = useEstabelecimentos(doc.empresaId);
  const [d, setD] = useState<any>({ ...doc });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => aoSalvar(await api.put(`/documentos/${doc.id}`, {
      identificacao: d.identificacao, estabelecimentoId: d.estabelecimentoId || null, observacoes: d.observacoes || null,
      baseLegal: d.baseLegal || null, ...corpoPrazos(d),
    }))}>
      <Campo rotulo="Identificação" obrigatorio><input className="campo" value={d.identificacao ?? ''} onChange={set('identificacao')} required /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Estabelecimento">
          <select className="campo" value={d.estabelecimentoId ?? ''} onChange={set('estabelecimentoId')}>
            <option value="">Toda a empresa</option>
            {ests.data?.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Base legal"><input className="campo" value={d.baseLegal ?? ''} onChange={set('baseLegal')} /></Campo>
      </div>
      <CamposPrazos d={d} set={set} />
      <Campo rotulo="Observações"><textarea className="campo" rows={2} value={d.observacoes ?? ''} onChange={set('observacoes')} /></Campo>
      <p className="text-xs text-slate-500">Prazos novos valem para as próximas versões emitidas. As datas da versão vigente podem ser corrigidas na própria versão.</p>
    </Formulario>
  );
}

function FormVersao({ doc, versao, aoSalvar }: { doc: any; versao: any | null; aoSalvar: (d: any) => void }) {
  const ultima = doc.versoes.find((v: any) => v.situacao === 'vigente');
  const [d, setD] = useState<any>(versao ?? {
    responsavelNome: ultima?.responsavelNome, responsavelRegistro: ultima?.responsavelRegistro, responsavelFormacao: ultima?.responsavelFormacao,
  });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const vigente = versao?.situacao === 'vigente';
  return (
    <Formulario aoEnviar={async () => {
      const corpo: any = {};
      for (const k of ['responsavelNome', 'responsavelRegistro', 'responsavelFormacao', 'dataElaboracao', 'dataEmissao', 'inicioVigencia',
        'dataRevisao', 'dataVencimento', 'dataReavaliacao', 'descricaoAlteracoes', 'observacoes']) corpo[k] = d[k] || null;
      aoSalvar(versao ? await api.put(`/documento-versoes/${versao.id}`, corpo) : await api.post(`/documentos/${doc.id}/versoes`, corpo));
    }}>
      {vigente && <Aviso tipo="info">Correção de dados da versão vigente. A alteração fica registrada na auditoria.</Aviso>}
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Responsável técnico" obrigatorio={vigente}><input className="campo" value={d.responsavelNome ?? ''} onChange={set('responsavelNome')} /></Campo>
        <Campo rotulo="Registro profissional"><input className="campo" value={d.responsavelRegistro ?? ''} onChange={set('responsavelRegistro')} placeholder="ex.: CREA-SP 000000" /></Campo>
        <Campo rotulo="Formação ou cargo"><input className="campo" value={d.responsavelFormacao ?? ''} onChange={set('responsavelFormacao')} placeholder="ex.: Engenheiro de Segurança do Trabalho" /></Campo>
        <Campo rotulo="Data de elaboração"><input className="campo" type="date" value={d.dataElaboracao ?? ''} onChange={set('dataElaboracao')} /></Campo>
        <Campo rotulo="Data de emissão" obrigatorio={vigente}><input className="campo" type="date" value={d.dataEmissao ?? ''} onChange={set('dataEmissao')} /></Campo>
        <Campo rotulo="Início da vigência"><input className="campo" type="date" value={d.inicioVigencia ?? ''} onChange={set('inicioVigencia')} /></Campo>
        <Campo rotulo="Próxima revisão legal"><input className="campo" type="date" value={d.dataRevisao ?? ''} onChange={set('dataRevisao')} /></Campo>
        <Campo rotulo="Vencimento"><input className="campo" type="date" value={d.dataVencimento ?? ''} onChange={set('dataVencimento')} /></Campo>
        <Campo rotulo="Reavaliação interna"><input className="campo" type="date" value={d.dataReavaliacao ?? ''} onChange={set('dataReavaliacao')} /></Campo>
      </div>
      {!vigente && (
        <p className="text-xs text-slate-500">
          Revisão, vencimento e reavaliação em branco são calculados ao emitir, pelas regras do documento
          (revisão {meses(doc.prazoRevisaoMeses)}, vencimento {meses(doc.vencimentoMeses)}, reavaliação {meses(doc.reavaliacaoMeses)}). Sem regra, ficam sem data.
        </p>
      )}
      <Campo rotulo="O que mudou nesta versão"><textarea className="campo" rows={3} value={d.descricaoAlteracoes ?? ''} onChange={set('descricaoAlteracoes')} /></Campo>
      <Campo rotulo="Observações"><textarea className="campo" rows={2} value={d.observacoes ?? ''} onChange={set('observacoes')} /></Campo>
    </Formulario>
  );
}

function FormAplicabilidade({ doc, aoSalvar }: { doc: any; aoSalvar: (d: any) => void }) {
  const [d, setD] = useState({ aplicabilidade: doc.aplicabilidade === 'a_avaliar' ? 'aplicavel' : doc.aplicabilidade, justificativa: doc.aplicabilidadeJustificativa ?? '' });
  return (
    <Formulario aoEnviar={async () => aoSalvar(await api.put(`/documentos/${doc.id}/aplicabilidade`, { ...d, justificativa: d.justificativa || null }))}>
      <Campo rotulo="Este documento se aplica a esta empresa/estabelecimento?" obrigatorio>
        <select className="campo" value={d.aplicabilidade} onChange={(e) => setD({ ...d, aplicabilidade: e.target.value })}>
          {Object.entries(APLICABILIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Fundamentação" obrigatorio={d.aplicabilidade === 'nao_aplicavel'}>
        <textarea className="campo" rows={3} value={d.justificativa} onChange={(e) => setD({ ...d, justificativa: e.target.value })}
          placeholder="Por que se aplica ou não (atividade, riscos, número de empregados, norma)" />
      </Campo>
      <p className="text-xs text-slate-500">A decisão é do profissional responsável e fica registrada com o seu nome e a data.</p>
    </Formulario>
  );
}

function FormSubstituir({ doc, aoSalvar }: { doc: any; aoSalvar: (d: any) => void }) {
  const outros = useQuery({ queryKey: ['documentos', doc.empresaId, ''], queryFn: () => api.get(`/documentos${qs({ empresaId: doc.empresaId })}`) });
  const [d, setD] = useState<any>({ data: hojeIso() });
  return (
    <Formulario botao="Encerrar documento" perigo aoEnviar={async () => aoSalvar(await api.post(`/documentos/${doc.id}/substituicao`, {
      data: d.data, motivo: d.motivo, substitutoId: d.substitutoId || null,
    }))}>
      <p className="text-sm text-slate-600">Use quando este documento deixou de valer e outro ficou no lugar (ex.: laudo refeito). Ele fica guardado com todas as versões.</p>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Data" obrigatorio><input className="campo" type="date" value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} required /></Campo>
        <Campo rotulo="Substituído por">
          <select className="campo" value={d.substitutoId ?? ''} onChange={(e) => setD({ ...d, substitutoId: e.target.value })}>
            <option value="">(nenhum documento)</option>
            {outros.data?.itens.filter((o: any) => o.id !== doc.id && !o.substituidoEm).map((o: any) => <option key={o.id} value={o.id}>{o.identificacao}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Motivo" obrigatorio><textarea className="campo" rows={2} value={d.motivo ?? ''} onChange={(e) => setD({ ...d, motivo: e.target.value })} required /></Campo>
    </Formulario>
  );
}

export function Documento() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const [janela, setJanela] = useState<Janela>(null);
  const [erro, setErro] = useState<unknown>();
  const [form, setForm] = useState<any>({});
  const q = useQuery({ queryKey: ['documento', id], queryFn: () => api.get(`/documentos/${id}`) });
  const atualizar = (d: any) => {
    qc.setQueryData(['documento', id], d);
    qc.invalidateQueries({ queryKey: ['documentos'] });
    setJanela(null);
  };
  const acao = async (fn: () => Promise<any>) => {
    setErro(undefined);
    try { atualizar(await fn()); } catch (x) { setErro(x instanceof ErroApi && x.corpo?.campos ? new Error(x.corpo.campos[0].mensagem) : x); }
  };
  if (q.isLoading) return <Carregando />;
  if (!q.data) return <Aviso erro={q.error} />;
  const doc = q.data;
  const pode = s.pode('documentos.editar');
  const encerrado = !!doc.substituidoEm;
  const temRascunho = doc.versoes.some((v: any) => ['em_elaboracao', 'em_revisao'].includes(v.situacao));
  const prazo = (t: string) => doc.prazos.find((p: any) => p.tipo === t);
  const linhaPrazo = (t: keyof typeof TIPOS_PRAZO, regra: string) => {
    const p = prazo(t);
    return (
      <tr key={t}>
        <td className="font-medium">{TIPOS_PRAZO[t]}</td>
        <td>{regra}</td>
        <td className={p ? ESTADO[p.estado] : 'text-slate-400'}>{p ? `${dataBr(p.data)} (${p.dias < 0 ? `há ${-p.dias} d` : `em ${p.dias} d`})` : 'Sem data'}</td>
      </tr>
    );
  };
  const anexar = (versaoId: string, arq: File) => acao(() => {
    const f = new FormData();
    f.append('arquivo', arq);
    return api.post(`/documento-versoes/${versaoId}/arquivo`, f);
  });

  return (
    <>
      <Link to="/documentos" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> Programas e documentos</Link>
      <Titulo
        titulo={doc.identificacao}
        subtitulo={<>{doc.tipoSigla ? `${doc.tipoSigla} · ` : ''}{doc.tipoNome} · {doc.empresaNome}{doc.estabelecimentoNome ? ` · ${doc.estabelecimentoNome}` : ''}{doc.baseLegal ? ` · ${doc.baseLegal}` : ''}</>}
        acoes={pode && !encerrado && (
          <>
            <button className="btn-secundario" onClick={() => setJanela('dados')}>Editar dados e prazos</button>
            <button className="btn-secundario" onClick={() => setJanela('substituir')}>Encerrar ou substituir</button>
          </>
        )}
      />
      <Aviso erro={erro} />
      <div className="cartao mb-4 flex flex-wrap items-start gap-3 p-4">
        <SituacaoDocumento s={doc.situacao} />
        <ul className="flex-1 space-y-0.5 text-sm text-slate-700">
          {doc.motivos.length ? doc.motivos.map((m: string) => <li key={m}>{m}</li>) : <li>Todos os prazos em dia.</li>}
        </ul>
      </div>
      {encerrado && (
        <Aviso tipo="info">
          Encerrado em {dataBr(doc.substituidoEm)}: {doc.substituicaoMotivo}
          {doc.substituidoPorId && <> · Substituído por <Link className="underline" to={`/documentos/${doc.substituidoPorId}`}>{doc.substituidoPorIdentificacao}</Link></>}
        </Aviso>
      )}
      {doc.substitui.length > 0 && (
        <p className="mb-4 text-sm text-slate-600">Substitui: {doc.substitui.map((x: any, i: number) => <span key={x.id}>{i > 0 && ', '}<Link className="text-marca-700 hover:underline" to={`/documentos/${x.id}`}>{x.identificacao}</Link></span>)}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="cartao overflow-x-auto">
          <h2 className="px-4 pt-3 text-sm font-semibold">Prazos deste documento</h2>
          <table className="tabela">
            <thead><tr><th>Prazo</th><th>Regra</th><th>Data</th></tr></thead>
            <tbody>
              {linhaPrazo('revisao', meses(doc.prazoRevisaoMeses))}
              {linhaPrazo('vencimento', meses(doc.vencimentoMeses))}
              {linhaPrazo('monitoramento', meses(doc.monitoramentoMeses))}
              {linhaPrazo('reavaliacao', meses(doc.reavaliacaoMeses))}
              <tr>
                <td className="font-medium">Mudança de condições</td>
                <td colSpan={2}>
                  {doc.mudancaCondicoesEm
                    ? <span className="text-red-700">Atualização necessária desde {dataBr(doc.mudancaCondicoesEm)}: {doc.mudancaCondicoesMotivo}</span>
                    : <span className="text-slate-500">Nenhuma sinalizada</span>}
                  {pode && !encerrado && (doc.mudancaCondicoesEm
                    ? <button className="ml-2 text-xs text-marca-700 hover:underline" onClick={() => acao(() => api.put(`/documentos/${doc.id}/mudanca-condicoes`, {}))}>Retirar</button>
                    : <button className="ml-2 text-xs text-marca-700 hover:underline" onClick={() => { setForm({ data: hojeIso() }); setJanela('mudanca'); }}>Sinalizar</button>)}
                </td>
              </tr>
            </tbody>
          </table>
          {doc.criterioRevisao && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600"><b>Critério de revisão:</b> {doc.criterioRevisao}</p>}
        </div>
        <div className="cartao space-y-2 p-4 text-sm">
          <h2 className="font-semibold">Aplicabilidade</h2>
          <div className={doc.aplicabilidade === 'a_avaliar' ? 'font-medium text-amber-700' : 'font-medium'}>{APLICABILIDADES[doc.aplicabilidade as keyof typeof APLICABILIDADES]}</div>
          {doc.aplicabilidadeJustificativa && <p className="text-slate-600">{doc.aplicabilidadeJustificativa}</p>}
          {doc.aplicabilidadeEm && <p className="text-xs text-slate-500">Avaliada por {doc.aplicabilidadePor} em {dataHoraBr(doc.aplicabilidadeEm)}</p>}
          {pode && !encerrado && <button className="btn-secundario" onClick={() => setJanela('aplicabilidade')}>Avaliar aplicabilidade</button>}
          {doc.observacoes && <><h3 className="pt-2 font-semibold">Observações</h3><p className="whitespace-pre-line text-slate-600">{doc.observacoes}</p></>}
        </div>
      </div>

      <div className="mb-2 mt-6 flex items-center">
        <h2 className="font-semibold">Versões</h2>
        {pode && !encerrado && !temRascunho && (
          <button className="btn-primario ml-auto" onClick={() => setJanela({ versao: null })}><Plus size={16} /> {doc.versoes.some((v: any) => v.situacao === 'vigente') ? 'Nova versão (revisão)' : 'Registrar primeira versão'}</button>
        )}
      </div>
      <div className="cartao overflow-x-auto">
        {!doc.versoes.length ? <Vazio>Nenhuma versão. Registre a versão atual do documento com o responsável técnico e as datas.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Versão</th><th>Responsável técnico</th><th>Emissão</th><th>Revisão</th><th>Vencimento</th><th>Arquivo</th><th>Situação</th>{pode && <th />}</tr></thead>
            <tbody>
              {doc.versoes.map((v: any) => {
                const rascunho = ['em_elaboracao', 'em_revisao'].includes(v.situacao);
                const editavel = pode && !encerrado && (rascunho || v.situacao === 'vigente');
                return (
                  <tr key={v.id}>
                    <td className="font-medium">v{v.numero}{v.descricaoAlteracoes && <div className="max-w-xs text-xs font-normal text-slate-500">{v.descricaoAlteracoes}</div>}</td>
                    <td>{v.responsavelNome ?? '—'}{v.responsavelRegistro && <div className="text-xs text-slate-500">{v.responsavelRegistro}</div>}</td>
                    <td>{dataBr(v.dataEmissao)}</td>
                    <td>{dataBr(v.dataRevisao)}</td>
                    <td>{dataBr(v.dataVencimento)}</td>
                    <td>{v.arquivoId ? <a className="inline-flex items-center gap-1 text-marca-700 hover:underline" href={`/api/documento-versoes/${v.id}/arquivo`} target="_blank" rel="noreferrer"><FileDown size={14} /> {v.arquivoNome}</a> : '—'}</td>
                    <td>
                      <SituacaoDocumento s={v.situacao} rotulo={SITUACOES_VERSAO[v.situacao as keyof typeof SITUACOES_VERSAO]} />
                      {v.substituidaEm && <div className="text-xs text-slate-500">em {dataBr(v.substituidaEm)}</div>}
                      {v.motivoCancelamento && <div className="max-w-xs text-xs text-slate-500">{v.motivoCancelamento}</div>}
                    </td>
                    {pode && (
                      <td className="whitespace-nowrap text-right">
                        {editavel && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {rascunho && <button className="btn-primario px-2 py-1 text-xs" onClick={() => acao(() => api.post(`/documento-versoes/${v.id}/emissao`))}>Emitir</button>}
                            <button className="btn-secundario px-2 py-1 text-xs" onClick={() => setJanela({ versao: v })}>{rascunho ? 'Editar' : 'Corrigir'}</button>
                            <label className="btn-secundario cursor-pointer px-2 py-1 text-xs">
                              <Paperclip size={13} /> {v.arquivoId ? 'Trocar' : 'Anexar'}
                              <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && anexar(v.id, e.target.files[0])} />
                            </label>
                            {rascunho && <button className="btn-secundario px-2 py-1 text-xs" onClick={() => { setForm({}); setJanela({ cancelar: v }); }}>Cancelar</button>}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">Ao emitir uma nova versão, a anterior passa a "Substituída" e fica guardada. Arquivos de até 50 MB (PDF, JPG ou PNG).</p>

      <div className="mb-2 mt-6 flex items-center">
        <h2 className="font-semibold">Acompanhamentos</h2>
        {pode && !encerrado && <button className="btn-secundario ml-auto" onClick={() => { setForm({ data: hojeIso() }); setJanela('acompanhamento'); }}><Plus size={16} /> Registrar acompanhamento</button>}
      </div>
      <div className="cartao overflow-x-auto">
        {!doc.acompanhamentos.length ? <Vazio>Nenhum acompanhamento registrado{doc.monitoramentoMeses ? ` (previsto a cada ${meses(doc.monitoramentoMeses)})` : ''}.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Data</th><th>Responsável</th><th>Descrição</th><th>Registrado por</th></tr></thead>
            <tbody>
              {doc.acompanhamentos.map((a: any) => (
                <tr key={a.id}><td>{dataBr(a.data)}</td><td>{a.responsavelNome}</td><td className="whitespace-pre-line">{a.descricao}</td><td className="text-xs text-slate-500">{a.registradoPor} · {dataHoraBr(a.criadoEm)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal titulo="Editar dados e prazos" aberto={janela === 'dados'} aoFechar={() => setJanela(null)} largura="max-w-xl">
        {janela === 'dados' && <FormDados doc={doc} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="Aplicabilidade" aberto={janela === 'aplicabilidade'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'aplicabilidade' && <FormAplicabilidade doc={doc} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="Encerrar ou substituir documento" aberto={janela === 'substituir'} aoFechar={() => setJanela(null)} largura="max-w-lg">
        {janela === 'substituir' && <FormSubstituir doc={doc} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo={janela && typeof janela === 'object' && 'versao' in janela && janela.versao ? `Versão ${janela.versao.numero}` : 'Nova versão'}
        aberto={!!janela && typeof janela === 'object' && 'versao' in janela} aoFechar={() => setJanela(null)}>
        {janela && typeof janela === 'object' && 'versao' in janela && <FormVersao doc={doc} versao={janela.versao} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="Cancelar versão" aberto={!!janela && typeof janela === 'object' && 'cancelar' in janela} aoFechar={() => setJanela(null)} largura="max-w-md">
        {janela && typeof janela === 'object' && 'cancelar' in janela && (
          <Formulario botao="Cancelar versão" perigo aoEnviar={async () => atualizar(await api.post(`/documento-versoes/${janela.cancelar.id}/cancelamento`, { motivo: form.motivo }))}>
            <Campo rotulo="Motivo" obrigatorio><textarea className="campo" rows={2} value={form.motivo ?? ''} onChange={(e) => setForm({ ...form, motivo: e.target.value })} required /></Campo>
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Mudança de condições" aberto={janela === 'mudanca'} aoFechar={() => setJanela(null)} largura="max-w-md">
        {janela === 'mudanca' && (
          <Formulario botao="Sinalizar" aoEnviar={async () => atualizar(await api.put(`/documentos/${doc.id}/mudanca-condicoes`, form))}>
            <p className="text-sm text-slate-600">O documento fica pendente até uma nova versão ser emitida com data igual ou posterior.</p>
            <Campo rotulo="Data da mudança" obrigatorio><input className="campo" type="date" value={form.data ?? ''} onChange={(e) => setForm({ ...form, data: e.target.value })} required /></Campo>
            <Campo rotulo="O que mudou" obrigatorio><textarea className="campo" rows={2} value={form.motivo ?? ''} onChange={(e) => setForm({ ...form, motivo: e.target.value })} required placeholder="ex.: nova máquina, novo processo, acidente, mudança na norma" /></Campo>
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Registrar acompanhamento" aberto={janela === 'acompanhamento'} aoFechar={() => setJanela(null)} largura="max-w-md">
        {janela === 'acompanhamento' && (
          <Formulario aoEnviar={async () => atualizar(await api.post(`/documentos/${doc.id}/acompanhamentos`, form))}>
            <Campo rotulo="Data" obrigatorio><input className="campo" type="date" value={form.data ?? ''} max={hojeIso()} onChange={(e) => setForm({ ...form, data: e.target.value })} required /></Campo>
            <Campo rotulo="Responsável" obrigatorio><input className="campo" value={form.responsavelNome ?? ''} onChange={(e) => setForm({ ...form, responsavelNome: e.target.value })} required /></Campo>
            <Campo rotulo="Descrição" obrigatorio><textarea className="campo" rows={3} value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} required placeholder="ex.: relatório analítico anual, verificação do plano de ação" /></Campo>
          </Formulario>
        )}
      </Modal>
    </>
  );
}
