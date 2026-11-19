import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TIPOS_OCORRENCIA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { SecaoCat } from '../componentes/cat';
import { AcoesLigadas, FormAcao, OrigemFixa } from '../componentes/acoes';
import { Aviso, Carregando, Modal, Titulo } from '../componentes/ui';
import { FormSimples } from './Acao';
import { FormOcorrencia, Gravidade, SituacaoOcorrencia } from './Inspecoes';

export function Ocorrencia() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [janela, setJanela] = useState<null | 'editar' | 'investigacao' | 'encerrar' | { acao: OrigemFixa }>(null);
  const q = useQuery({ queryKey: ['ocorrencia', id], queryFn: () => api.get(`/ocorrencias/${id}`) });
  const acoes = useQuery({
    queryKey: ['acoes', 'ocorrencia', id],
    queryFn: () => api.get(`/acoes${qs({ ocorrenciaId: id })}`),
    enabled: s.pode('acoes.ler'),
  });
  const o = q.data;
  if (q.error) return <Aviso erro={q.error} />;
  if (!o) return <Carregando />;
  const salvo = (r: any) => {
    qc.setQueryData(['ocorrencia', id], r);
    qc.invalidateQueries({ queryKey: ['ocorrencias'] });
    setJanela(null);
  };
  const editar = o.situacao !== 'encerrada' && s.pode('inspecoes.editar');
  const fechar = () => setJanela(null);
  const novaAcao = (investigacao: boolean) => setJanela({ acao: {
    origem: investigacao ? 'investigacao' : 'acidente', rotulo: `${o.codigo} (${TIPOS_OCORRENCIA[o.tipo as keyof typeof TIPOS_OCORRENCIA]})`,
    ocorrenciaId: o.id, estabelecimentoId: o.estabelecimentoId, setorId: o.setorId,
  } });
  return (
    <>
      <Link to="/inspecoes?aba=ocorrencias" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-tinta"><ArrowLeft size={15} /> Ocorrências</Link>
      <Titulo
        titulo={`Ocorrência ${o.codigo}`}
        subtitulo={<>{dataBr(o.dataHora)} {o.dataHora.slice(11)} · {TIPOS_OCORRENCIA[o.tipo as keyof typeof TIPOS_OCORRENCIA]} · {o.estabelecimentoNome}{o.setorNome ? ` · ${o.setorNome}` : ''}</>}
        acoes={<>
          <SituacaoOcorrencia s={o.situacao} /><Gravidade g={o.gravidade} />
          {editar && <button className="btn-secundario" onClick={() => setJanela('editar')}><Pencil size={15} /> Editar</button>}
          {editar && <button className="btn-secundario" onClick={() => setJanela('investigacao')}><Search size={15} /> Investigação</button>}
          {editar && <button className="btn-primario" onClick={() => setJanela('encerrar')}><Check size={15} /> Encerrar</button>}
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cartao p-5 text-sm">
          <h2 className="mb-2 font-semibold">O que aconteceu</h2>
          <p className="whitespace-pre-line">{o.descricao}</p>
          <dl className="mt-3 space-y-1 text-slate-600">
            <div>Funcionário envolvido: <span className="text-tinta">{o.funcionarioNome ?? '—'}</span></div>
            <div>Local: <span className="text-tinta">{o.local ?? '—'}</span></div>
            <div>Afastamento: <span className="text-tinta">{o.houveAfastamento ? 'Sim' : 'Não'}</span></div>
            <div>Medidas imediatas: <span className="whitespace-pre-line text-tinta">{o.medidasImediatas ?? '—'}</span></div>
          </dl>
        </section>
        <section className="cartao p-5 text-sm">
          <h2 className="mb-2 font-semibold">Investigação</h2>
          {o.investigacao ? (
            <>
              <p className="whitespace-pre-line">{o.investigacao}</p>
              <p className="mt-2 text-slate-600">Responsável: {o.investigacaoResponsavel} · {o.investigacaoConcluidaEm ? `concluída em ${dataBr(o.investigacaoConcluidaEm)}` : 'em andamento'}</p>
            </>
          ) : <p className="text-slate-500">Investigação ainda não registrada. Ela é obrigatória para encerrar a ocorrência.</p>}
          {o.encerradaEm && <p className="mt-2 text-emerald-700">Encerrada em {dataBr(o.encerradaEm)}.</p>}
        </section>
      </div>
      {s.pode('acoes.ler') && (
        <section className="cartao mt-4 overflow-x-auto p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Ações</h2>
            {s.pode('acoes.editar') && (
              <div className="flex gap-2">
                <button className="btn-secundario" onClick={() => novaAcao(false)}><Plus size={15} /> Ação imediata</button>
                {o.investigacao && <button className="btn-secundario" onClick={() => novaAcao(true)}><Plus size={15} /> Ação da investigação</button>}
              </div>
            )}
          </div>
          {acoes.data && <AcoesLigadas acoes={acoes.data.itens} aoAbrir={(aid) => nav(`/acoes/${aid}`)} />}
        </section>
      )}
      <SecaoCat ocorrencia={o} />

      <Modal titulo="Editar ocorrência" aberto={janela === 'editar'} aoFechar={fechar}>
        {janela === 'editar' && <FormOcorrencia empresaId={o.empresaId} inicial={o} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Investigação" aberto={janela === 'investigacao'} aoFechar={fechar}>
        {janela === 'investigacao' && <FormSimples campos={[
          { k: 'investigacao', r: 'Análise e causas', area: true, inicial: o.investigacao ?? '' },
          { k: 'responsavel', r: 'Responsável pela investigação', inicial: o.investigacaoResponsavel ?? '' },
          { k: 'concluidaEm', r: 'Concluída em (vazio se em andamento)', tipo: 'date', opcional: true, inicial: o.investigacaoConcluidaEm ?? '', max: hojeIso() },
        ]} botao="Salvar" enviar={(d) => api.put(`/ocorrencias/${o.id}/investigacao`, d)} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Encerrar ocorrência" aberto={janela === 'encerrar'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'encerrar' && <FormSimples campos={[{ k: 'data', r: 'Data do encerramento', tipo: 'date', inicial: hojeIso(), max: hojeIso() }]}
          botao="Encerrar" enviar={(d) => api.post(`/ocorrencias/${o.id}/encerramento`, d)} aoSalvar={salvo}
          nota="Exige investigação concluída. As ações abertas seguem no plano de ação." />}
      </Modal>
      <Modal titulo="Nova ação" aberto={typeof janela === 'object' && !!janela} aoFechar={fechar}>
        {typeof janela === 'object' && janela && <FormAcao empresaId={o.empresaId} fixa={janela.acao} aoSalvar={(a) => nav(`/acoes/${a.id}`)} />}
      </Modal>
    </>
  );
}
