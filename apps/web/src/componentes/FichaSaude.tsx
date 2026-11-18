import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RESULTADOS_ASO, TIPOS_ASO, TIPOS_TURMA } from '@sst/shared';
import { api, qs } from '../lib/api';
import { dataBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { DetalheAso, FormAso } from '../paginas/Asos';
import { SituacaoPrazo } from './saude';
import { Carregando, Modal, Vazio } from './ui';

/** ASOs do funcionário (todos os vínculos), com registro rápido. */
export function FichaAsos({ funcionario }: { funcionario: any }) {
  const s = useSessao();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const q = useQuery({
    queryKey: ['asos', 'funcionario', funcionario.id],
    queryFn: () => api.get(`/asos${qs({ funcionarioId: funcionario.id, limite: 200 })}`),
  });
  const vinculoAtivo = funcionario.vinculos.find((v: any) => !v.dataDesligamento) ?? funcionario.vinculos[0];
  const recarregar = () => qc.invalidateQueries({ queryKey: ['asos'] });
  return (
    <>
      {s.pode('saude.editar') && vinculoAtivo && (
        <div className="mb-3 flex justify-end"><button className="btn-primario" onClick={() => setNovo(true)}><Plus size={16} /> Registrar ASO</button></div>
      )}
      <div className="cartao overflow-x-auto">
        {q.isLoading ? <Carregando /> : !q.data?.itens.length ? <Vazio>Nenhum ASO registrado.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Exame</th><th>Tipo</th><th>Matrícula</th><th>Conclusão</th><th>Médico</th><th>Vencimento</th><th>Situação</th></tr></thead>
            <tbody>
              {q.data.itens.map((a: any) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => setAberto(a.id)}>
                  <td className="tabular-nums">{dataBr(a.dataExame)}</td>
                  <td>{TIPOS_ASO[a.tipo as keyof typeof TIPOS_ASO]}</td>
                  <td>{a.matricula}</td>
                  <td>{RESULTADOS_ASO[a.resultado as 1 | 2]}</td>
                  <td>{a.medicoNome}</td>
                  <td className="tabular-nums">{dataBr(a.vencimento)}</td>
                  <td><SituacaoPrazo s={a.situacao} dias={a.situacao === 'vencido' || a.situacao === 'vencendo' ? a.diasParaVencer : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Registrar ASO" aberto={novo} aoFechar={() => setNovo(false)}>
        {novo && vinculoAtivo && (
          <FormAso empresaId={funcionario.empresaId}
            funcionario={{ vinculoId: vinculoAtivo.id, nome: funcionario.nome, cpf: funcionario.cpf, matricula: vinculoAtivo.matricula }}
            aoSalvar={(a) => { setNovo(false); recarregar(); setAberto(a.id); }} />
        )}
      </Modal>
      <Modal titulo="ASO" aberto={!!aberto} aoFechar={() => setAberto(null)}>
        {aberto && <DetalheAso id={aberto} aoMudar={recarregar} />}
      </Modal>
    </>
  );
}

/** Treinamentos exigidos pela função/GHE atual e histórico de participação. */
export function FichaTreinamentos({ funcionarioId }: { funcionarioId: string }) {
  const q = useQuery({ queryKey: ['treinamentos-funcionario', funcionarioId], queryFn: () => api.get(`/funcionarios/${funcionarioId}/treinamentos`) });
  if (q.isLoading || !q.data) return <Carregando />;
  return (
    <div className="space-y-4">
      <div className="cartao overflow-x-auto">
        <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Exigidos pela função e GHE atuais</h3>
        {!q.data.exigidos.length ? <Vazio>Nenhum treinamento exigido pela matriz para a lotação atual.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Treinamento</th><th>Última conclusão</th><th>Validade</th><th>Situação</th></tr></thead>
            <tbody>
              {q.data.exigidos.map((t: any) => (
                <tr key={`${t.vinculo_id}-${t.treinamento_id}`}>
                  <td className="font-medium">{t.treinamento_nome}{t.norma && <span className="text-xs text-slate-500"> · {t.norma}</span>}</td>
                  <td>{dataBr(t.ultima_conclusao)}</td>
                  <td>{t.ultima_conclusao ? (t.validade ? dataBr(t.validade) : 'Sem reciclagem') : '—'}</td>
                  <td><SituacaoPrazo s={t.situacao} dias={t.dias_para_vencer} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="cartao overflow-x-auto">
        <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico de turmas</h3>
        {!q.data.historico.length ? <Vazio>Não participou de nenhuma turma.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Treinamento</th><th>Período</th><th>Tipo</th><th>Resultado</th><th>Validade</th><th /></tr></thead>
            <tbody>
              {q.data.historico.map((h: any) => (
                <tr key={h.id}>
                  <td><Link className="font-medium hover:underline" to={`/turmas/${h.turmaId}`}>{h.treinamentoNome}</Link></td>
                  <td className="tabular-nums">{dataBr(h.dataInicio)} a {dataBr(h.dataFim)}</td>
                  <td>{TIPOS_TURMA[h.tipo as keyof typeof TIPOS_TURMA]}</td>
                  <td>{h.situacao !== 'realizada' ? <SituacaoPrazo s={h.situacao} /> : h.aprovado ? 'Aprovado' : h.presente ? 'Não aprovado' : 'Ausente'}</td>
                  <td>{h.aprovado ? (h.validade ? dataBr(h.validade) : 'Sem reciclagem') : '—'}</td>
                  <td className="text-right">{h.certificadoCodigo && <a className="inline-flex items-center gap-1 text-marca-700 hover:underline" href={`/api/participantes/${h.id}/certificado`}><FileDown size={14} /> Certificado</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
