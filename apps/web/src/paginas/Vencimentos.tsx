import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { dataBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Formulario, SituacaoPrazo } from '../componentes/saude';
import { Campo, Carregando, Modal, Titulo, Vazio } from '../componentes/ui';

function ConfigAlertas({ atual, aoSalvar }: { atual: number[]; aoSalvar: () => void }) {
  const [texto, setTexto] = useState(atual.join(', '));
  return (
    <Formulario aoEnviar={async () => {
      const dias = texto.split(/[^\d]+/).filter(Boolean).map(Number);
      await api.put('/configuracoes/alertas', { alertasDias: dias });
      aoSalvar();
    }}>
      <Campo rotulo="Avisar com quantos dias de antecedência (até 6 prazos, separados por vírgula)">
        <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="90, 60, 30, 15" />
      </Campo>
      <p className="text-xs text-slate-500">Vale para ASO e treinamentos de todas as empresas. Um item entra em "vencendo" quando faltam menos dias que o maior prazo.</p>
    </Formulario>
  );
}

export function Vencimentos() {
  const s = useSessao();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tipo = params.get('tipo') ?? '';
  const situacao = params.get('situacao') ?? '';
  const [config, setConfig] = useState(false);
  const q = useQuery({
    queryKey: ['vencimentos', s.empresaId, tipo],
    queryFn: () => api.get(`/vencimentos${qs({ empresaId: s.empresaId, tipo })}`),
  });
  const mudar = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const itens = (q.data?.itens ?? []).filter((i: any) => !situacao || i.situacao === situacao);
  const contar = (t: string, sit: string[]) => sit.reduce((n, x) => n + (q.data?.resumo?.[t]?.[x] ?? 0), 0);
  return (
    <>
      <Titulo
        titulo="Vencimentos e pendências"
        subtitulo={q.data ? `ASO periódico e treinamentos exigidos dos funcionários ativos e afastados. Prazos de alerta: ${q.data.alertasDias.join(', ')} dias.` : undefined}
        acoes={s.pode('sistema.configurar') && q.data && <button className="btn-secundario" onClick={() => setConfig(true)}><Settings size={16} /> Prazos de alerta</button>}
      />
      {q.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { rotulo: 'ASO vencido ou ausente', n: contar('aso', ['vencido', 'sem_aso']), t: 'aso', cor: 'text-red-600' },
            { rotulo: 'ASO vencendo', n: contar('aso', ['vencendo']), t: 'aso', cor: 'text-amber-600' },
            { rotulo: 'Treinamento vencido ou pendente', n: contar('treinamento', ['vencido', 'pendente']), t: 'treinamento', cor: 'text-red-600' },
            { rotulo: 'Treinamento vencendo', n: contar('treinamento', ['vencendo']), t: 'treinamento', cor: 'text-amber-600' },
          ].map((c) => (
            <button key={c.rotulo} className="cartao p-4 text-left transition hover:-translate-y-0.5 hover:border-marca-200 hover:shadow-elevado" onClick={() => mudar('tipo', c.t)}>
              <div className="text-[13px] font-medium leading-snug text-slate-500">{c.rotulo}</div>
              <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${c.n ? c.cor : ''}`}>{c.n}</div>
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="campo max-w-48" value={tipo} onChange={(e) => mudar('tipo', e.target.value)} aria-label="Tipo">
          <option value="">ASO e treinamentos</option><option value="aso">Só ASO</option><option value="treinamento">Só treinamentos</option>
        </select>
        <select className="campo max-w-56" value={situacao} onChange={(e) => mudar('situacao', e.target.value)} aria-label="Situação">
          <option value="">Todas as pendências</option>
          <option value="vencido">Vencidos</option><option value="vencendo">Vencendo</option>
          <option value="sem_aso">Sem ASO</option><option value="pendente">Treinamento nunca feito</option><option value="sem_vencimento">ASO sem vencimento</option>
        </select>
      </div>
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !itens.length ? <Vazio>Nenhuma pendência. Tudo em dia.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Funcionário</th>{!s.empresaId && <th>Empresa</th>}<th>Item</th><th>Vencimento</th><th>Situação</th><th>Alerta</th></tr></thead>
            <tbody>
              {itens.map((i: any) => (
                <tr key={`${i.tipo}-${i.funcionarioId}-${i.referenciaId}`}>
                  <td><Link className="font-medium hover:underline" to={`/funcionarios/${i.funcionarioId}`}>{i.funcionarioNome}</Link><div className="text-xs text-slate-500">Matr. {i.matricula}</div></td>
                  {!s.empresaId && <td>{i.empresa}</td>}
                  <td>{i.descricao}</td>
                  <td>{dataBr(i.vencimento)}</td>
                  <td><SituacaoPrazo s={i.situacao} dias={i.diasParaVencer} /></td>
                  <td>{i.faixa ? `${i.faixa} dias` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Prazos de alerta" aberto={config} aoFechar={() => setConfig(false)} largura="max-w-lg">
        {config && q.data && <ConfigAlertas atual={q.data.alertasDias} aoSalvar={() => { setConfig(false); qc.invalidateQueries({ queryKey: ['vencimentos'] }); }} />}
      </Modal>
    </>
  );
}
