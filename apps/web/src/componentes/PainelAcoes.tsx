import { useQuery } from '@tanstack/react-query';
import { AlarmClock, BadgeCheck, Building2, ClipboardCheck, ListChecks, ListTodo, Scale, ShieldAlert } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Indicador } from './Indicador';

/** Indicadores de planos de ação e da matriz de conformidade para o painel inicial. */
export function PainelAcoes() {
  const s = useSessao();
  const acoes = useQuery({
    queryKey: ['acoes', s.empresaId, 'abertas', '', '', ''],
    queryFn: () => api.get(`/acoes${qs({ empresaId: s.empresaId, situacao: 'abertas' })}`),
    enabled: s.pode('acoes.ler'),
  });
  const matriz = useQuery({
    queryKey: ['conformidade', s.empresaId, ''],
    queryFn: () => api.get(`/conformidade${qs({ empresaId: s.empresaId })}`),
    enabled: s.pode('conformidade.ler') && !!s.empresaId,
  });
  const visao = useQuery({
    queryKey: ['conformidade-empresas'],
    queryFn: () => api.get('/conformidade/empresas'),
    enabled: s.pode('conformidade.ler') && !s.empresaId,
  });
  const r = acoes.data?.resumo;
  const m = s.empresaId ? matriz.data?.resumo : undefined;
  const v = s.empresaId ? undefined : visao.data?.resumo;
  if (!r && !m && !v) return null;
  return (
    <>
      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">Planos de ação e conformidade</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        {r && <Indicador rotulo="Ações abertas" valor={r.abertas} para="/acoes?situacao=abertas" icone={<ListTodo size={20} />} tom="azul" />}
        {r && <Indicador rotulo="Ações atrasadas" valor={r.atrasadas} para="/acoes?situacao=atrasadas" icone={<ShieldAlert size={20} />} tom="vermelho" alerta />}
        {r && <Indicador rotulo="Ações com prazo próximo" valor={r.proximas} para="/acoes?situacao=proximas" icone={<AlarmClock size={20} />} tom="ambar" alerta />}
        {r && <Indicador rotulo="Aguardando validação" valor={r.em_validacao} para="/acoes?situacao=em_validacao" icone={<ClipboardCheck size={20} />} tom="violeta" alerta={s.pode('acoes.validar')} />}
        {m && <Indicador rotulo={`Requisitos não conformes${m.percentual != null ? ` · ${m.percentual.toLocaleString('pt-BR')}% atendido` : ''}`} valor={m.nao_conforme + m.parcial} para="/conformidade" icone={<Scale size={20} />} tom="vermelho" alerta />}
        {m && <Indicador rotulo="Requisitos a avaliar" valor={m.a_avaliar + m.nao_avaliado} para="/conformidade" icone={<ListChecks size={20} />} tom="ambar" alerta />}
        {v && <Indicador rotulo="Empresas com vencidos ou atrasos" valor={v.com_vencidos} para="/conformidade?aba=empresas" icone={<Building2 size={20} />} tom="vermelho" alerta />}
        {v && <Indicador rotulo="Empresas com pendências" valor={v.com_pendencias} para="/conformidade?aba=empresas" icone={<Building2 size={20} />} tom="ambar" alerta />}
        {v && <Indicador rotulo="Empresas regulares" valor={v.regular} para="/conformidade?aba=empresas" icone={<BadgeCheck size={20} />} tom="marca" />}
      </div>
    </>
  );
}
