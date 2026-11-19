import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Plus, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  INICIATIVAS_CAT, LATERALIDADES, ORGAOS_EMITENTE_ATESTADO, TIPO_ACIDENTE_OCORRENCIA, TIPOS_CAT, TIPOS_LOCAL_ACIDENTE, UFS,
} from '@sst/shared';
import { api } from '../lib/api';
import { dataBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { CodigoTabela, SituacaoEvento } from './esocial';
import { Formulario } from './saude';
import { Aviso, Campo, Modal } from './ui';

const CAT_VAZIA = {
  vinculoId: '', tpCat: 1, nrRecCatOrig: '', hrsTrabAntesAcid: '', indCatObito: 'N', dtObito: '', indComunPolicia: 'N', codSitGeradora: '',
  iniciatCat: 1, obsCat: '', ultDiaTrab: '', tpLocal: 1, dscLocal: '', dscLograd: '', nrLograd: '', complemento: '', bairro: '', cep: '',
  codMunic: '', uf: '', pais: '', codPostal: '', localTpInsc: '', localNrInsc: '', codParteAting: '', lateralidade: 0, codAgntCausador: '',
};
const ATESTADO_VAZIO = {
  dtAtendimento: '', hrAtendimento: '', indInternacao: 'N', durTrat: '', indAfast: 'N', dscLesao: '', dscCompLesao: '', diagProvavel: '',
  codCid: '', observacao: '', nmEmit: '', ideOcEmit: 1, nrOcEmit: '', ufOcEmit: '',
};
const nulo = (v: any) => (v === '' || v === undefined ? null : v);
const semNulos = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? '']));

function SimNao({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <select className="campo" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="N">Não</option><option value="S">Sim</option>
    </select>
  );
}

