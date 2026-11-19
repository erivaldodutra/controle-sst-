import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Check, FileDown, MessageSquare, Paperclip, Pencil, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  EVENTOS_ACAO, ORIGENS_ACAO, PRIORIDADES, SITUACOES_ACAO, TIPOS_ACAO, TIPOS_EVIDENCIA, TRANSICOES_ACAO, type SituacaoAcao as Sit,
} from '@sst/shared';
import { api } from '../lib/api';
import { dataBr, dataHoraBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Prioridade, PrazoAcao, SituacaoAcao } from '../componentes/acoes';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Modal, Titulo } from '../componentes/ui';
import { useEstabelecimentos, useEstrutura } from './Estrutura';

type Janela = null | 'editar' | 'reprogramar' | 'evidencia' | 'dispensa' | 'validar' | 'devolver' | 'cancelar' | 'comentar' | { situacao: Sit };

function FormEdicao({ a, aoSalvar }: { a: any; aoSalvar: (r: any) => void }) {
  const ests = useEstabelecimentos(a.empresaId);
  const setores = useEstrutura(a.empresaId, 'setores');
  const ghes = useEstrutura(a.empresaId, 'ghes');
  const [d, setD] = useState<any>({ ...a });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const v = (k: string) => d[k] || null;
      aoSalvar(await api.put(`/acoes/${a.id}`, {
        estabelecimentoId: v('estabelecimentoId'), setorId: v('setorId'), gheId: v('gheId'), perigo: v('perigo'), descricao: d.descricao,
        justificativa: v('justificativa'), tipo: d.tipo, prioridade: d.prioridade, responsavelNome: d.responsavelNome,
        validadorNome: v('validadorNome'), recursos: v('recursos'), formaAcompanhamento: v('formaAcompanhamento'),
      }));
    }}>
      <Campo rotulo="Perigo ou risco relacionado"><input className="campo" value={d.perigo ?? ''} onChange={set('perigo')} /></Campo>
      <Campo rotulo="Ação" obrigatorio><textarea className="campo" rows={3} value={d.descricao ?? ''} onChange={set('descricao')} required /></Campo>
      <Campo rotulo="Justificativa"><textarea className="campo" rows={2} value={d.justificativa ?? ''} onChange={set('justificativa')} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo de medida"><select className="campo" value={d.tipo} onChange={set('tipo')}>{Object.entries(TIPOS_ACAO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
        <Campo rotulo="Prioridade"><select className="campo" value={d.prioridade} onChange={set('prioridade')}>{Object.entries(PRIORIDADES).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Estabelecimento">
          <select className="campo" value={d.estabelecimentoId ?? ''} onChange={(e) => setD({ ...d, estabelecimentoId: e.target.value, setorId: '', gheId: '' })}>
            <option value="">Toda a empresa</option>
            {ests.data?.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Setor">
          <select className="campo" value={d.setorId ?? ''} onChange={set('setorId')}>
            <option value="" />
            {setores.data?.filter((x: any) => !d.estabelecimentoId || x.estabelecimentoId === d.estabelecimentoId).map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="GHE">
          <select className="campo" value={d.gheId ?? ''} onChange={set('gheId')}>
            <option value="" />
            {ghes.data?.filter((x: any) => !d.estabelecimentoId || x.estabelecimentoId === d.estabelecimentoId).map((x: any) => <option key={x.id} value={x.id}>{x.codigo} · {x.nome}</option>)}
          </select>
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Responsável" obrigatorio><input className="campo" value={d.responsavelNome ?? ''} onChange={set('responsavelNome')} required /></Campo>
        <Campo rotulo="Quem vai validar"><input className="campo" value={d.validadorNome ?? ''} onChange={set('validadorNome')} /></Campo>
      </div>
      <Campo rotulo="Recursos necessários"><input className="campo" value={d.recursos ?? ''} onChange={set('recursos')} /></Campo>
      <Campo rotulo="Forma de acompanhamento"><input className="campo" value={d.formaAcompanhamento ?? ''} onChange={set('formaAcompanhamento')} /></Campo>
      <p className="text-xs text-slate-500">O prazo muda pela reprogramação, que pede justificativa e fica no histórico.</p>
    </Formulario>
  );
}

function FormEvidencia({ a, aoSalvar }: { a: any; aoSalvar: (r: any) => void }) {
  const [d, setD] = useState<any>({ tipo: 'foto', data: hojeIso() });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario botao="Anexar" aoEnviar={async () => {
      if (!arquivo) throw new Error('Escolha o arquivo');
      const f = new FormData();
      f.set('tipo', d.tipo);
      f.set('descricao', d.descricao ?? '');
      f.set('data', d.data);
      f.set('arquivo', arquivo);
      aoSalvar(await api.post(`/acoes/${a.id}/evidencias`, f));
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo" obrigatorio><select className="campo" value={d.tipo} onChange={set('tipo')}>{Object.entries(TIPOS_EVIDENCIA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
        <Campo rotulo="Data" obrigatorio><input className="campo" type="date" value={d.data} max={hojeIso()} onChange={set('data')} required /></Campo>
      </div>
      <Campo rotulo="Descrição" obrigatorio><input className="campo" value={d.descricao ?? ''} onChange={set('descricao')} required placeholder="ex.: foto da proteção instalada" /></Campo>
      <Campo rotulo="Arquivo (PDF, JPG ou PNG, até 50 MB)" obrigatorio>
        <input className="campo" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} required />
      </Campo>
      <p className="text-xs text-slate-500">Evidências não podem ser apagadas depois de anexadas.</p>
    </Formulario>
  );
}

export function Acao() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const [janela, setJanela] = useState<Janela>(null);
  const q = useQuery({ queryKey: ['acao', id], queryFn: () => api.get(`/acoes/${id}`) });
  const a = q.data;
  if (q.error) return <Aviso erro={q.error} />;
  if (!a) return <Carregando />;
  const salvo = (r: any) => {
    qc.setQueryData(['acao', id], r);
    qc.invalidateQueries({ queryKey: ['acoes'] });
    setJanela(null);
  };
  const aberta = a.estado !== 'encerrada';
  const editar = aberta && s.pode('acoes.editar');
  const validar = aberta && s.pode('acoes.validar');
  const proximas = editar ? TRANSICOES_ACAO[a.situacao as Sit] : [];
  const semEvidencia = a.exigeEvidencia && !a.evidencias;
  const fechar = () => setJanela(null);
  const Linha = ({ r, v }: { r: string; v: any }) => (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-1.5 text-sm"><dt className="text-slate-500">{r}</dt><dd className="min-w-0 whitespace-pre-line">{v || '—'}</dd></div>
  );
  return (
    <>
      <Link to="/acoes" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-tinta"><ArrowLeft size={15} /> Planos de ação</Link>
      <Titulo
        titulo={`Ação ${a.codigo}`}
        subtitulo={<>{a.empresaNome}{a.estabelecimentoNome ? ` · ${a.estabelecimentoNome}` : ''}{a.setorNome ? ` · ${a.setorNome}` : ''}</>}
        acoes={<><SituacaoAcao s={a.situacao} /><Prioridade p={a.prioridade} /></>}
      />
      {a.situacao === 'em_validacao' && validar && <Aviso tipo="info">Esta ação aguarda validação. Confira as evidências e conclua ou devolva ao responsável.</Aviso>}
      {semEvidencia && aberta && <Aviso tipo="info">A ação só vai para validação depois de ter pelo menos uma evidência anexada, ou com a dispensa justificada.</Aviso>}
      <div className="mb-4 flex flex-wrap gap-2">
        {proximas.map((p) => (
          <button key={p} className="btn-secundario" onClick={() => setJanela({ situacao: p })}>
            {p === 'em_validacao' ? 'Enviar para validação' : `Marcar como ${SITUACOES_ACAO[p].toLowerCase()}`}
          </button>
        ))}
        {editar && <button className="btn-secundario" onClick={() => setJanela('evidencia')}><Paperclip size={15} /> Anexar evidência</button>}
        {editar && <button className="btn-secundario" onClick={() => setJanela('reprogramar')}><CalendarClock size={15} /> Reprogramar</button>}
        {editar && <button className="btn-secundario" onClick={() => setJanela('editar')}><Pencil size={15} /> Editar</button>}
        {validar && a.situacao === 'em_validacao' && <button className="btn-primario" onClick={() => setJanela('validar')}><Check size={15} /> Validar e concluir</button>}
        {validar && a.situacao === 'em_validacao' && <button className="btn-secundario" onClick={() => setJanela('devolver')}><Undo2 size={15} /> Devolver</button>}
        {validar && <button className="btn-secundario text-red-700" onClick={() => setJanela('cancelar')}><X size={15} /> Cancelar ação</button>}
        {(s.pode('acoes.editar') || s.pode('acoes.validar')) && <button className="btn-secundario" onClick={() => setJanela('comentar')}><MessageSquare size={15} /> Comentar</button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="cartao p-5">
            <h2 className="mb-2 text-sm font-semibold">Dados da ação</h2>
            <dl className="divide-y divide-slate-100">
              <Linha r="Origem" v={<>
                {ORIGENS_ACAO[a.origem as keyof typeof ORIGENS_ACAO]}
                {a.inspecaoId && <> · <Link className="text-marca-700 hover:underline" to={`/inspecoes/${a.inspecaoId}`}>{a.inspecaoCodigo}</Link>: {a.inspecaoItem}</>}
                {a.ocorrenciaId && <> · <Link className="text-marca-700 hover:underline" to={`/ocorrencias/${a.ocorrenciaId}`}>{a.ocorrenciaCodigo}</Link></>}
                {a.documentoId && <> · <Link className="text-marca-700 hover:underline" to={`/documentos/${a.documentoId}`}>{a.documentoIdentificacao}</Link></>}
                {a.requisitoTitulo && <> · {a.requisitoTitulo}</>}
              </>} />
              <Linha r="Perigo ou risco" v={a.perigo} />
              <Linha r="Ação" v={a.descricao} />
              <Linha r="Justificativa" v={a.justificativa} />
              <Linha r="Tipo de medida" v={TIPOS_ACAO[a.tipo as keyof typeof TIPOS_ACAO]} />
              <Linha r="GHE" v={a.gheNome} />
              <Linha r="Responsável" v={a.responsavelNome} />
              <Linha r="Validador" v={a.validadorNome} />
              <Linha r="Abertura" v={dataBr(a.dataAbertura)} />
              <Linha r="Prazo" v={<><PrazoAcao a={a} />{a.reprogramada && <span className="text-xs text-slate-500"> · inicial {dataBr(a.prazoInicial)}</span>}</>} />
              <Linha r="Recursos" v={a.recursos} />
              <Linha r="Acompanhamento" v={a.formaAcompanhamento} />
              {a.situacao === 'concluida' && <Linha r="Concluída" v={`${dataBr(a.concluidaEm)}, validada por ${a.validadaPorNome}${a.validadaPorUsuario ? ` (registrado por ${a.validadaPorUsuario})` : ''}`} />}
              {a.situacao === 'cancelada' && <Linha r="Cancelada" v={`${dataBr(a.canceladaEm)}: ${a.cancelamentoMotivo}`} />}
            </dl>
          </section>

          <section className="cartao p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Evidências</h2>
              {editar && <button className="text-sm text-marca-700 hover:underline" onClick={() => setJanela('dispensa')}>{a.exigeEvidencia ? 'Dispensar evidência…' : 'Voltar a exigir evidência'}</button>}
            </div>
            {!a.exigeEvidencia && <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Evidência dispensada: {a.dispensaJustificativa}</p>}
            {!a.evidenciasLista.length ? <p className="text-sm text-slate-500">Nenhuma evidência anexada.</p> : (
              <table className="tabela">
                <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Arquivo</th></tr></thead>
                <tbody>
                  {a.evidenciasLista.map((e: any) => (
                    <tr key={e.id}>
                      <td>{dataBr(e.data)}</td>
                      <td>{TIPOS_EVIDENCIA[e.tipo as keyof typeof TIPOS_EVIDENCIA]}</td>
                      <td>{e.descricao}<div className="text-xs text-slate-500">por {e.registradoPor ?? '—'} em {dataHoraBr(e.criadoEm)}</div></td>
                      <td><a className="inline-flex items-center gap-1 text-marca-700 hover:underline" href={`/api/acao-evidencias/${e.id}/arquivo`} target="_blank" rel="noreferrer"><FileDown size={14} /> {e.arquivoNome}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <section className="cartao h-fit p-5">
          <h2 className="mb-3 text-sm font-semibold">Histórico</h2>
          <ol className="space-y-3">
            {a.historico.map((h: any) => (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                <div className="text-xs text-slate-500">{dataHoraBr(h.criadoEm)} · {h.usuario ?? '—'}</div>
                <div className="text-sm"><span className="font-medium">{EVENTOS_ACAO[h.evento as keyof typeof EVENTOS_ACAO]}</span>: {h.descricao}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Modal titulo="Editar ação" aberto={janela === 'editar'} aoFechar={fechar}>{janela === 'editar' && <FormEdicao a={a} aoSalvar={salvo} />}</Modal>
      <Modal titulo="Anexar evidência" aberto={janela === 'evidencia'} aoFechar={fechar} largura="max-w-lg">{janela === 'evidencia' && <FormEvidencia a={a} aoSalvar={salvo} />}</Modal>
      <Modal titulo="Reprogramar prazo" aberto={janela === 'reprogramar'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'reprogramar' && <FormSimples campos={[{ k: 'prazo', r: 'Novo prazo', tipo: 'date', min: a.dataAbertura }, { k: 'justificativa', r: 'Justificativa', area: true }]}
          botao="Reprogramar" enviar={(d) => api.post(`/acoes/${a.id}/reprogramacao`, d)} aoSalvar={salvo}
          nota={`Prazo atual: ${dataBr(a.prazo)}. O prazo inicial (${dataBr(a.prazoInicial)}) fica registrado.`} />}
      </Modal>
      <Modal titulo={a.exigeEvidencia ? 'Dispensar evidência' : 'Voltar a exigir evidência'} aberto={janela === 'dispensa'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'dispensa' && (a.exigeEvidencia
          ? <FormSimples campos={[{ k: 'justificativa', r: 'Justificativa técnica', area: true }]} botao="Dispensar"
              enviar={(d) => api.put(`/acoes/${a.id}/dispensa-evidencia`, { dispensar: true, justificativa: d.justificativa })} aoSalvar={salvo}
              nota="A dispensa fica no histórico e será conferida por quem validar." />
          : <FormSimples campos={[]} botao="Exigir evidência" enviar={() => api.put(`/acoes/${a.id}/dispensa-evidencia`, { dispensar: false })} aoSalvar={salvo} />)}
      </Modal>
      <Modal titulo="Validar e concluir" aberto={janela === 'validar'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'validar' && <FormSimples campos={[{ k: 'data', r: 'Data da conclusão', tipo: 'date', inicial: hojeIso(), max: hojeIso() },
          { k: 'validadorNome', r: 'Validado por', inicial: a.validadorNome ?? s.eu.nome }, { k: 'parecer', r: 'Parecer', area: true, opcional: true }]}
          botao="Concluir ação" enviar={(d) => api.post(`/acoes/${a.id}/validacao`, d)} aoSalvar={salvo}
          nota="Depois de concluída, a ação não pode mais ser alterada." />}
      </Modal>
      <Modal titulo="Devolver ao responsável" aberto={janela === 'devolver'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'devolver' && <FormSimples campos={[{ k: 'motivo', r: 'O que falta', area: true }]} botao="Devolver"
          enviar={(d) => api.post(`/acoes/${a.id}/devolucao`, d)} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Cancelar ação" aberto={janela === 'cancelar'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'cancelar' && <FormSimples campos={[{ k: 'data', r: 'Data', tipo: 'date', inicial: hojeIso() }, { k: 'motivo', r: 'Motivo do cancelamento', area: true }]}
          botao="Cancelar ação" perigo enviar={(d) => api.post(`/acoes/${a.id}/cancelamento`, d)} aoSalvar={salvo}
          nota="O cancelamento não pode ser desfeito e fica no histórico." />}
      </Modal>
      <Modal titulo="Comentário" aberto={janela === 'comentar'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'comentar' && <FormSimples campos={[{ k: 'texto', r: 'Comentário', area: true }]} botao="Registrar"
          enviar={(d) => api.post(`/acoes/${a.id}/comentarios`, d)} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo={typeof janela === 'object' && janela ? (janela.situacao === 'em_validacao' ? 'Enviar para validação' : SITUACOES_ACAO[janela.situacao]) : ''}
        aberto={typeof janela === 'object' && janela !== null} aoFechar={fechar} largura="max-w-lg">
        {typeof janela === 'object' && janela && <FormSimples campos={[{ k: 'comentario', r: 'Comentário', area: true, opcional: true }]}
          botao="Confirmar" enviar={(d) => api.post(`/acoes/${a.id}/situacao`, { situacao: janela.situacao, comentario: d.comentario })} aoSalvar={salvo} />}
      </Modal>
    </>
  );
}

type CampoSimples = { k: string; r: string; tipo?: string; area?: boolean; opcional?: boolean; inicial?: string; min?: string; max?: string };

export function FormSimples({ campos, botao, enviar, aoSalvar, nota, perigo }: {
  campos: CampoSimples[]; botao: string; enviar: (d: any) => Promise<any>; aoSalvar: (r: any) => void; nota?: string; perigo?: boolean;
}) {
  const [d, setD] = useState<any>(Object.fromEntries(campos.map((c) => [c.k, c.inicial ?? ''])));
  return (
    <Formulario botao={botao} perigo={perigo} aoEnviar={async () => {
      aoSalvar(await enviar(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === '' ? null : v]))));
    }}>
      {campos.map((c) => (
        <Campo key={c.k} rotulo={c.r} obrigatorio={!c.opcional}>
          {c.area
            ? <textarea className="campo" rows={3} value={d[c.k]} onChange={(e) => setD({ ...d, [c.k]: e.target.value })} required={!c.opcional} />
            : <input className="campo" type={c.tipo ?? 'text'} min={c.min} max={c.max} value={d[c.k]} onChange={(e) => setD({ ...d, [c.k]: e.target.value })} required={!c.opcional} />}
        </Campo>
      ))}
      {nota && <p className="text-xs text-slate-500">{nota}</p>}
    </Formulario>
  );
}
