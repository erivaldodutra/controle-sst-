import { ORIGENS_ACAO, PRIORIDADES, SITUACOES_ACAO, SITUACOES_CONFORMIDADE, TIPOS_ACAO } from '@sst/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useEstabelecimentos, useEstrutura } from '../paginas/Estrutura';
import { Formulario } from './saude';
import { Campo, Etiqueta } from './ui';

const COR_SITUACAO: Record<string, string> = {
  nao_iniciada: 'bg-slate-100 text-slate-700',
  em_andamento: 'bg-sky-100 text-sky-800',
  aguardando_evidencia: 'bg-amber-100 text-amber-800',
  em_validacao: 'bg-violet-100 text-violet-800',
  concluida: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-slate-200 text-slate-600 line-through',
};

export function SituacaoAcao({ s }: { s: string }) {
  return <Etiqueta cor={COR_SITUACAO[s] ?? 'bg-slate-100 text-slate-700'}>{SITUACOES_ACAO[s as keyof typeof SITUACOES_ACAO] ?? s}</Etiqueta>;
}

const COR_PRIORIDADE: Record<string, string> = {
  baixa: 'bg-slate-100 text-slate-600', media: 'bg-sky-50 text-sky-700', alta: 'bg-amber-100 text-amber-800', urgente: 'bg-red-100 text-red-800',
};
export function Prioridade({ p }: { p: string }) {
  return <Etiqueta cor={COR_PRIORIDADE[p] ?? ''}>{PRIORIDADES[p as keyof typeof PRIORIDADES] ?? p}</Etiqueta>;
}

/** Prazo da ação com destaque para atraso, proximidade e reprogramação. */
export function PrazoAcao({ a }: { a: any }) {
  const cor = a.estado === 'atrasado' ? 'text-red-700 font-medium' : a.estado === 'proximo' ? 'text-amber-700' : 'text-slate-700';
  const quando = a.estado === 'encerrada' ? '' : a.dias < 0 ? ` (${-a.dias} d de atraso)` : a.dias === 0 ? ' (hoje)' : ` (em ${a.dias} d)`;
  return (
    <span className={cor}>
      {dataBr(a.prazo)}<span className="text-xs">{quando}</span>
      {a.reprogramada && <span className="ml-1 text-xs text-slate-500" title={`Prazo inicial: ${dataBr(a.prazoInicial)}`}>· reprogramada</span>}
    </span>
  );
}

const COR_CONF: Record<string, string> = {
  conforme: 'bg-emerald-100 text-emerald-800',
  parcial: 'bg-amber-100 text-amber-800',
  nao_conforme: 'bg-red-100 text-red-800',
  nao_avaliado: 'bg-slate-100 text-slate-700',
  a_avaliar: 'bg-sky-100 text-sky-800',
  nao_aplicavel: 'bg-slate-200 text-slate-600',
};
export function SituacaoConformidade({ s }: { s: string }) {
  return <Etiqueta cor={COR_CONF[s] ?? ''}>{SITUACOES_CONFORMIDADE[s as keyof typeof SITUACOES_CONFORMIDADE] ?? s}</Etiqueta>;
}

/** Vínculo de origem já definido por quem abriu o formulário (inspeção, ocorrência, matriz, documento). */
export interface OrigemFixa {
  origem: keyof typeof ORIGENS_ACAO;
  rotulo: string;
  inspecaoItemId?: string;
  ocorrenciaId?: string;
  conformidadeId?: string;
  documentoId?: string;
  estabelecimentoId?: string | null;
  setorId?: string | null;
  descricao?: string;
}

