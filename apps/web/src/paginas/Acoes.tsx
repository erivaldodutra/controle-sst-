import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ORIGENS_ACAO, PRIORIDADES, SITUACOES_ACAO } from '@sst/shared';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { FormAcao, Prioridade, PrazoAcao, SituacaoAcao } from '../componentes/acoes';
import { Carregando, Modal, Titulo, Vazio } from '../componentes/ui';

const CARTOES: { rotulo: string; chave: string; cor: string }[] = [
  { rotulo: 'Abertas', chave: 'abertas', cor: 'text-tinta' },
  { rotulo: 'Atrasadas', chave: 'atrasadas', cor: 'text-red-600' },
  { rotulo: 'Prazo próximo', chave: 'proximas', cor: 'text-amber-600' },
  { rotulo: 'Em validação', chave: 'em_validacao', cor: 'text-violet-700' },
  { rotulo: 'Reprogramadas', chave: 'reprogramadas', cor: 'text-amber-600' },
  { rotulo: 'Concluídas', chave: 'concluida', cor: 'text-emerald-700' },
];

export function Acoes() {
  const s = useSessao();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const situacao = params.get('situacao') ?? 'abertas';
  const origem = params.get('origem') ?? '';
  const prioridade = params.get('prioridade') ?? '';
  const [busca, setBusca] = useState(params.get('busca') ?? '');
  const [nova, setNova] = useState(false);
  const q = useQuery({
    queryKey: ['acoes', s.empresaId, situacao, origem, prioridade, params.get('busca') ?? ''],
    queryFn: () => api.get(`/acoes${qs({ empresaId: s.empresaId, situacao: situacao === 'todas' ? '' : situacao, origem, prioridade, busca: params.get('busca') })}`),
  });
  const mudar = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const itens = q.data?.itens ?? [];
  return (
    <>
      <Titulo
        titulo="Planos de ação"
        subtitulo="Ações do PGR, PCMSO, inspeções, acidentes e da matriz de conformidade, com prazo, evidência e validação"
        acoes={s.pode('acoes.editar') && s.empresaId ? <button className="btn-primario" onClick={() => setNova(true)}><Plus size={16} /> Nova ação</button> : undefined}
      />
      {q.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {CARTOES.map((c) => {
            const n = q.data.resumo?.[c.chave] ?? 0;
            const ativo = situacao === c.chave;
            return (
              <button key={c.chave} className={`cartao p-4 text-left transition hover:-translate-y-0.5 hover:border-marca-200 hover:shadow-elevado ${ativo ? 'border-marca-500 ring-4 ring-marca-500/10' : ''}`}
                onClick={() => mudar('situacao', c.chave)}>
                <div className="text-[13px] font-medium leading-snug text-slate-500">{c.rotulo}</div>
                <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${n ? c.cor : ''}`}>{n}</div>
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); mudar('busca', busca.trim()); }}>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="campo w-64 pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, ação ou responsável" aria-label="Buscar" />
        </form>
        <select className="campo max-w-52" value={situacao} onChange={(e) => mudar('situacao', e.target.value)} aria-label="Situação">
          <option value="abertas">Todas as abertas</option>
          <option value="todas">Todas, inclusive encerradas</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="proximas">Prazo próximo</option>
          <option value="reprogramadas">Reprogramadas</option>
          {Object.entries(SITUACOES_ACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="campo max-w-52" value={origem} onChange={(e) => mudar('origem', e.target.value)} aria-label="Origem">
          <option value="">Todas as origens</option>
          {Object.entries(ORIGENS_ACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="campo max-w-40" value={prioridade} onChange={(e) => mudar('prioridade', e.target.value)} aria-label="Prioridade">
          <option value="">Toda prioridade</option>
          {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!s.empresaId && s.pode('acoes.editar') && <p className="mb-2 text-xs text-slate-500">Selecione uma empresa no topo para abrir ações.</p>}
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !itens.length ? (
          <Vazio>{q.data?.resumo && Object.values(q.data.resumo).some((n: any) => n > 0) ? 'Nenhuma ação com estes filtros.' : 'Nenhuma ação cadastrada ainda.'}</Vazio>
        ) : (
          <table className="tabela">
            <thead><tr><th>Ação</th>{!s.empresaId && <th>Empresa</th>}<th>Origem</th><th>Prioridade</th><th>Responsável</th><th>Prazo</th><th>Situação</th></tr></thead>
            <tbody>
              {itens.map((a: any) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => nav(`/acoes/${a.id}`)}>
                  <td>
                    <div className="font-medium">{a.codigo}</div>
                    <div className="max-w-md truncate text-xs text-slate-500" title={a.descricao}>{a.descricao}</div>
                  </td>
                  {!s.empresaId && <td>{a.empresaNome}</td>}
                  <td className="text-sm">{ORIGENS_ACAO[a.origem as keyof typeof ORIGENS_ACAO]}{a.inspecaoCodigo ? ` · ${a.inspecaoCodigo}` : a.ocorrenciaCodigo ? ` · ${a.ocorrenciaCodigo}` : ''}</td>
                  <td><Prioridade p={a.prioridade} /></td>
                  <td>{a.responsavelNome}</td>
                  <td><PrazoAcao a={a} /></td>
                  <td>
                    <SituacaoAcao s={a.situacao} />
                    {a.exigeEvidencia && !a.evidencias && a.estado !== 'encerrada' && <div className="mt-0.5 text-xs text-slate-500">sem evidência</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.data && <p className="mt-2 text-xs text-slate-500">"Prazo próximo" considera o maior prazo de alerta configurado ({q.data.alertaDias} dias).</p>}
      <Modal titulo="Nova ação" aberto={nova} aoFechar={() => setNova(false)} largura="max-w-2xl">
        {nova && s.empresaId && <FormAcao empresaId={s.empresaId} aoSalvar={(a) => nav(`/acoes/${a.id}`)} />}
      </Modal>
    </>
  );
}