function FormCat({ ocorrencia, cat, aoSalvar }: { ocorrencia: any; cat: any | null; aoSalvar: () => void }) {
  const [d, setD] = useState<any>(cat ? { ...CAT_VAZIA, ...semNulos(cat.dados), vinculoId: cat.vinculoId, tpCat: cat.tpCat } : { ...CAT_VAZIA });
  const vinc = useQuery({
    queryKey: ['funcionario', ocorrencia.funcionarioId],
    queryFn: () => api.get(`/funcionarios/${ocorrencia.funcionarioId}`),
    enabled: !!ocorrencia.funcionarioId,
  });
  const m = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const v = (k: string) => (x: string) => setD({ ...d, [k]: x });
  const exterior = Number(d.tpLocal) === 2;
  return (
    <Formulario aoEnviar={async () => {
      const corpo: any = Object.fromEntries(Object.entries(d).map(([k, x]) => [k, nulo(x)]));
      for (const k of ['tpCat', 'iniciatCat', 'tpLocal', 'lateralidade', 'localTpInsc']) corpo[k] = corpo[k] === null ? null : Number(corpo[k]);
      if (cat) await api.put(`/esocial/cats/${cat.id}`, corpo); else await api.post(`/esocial/ocorrencias/${ocorrencia.id}/cats`, corpo);
      aoSalvar();
    }}>
      <p className="text-sm text-slate-600">
        Data, hora e tipo do acidente vêm da ocorrência ({dataBr(ocorrencia.dataHora)} {ocorrencia.dataHora.slice(11, 16)}). Os dados médicos ficam no atestado, preenchido à parte por quem tem acesso clínico.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Vínculo do trabalhador" obrigatorio>
          <select className="campo" required value={d.vinculoId} onChange={m('vinculoId')}>
            <option value="" />
            {(vinc.data?.vinculos ?? []).map((x: any) => <option key={x.id} value={x.id}>Matrícula {x.matricula} · admissão {dataBr(x.dataAdmissao)}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Tipo de CAT" obrigatorio>
          <select className="campo" value={d.tpCat} onChange={m('tpCat')}>
            {Object.entries(TIPOS_CAT).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
          </select>
        </Campo>
        {Number(d.tpCat) !== 1 && <Campo rotulo="Recibo da CAT anterior" obrigatorio={Number(d.tpCat) === 2}><input className="campo font-mono" value={d.nrRecCatOrig} onChange={m('nrRecCatOrig')} placeholder="1.2.0000000000000000000" /></Campo>}
        <Campo rotulo="Iniciativa da CAT" obrigatorio>
          <select className="campo" value={d.iniciatCat} onChange={m('iniciatCat')}>
            {Object.entries(INICIATIVAS_CAT).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
          </select>
        </Campo>
        {TIPO_ACIDENTE_OCORRENCIA[ocorrencia.tipo] !== 2 && (
          <Campo rotulo="Horas trabalhadas antes do acidente (HHMM)"><input className="campo" maxLength={4} inputMode="numeric" value={d.hrsTrabAntesAcid} onChange={m('hrsTrabAntesAcid')} placeholder="0230" /></Campo>
        )}
        <Campo rotulo="Último dia trabalhado"><input type="date" className="campo" value={d.ultDiaTrab} onChange={m('ultDiaTrab')} /></Campo>
        <Campo rotulo="Houve óbito?"><SimNao valor={d.indCatObito} onChange={v('indCatObito')} /></Campo>
        {d.indCatObito === 'S' && <Campo rotulo="Data do óbito" obrigatorio><input type="date" className="campo" required value={d.dtObito} onChange={m('dtObito')} /></Campo>}
        <Campo rotulo="Houve comunicação à autoridade policial?"><SimNao valor={d.indComunPolicia} onChange={v('indComunPolicia')} /></Campo>
      </div>
      <Campo rotulo="Situação geradora (Tabela 15)" obrigatorio><CodigoTabela tabela={15} valor={d.codSitGeradora} onChange={v('codSitGeradora')} required /></Campo>
      <Campo rotulo="Agente causador (Tabela 14 ou 15)" obrigatorio><CodigoTabela tabela={[14, 15]} valor={d.codAgntCausador} onChange={v('codAgntCausador')} required /></Campo>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Campo rotulo="Parte do corpo atingida (Tabela 13)" obrigatorio><CodigoTabela tabela={13} valor={d.codParteAting} onChange={v('codParteAting')} required /></Campo>
        <Campo rotulo="Lateralidade" obrigatorio>
          <select className="campo" value={d.lateralidade} onChange={m('lateralidade')}>
            {Object.entries(LATERALIDADES).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
          </select>
        </Campo>
      </div>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Local do acidente</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Tipo de local" obrigatorio className="sm:col-span-2">
            <select className="campo" value={d.tpLocal} onChange={m('tpLocal')}>
              {Object.entries(TIPOS_LOCAL_ACIDENTE).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Especificação do local (opcional)" className="sm:col-span-2"><input className="campo" maxLength={255} value={d.dscLocal} onChange={m('dscLocal')} /></Campo>
          <Campo rotulo="Logradouro" obrigatorio><input className="campo" required maxLength={100} value={d.dscLograd} onChange={m('dscLograd')} /></Campo>
          <Campo rotulo="Número" obrigatorio><input className="campo" required maxLength={10} value={d.nrLograd} onChange={m('nrLograd')} placeholder="S/N" /></Campo>
          <Campo rotulo="Complemento"><input className="campo" maxLength={30} value={d.complemento} onChange={m('complemento')} /></Campo>
          <Campo rotulo="Bairro"><input className="campo" maxLength={90} value={d.bairro} onChange={m('bairro')} /></Campo>
          {!exterior ? (
            <>
              <Campo rotulo="CEP"><input className="campo" value={d.cep} onChange={m('cep')} /></Campo>
              <Campo rotulo="Município (código IBGE, 7 dígitos)"><input className="campo" value={d.codMunic} onChange={m('codMunic')} /></Campo>
              <Campo rotulo="UF">
                <select className="campo" value={d.uf} onChange={m('uf')}><option value="" />{UFS.map((u) => <option key={u}>{u}</option>)}</select>
              </Campo>
            </>
          ) : (
            <>
              <Campo rotulo="País (Tabela 06, 3 dígitos)" obrigatorio><input className="campo" required value={d.pais} onChange={m('pais')} /></Campo>
              <Campo rotulo="Código postal" obrigatorio><input className="campo" required maxLength={12} value={d.codPostal} onChange={m('codPostal')} /></Campo>
            </>
          )}
          <Campo rotulo="Inscrição do local">
            <select className="campo" value={d.localTpInsc} onChange={m('localTpInsc')}>
              <option value="">Não informar</option><option value="1">CNPJ</option><option value="3">CAEPF</option><option value="4">CNO</option>
            </select>
          </Campo>
          {d.localTpInsc && <Campo rotulo="Número da inscrição do local" obrigatorio><input className="campo" required value={d.localNrInsc} onChange={m('localNrInsc')} /></Campo>}
        </div>
      </fieldset>
      <Campo rotulo="Observação (opcional)"><textarea className="campo" rows={2} maxLength={999} value={d.obsCat} onChange={m('obsCat')} /></Campo>
    </Formulario>
  );
}

function FormAtestado({ cat, aoSalvar }: { cat: any; aoSalvar: () => void }) {
  const [d, setD] = useState<any>(cat.atestado ? { ...ATESTADO_VAZIO, ...semNulos(cat.atestado) } : { ...ATESTADO_VAZIO });
  const m = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const corpo: any = Object.fromEntries(Object.entries(d).map(([k, x]) => [k, nulo(x)]));
      corpo.durTrat = Number(corpo.durTrat);
      corpo.ideOcEmit = Number(corpo.ideOcEmit);
      await api.put(`/esocial/cats/${cat.id}/atestado`, corpo);
      aoSalvar();
    }}>
      <Aviso tipo="info">Dados de saúde (CID e diagnóstico). Transcreva o atestado emitido pelo médico ou dentista que atendeu o trabalhador.</Aviso>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Data do atendimento" obrigatorio><input type="date" className="campo" required value={d.dtAtendimento} onChange={m('dtAtendimento')} /></Campo>
        <Campo rotulo="Hora do atendimento (HHMM)" obrigatorio><input className="campo" required maxLength={4} inputMode="numeric" value={d.hrAtendimento} onChange={m('hrAtendimento')} /></Campo>
        <Campo rotulo="Houve internação?"><SimNao valor={d.indInternacao} onChange={(x) => setD({ ...d, indInternacao: x })} /></Campo>
        <Campo rotulo="Duração provável do tratamento (dias)" obrigatorio><input type="number" min={0} max={9999} className="campo" required value={d.durTrat} onChange={m('durTrat')} /></Campo>
        <Campo rotulo="Houve afastamento?"><SimNao valor={d.indAfast} onChange={(x) => setD({ ...d, indAfast: x })} /></Campo>
        <Campo rotulo="CID (sem ponto)" obrigatorio><input className="campo uppercase" required maxLength={4} value={d.codCid} onChange={m('codCid')} placeholder="S610" /></Campo>
      </div>
      <Campo rotulo="Natureza da lesão (Tabela 17)" obrigatorio><CodigoTabela tabela={17} valor={d.dscLesao} onChange={(x) => setD({ ...d, dscLesao: x })} required /></Campo>
      <Campo rotulo="Complemento da lesão"><input className="campo" maxLength={200} value={d.dscCompLesao} onChange={m('dscCompLesao')} /></Campo>
      <Campo rotulo="Diagnóstico provável"><input className="campo" maxLength={100} value={d.diagProvavel} onChange={m('diagProvavel')} /></Campo>
      <Campo rotulo="Observação"><textarea className="campo" rows={2} maxLength={255} value={d.observacao} onChange={m('observacao')} /></Campo>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Emitente do atestado</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" obrigatorio className="sm:col-span-2"><input className="campo" required maxLength={70} value={d.nmEmit} onChange={m('nmEmit')} /></Campo>
          <Campo rotulo="Conselho" obrigatorio>
            <select className="campo" value={d.ideOcEmit} onChange={m('ideOcEmit')}>
              {Object.entries(ORGAOS_EMITENTE_ATESTADO).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Número no conselho" obrigatorio><input className="campo" required maxLength={14} value={d.nrOcEmit} onChange={m('nrOcEmit')} /></Campo>
          {Number(d.ideOcEmit) !== 3 && (
            <Campo rotulo="UF do conselho" obrigatorio>
              <select className="campo" required value={d.ufOcEmit} onChange={m('ufOcEmit')}><option value="" />{UFS.map((u) => <option key={u}>{u}</option>)}</select>
            </Campo>
          )}
        </div>
      </fieldset>
    </Formulario>
  );
}

/** CAT da ocorrência (dados do acidente, atestado e evento S-2210). */
export function SecaoCat({ ocorrencia }: { ocorrencia: any }) {
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [janela, setJanela] = useState<null | { cat: any | null } | { atestado: any }>(null);
  const [erro, setErro] = useState<unknown>();
  const empresaId = ocorrencia.empresaId;
  const q = useQuery({
    queryKey: ['cats', ocorrencia.id],
    queryFn: () => api.get(`/esocial/ocorrencias/${ocorrencia.id}/cats`),
    enabled: s.pode('esocial.ler'),
  });
  if (!TIPO_ACIDENTE_OCORRENCIA[ocorrencia.tipo] || !s.pode('esocial.ler')) return null;
  const preparar = s.pode('esocial.preparar');
  const clinico = s.pode('saude.clinico');
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ['cats', ocorrencia.id] });
    qc.invalidateQueries({ queryKey: ['esocial-pendencias'] });
    setJanela(null);
  };
  const gerar = async (catId: string) => {
    setErro(undefined);
    try {
      const ev = await api.post(`/esocial/preparar/s2210/${catId}`);
      qc.invalidateQueries({ queryKey: ['esocial-eventos'] });
      nav(`/esocial/eventos/${ev.id}`);
    } catch (x) { setErro(x); }
  };
  const travada = (c: any) => c.evento && ['aprovado', 'enviado', 'processado'].includes(c.evento.situacao);
  return (
    <section className="cartao mt-4 p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">CAT e evento S-2210</h2>
        {preparar && ocorrencia.funcionarioId && <button className="btn-secundario" onClick={() => setJanela({ cat: null })}><Plus size={15} /> Preencher CAT</button>}
      </div>
      <Aviso erro={erro} />
      {!ocorrencia.funcionarioId && <p className="text-sm text-amber-700">Informe o funcionário envolvido na ocorrência para preencher a CAT.</p>}
      {q.data?.length === 0 && ocorrencia.funcionarioId && <p className="text-sm text-slate-500">CAT ainda não preenchida.</p>}
      {(q.data ?? []).map((c: any) => (
        <div key={c.id} className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm">
          <FileText size={16} className="text-slate-400" />
          <span className="font-medium">CAT {TIPOS_CAT[c.tpCat as 1 | 2 | 3].toLowerCase()}</span>
          <span className="text-slate-500">matrícula {c.matricula}</span>
          <span className={c.temAtestado ? 'text-emerald-700' : 'text-amber-700'}>{c.temAtestado ? 'Atestado preenchido' : 'Falta o atestado médico'}</span>
          {c.evento && <button className="inline-flex items-center gap-1" onClick={() => nav(`/esocial/eventos/${c.evento.id}`)}>S-2210 <SituacaoEvento s={c.evento.situacao} /></button>}
          <div className="ml-auto flex flex-wrap gap-2">
            {preparar && !travada(c) && <button className="btn-secundario" onClick={() => setJanela({ cat: c })}><Pencil size={14} /> Dados do acidente</button>}
            {preparar && clinico && !travada(c) && <button className="btn-secundario" onClick={() => setJanela({ atestado: c })}><Stethoscope size={14} /> Atestado</button>}
            {preparar && c.temAtestado && (!c.evento || ['invalido', 'pendente', 'rejeitado', 'cancelado'].includes(c.evento.situacao)) &&
              <button className="btn-primario" onClick={() => gerar(c.id)}>{c.evento && c.evento.situacao !== 'rejeitado' ? 'Gerar S-2210 de novo' : 'Gerar S-2210'}</button>}
          </div>
        </div>
      ))}
      <p className="mt-3 text-xs text-slate-500">Gerar o S-2210 não envia nada: o evento passa por validação e aprovação na Central de eventos do eSocial.</p>
      <Modal titulo="CAT · dados do acidente" aberto={!!janela && 'cat' in janela} aoFechar={() => setJanela(null)}>
        {janela && 'cat' in janela && <FormCat ocorrencia={ocorrencia} cat={janela.cat} aoSalvar={atualizar} />}
      </Modal>
      <Modal titulo="CAT · atestado médico" aberto={!!janela && 'atestado' in janela} aoFechar={() => setJanela(null)}>
        {janela && 'atestado' in janela && <FormAtestado cat={janela.atestado} aoSalvar={atualizar} />}
      </Modal>
    </section>
  );
}