/** Formulário de ação nova (com origem livre ou já vinculada). */
export function FormAcao({ empresaId, fixa, aoSalvar }: { empresaId: string; fixa?: OrigemFixa; aoSalvar: (a: any) => void }) {
  const ests = useEstabelecimentos(empresaId);
  const setores = useEstrutura(empresaId, 'setores');
  const ghes = useEstrutura(empresaId, 'ghes');
  const [d, setD] = useState<any>({
    origem: fixa?.origem ?? '', tipo: 'introduzir', prioridade: 'media', dataAbertura: hojeIso(), exigeEvidencia: true,
    estabelecimentoId: fixa?.estabelecimentoId ?? '', setorId: fixa?.setorId ?? '', descricao: fixa?.descricao ?? '',
  });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const setoresEst = (setores.data ?? []).filter((x: any) => !d.estabelecimentoId || x.estabelecimentoId === d.estabelecimentoId);
  const ghesEst = (ghes.data ?? []).filter((x: any) => !d.estabelecimentoId || x.estabelecimentoId === d.estabelecimentoId);
  return (
    <Formulario botao="Abrir ação" aoEnviar={async () => {
      const v = (k: string) => d[k] || null;
      aoSalvar(await api.post('/acoes', {
        empresaId, origem: d.origem, inspecaoItemId: fixa?.inspecaoItemId ?? null, ocorrenciaId: fixa?.ocorrenciaId ?? null,
        conformidadeId: fixa?.conformidadeId ?? null, documentoId: fixa?.documentoId ?? null,
        estabelecimentoId: v('estabelecimentoId'), setorId: v('setorId'), gheId: v('gheId'), perigo: v('perigo'), descricao: d.descricao,
        justificativa: v('justificativa'), tipo: d.tipo, prioridade: d.prioridade, responsavelNome: d.responsavelNome,
        validadorNome: v('validadorNome'), dataAbertura: d.dataAbertura, prazo: d.prazo, recursos: v('recursos'),
        formaAcompanhamento: v('formaAcompanhamento'), exigeEvidencia: d.exigeEvidencia,
        dispensaJustificativa: d.exigeEvidencia ? null : v('dispensaJustificativa'),
      }));
    }}>
      {fixa ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">Origem: <span className="font-medium text-tinta">{fixa.rotulo}</span></p>
      ) : (
        <Campo rotulo="Origem" obrigatorio>
          <select className="campo" value={d.origem} onChange={set('origem')} required>
            <option value="" />
            {Object.entries(ORIGENS_ACAO).filter(([k]) => !['inspecao', 'acidente', 'investigacao', 'conformidade'].includes(k))
              .map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </Campo>
      )}
      <Campo rotulo="Perigo ou risco relacionado"><input className="campo" value={d.perigo ?? ''} onChange={set('perigo')} placeholder="ex.: ruído contínuo, queda de altura" /></Campo>
      <Campo rotulo="Ação (o que será feito)" obrigatorio><textarea className="campo" rows={3} value={d.descricao} onChange={set('descricao')} required /></Campo>
      <Campo rotulo="Justificativa"><textarea className="campo" rows={2} value={d.justificativa ?? ''} onChange={set('justificativa')} placeholder="Por que esta medida foi escolhida" /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tipo de medida" obrigatorio>
          <select className="campo" value={d.tipo} onChange={set('tipo')}>{Object.entries(TIPOS_ACAO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
        </Campo>
        <Campo rotulo="Prioridade" obrigatorio>
          <select className="campo" value={d.prioridade} onChange={set('prioridade')}>{Object.entries(PRIORIDADES).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
        </Campo>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Estabelecimento">
          <select className="campo" value={d.estabelecimentoId} onChange={(e) => setD({ ...d, estabelecimentoId: e.target.value, setorId: '', gheId: '' })}>
            <option value="">Toda a empresa</option>
            {ests.data?.map((e: any) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Setor">
          <select className="campo" value={d.setorId} onChange={set('setorId')}>
            <option value="" />
            {setoresEst.map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="GHE">
          <select className="campo" value={d.gheId ?? ''} onChange={set('gheId')}>
            <option value="" />
            {ghesEst.map((x: any) => <option key={x.id} value={x.id}>{x.codigo} · {x.nome}</option>)}
          </select>
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Responsável pela execução" obrigatorio><input className="campo" value={d.responsavelNome ?? ''} onChange={set('responsavelNome')} required /></Campo>
        <Campo rotulo="Quem vai validar"><input className="campo" value={d.validadorNome ?? ''} onChange={set('validadorNome')} /></Campo>
        <Campo rotulo="Abertura" obrigatorio><input className="campo" type="date" value={d.dataAbertura} onChange={set('dataAbertura')} required /></Campo>
        <Campo rotulo="Prazo" obrigatorio><input className="campo" type="date" value={d.prazo ?? ''} min={d.dataAbertura} onChange={set('prazo')} required /></Campo>
      </div>
      <Campo rotulo="Recursos necessários"><input className="campo" value={d.recursos ?? ''} onChange={set('recursos')} placeholder="materiais, serviços, orçamento" /></Campo>
      <Campo rotulo="Forma de acompanhamento"><input className="campo" value={d.formaAcompanhamento ?? ''} onChange={set('formaAcompanhamento')} placeholder="ex.: medição após a obra, inspeção mensal" /></Campo>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!d.exigeEvidencia} onChange={(e) => setD({ ...d, exigeEvidencia: !e.target.checked })} />
        Esta ação não terá evidência anexada (exige justificativa técnica)
      </label>
      {!d.exigeEvidencia && (
        <Campo rotulo="Justificativa da dispensa de evidência" obrigatorio>
          <textarea className="campo" rows={2} value={d.dispensaJustificativa ?? ''} onChange={set('dispensaJustificativa')} required />
        </Campo>
      )}
    </Formulario>
  );
}

/** Lista curta de ações ligadas a um registro (inspeção, ocorrência, documento, requisito). */
export function AcoesLigadas({ acoes, aoAbrir }: { acoes: any[]; aoAbrir: (id: string) => void }) {
  if (!acoes.length) return <p className="text-sm text-slate-500">Nenhuma ação aberta a partir deste registro.</p>;
  return (
    <table className="tabela">
      <thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Situação</th></tr></thead>
      <tbody>
        {acoes.map((a) => (
          <tr key={a.id} className="cursor-pointer" onClick={() => aoAbrir(a.id)}>
            <td><div className="font-medium">{a.codigo}</div><div className="max-w-md truncate text-xs text-slate-500">{a.descricao}</div></td>
            <td>{a.responsavelNome}</td>
            <td><PrazoAcao a={a} /></td>
            <td><SituacaoAcao s={a.situacao} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
