import { useQuery } from '@tanstack/react-query';
import { AlarmClock, AlertTriangle, CheckCircle2, Hourglass, Send, ShieldCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Indicador } from './Indicador';

/** Indicadores do eSocial no início: eventos por situação, prazos vencidos e lotes sem retorno. */
export function PainelEsocial() {
  const s = useSessao();
  const q = useQuery({
    queryKey: ['esocial-painel', s.empresaId],
    queryFn: () => api.get(`/esocial/painel${qs({ empresaId: s.empresaId })}`),
  });
  if (!q.data) return null;
  const p = q.data.porSituacao as Record<string, number>;
  const n = (k: string) => p[k] ?? 0;
  return (
    <>
      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">eSocial</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <Indicador rotulo="Aguardando aprovação" valor={n('pendente')} para="/esocial?aba=eventos&situacao=pendente" icone={<ShieldCheck size={20} />} tom="ambar" alerta />
        <Indicador rotulo="Com erro de validação" valor={n('invalido')} para="/esocial?aba=eventos&situacao=invalido" icone={<AlertTriangle size={20} />} tom="vermelho" alerta />
        <Indicador rotulo="Rejeitados pelo eSocial" valor={n('rejeitado')} para="/esocial?aba=eventos&situacao=rejeitado" icone={<AlertTriangle size={20} />} tom="vermelho" alerta />
        <Indicador rotulo="Aprovados, a enviar" valor={n('aprovado')} para="/esocial?aba=eventos&situacao=aprovado" icone={<Send size={20} />} tom="azul" />
        <Indicador rotulo="Lotes aguardando retorno" valor={q.data.lotesAguardando} para="/esocial/lotes" icone={<Hourglass size={20} />} tom="violeta" />
        <Indicador rotulo="Eventos com prazo vencido" valor={q.data.prazoVencido} para="/esocial?aba=eventos" icone={<AlarmClock size={20} />} tom="vermelho" alerta />
        <Indicador rotulo="Processados (com recibo)" valor={n('processado')} para="/esocial?aba=eventos&situacao=processado" icone={<CheckCircle2 size={20} />} />
      </div>
    </>
  );
}
