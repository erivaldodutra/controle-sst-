import { useQuery } from '@tanstack/react-query';
import { CalendarClock, FileCheck2, FilePen, Files, FileWarning, FileX2 } from 'lucide-react';
import { ReactNode } from 'react';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Indicador, Tom } from './Indicador';

/** Indicadores de programas legais e documentos para o painel inicial. */
export function PainelDocumentos() {
  const s = useSessao();
  const { data } = useQuery({
    queryKey: ['documentos', s.empresaId, ''],
    queryFn: () => api.get(`/documentos${qs({ empresaId: s.empresaId })}`),
    enabled: s.pode('documentos.ler'),
  });
  if (!data) return null;
  const n = (l: string[]) => l.reduce((a, x) => a + (data.resumo?.[x] ?? 0), 0);
  const cartoes: { rotulo: string; sits: string[]; icone: ReactNode; tom: Tom; alerta?: boolean }[] = [
    { rotulo: 'Documentos regulares', sits: ['regular'], icone: <FileCheck2 size={20} />, tom: 'marca' },
    { rotulo: 'Pendentes', sits: ['pendente'], icone: <FileWarning size={20} />, tom: 'vermelho', alerta: true },
    { rotulo: 'Próximos da revisão ou vencimento', sits: ['proximo_revisao', 'proximo_vencimento'], icone: <CalendarClock size={20} />, tom: 'ambar', alerta: true },
    { rotulo: 'Vencidos', sits: ['vencido'], icone: <FileX2 size={20} />, tom: 'vermelho', alerta: true },
    { rotulo: 'Em elaboração ou revisão', sits: ['em_elaboracao', 'em_revisao'], icone: <FilePen size={20} />, tom: 'azul' },
    { rotulo: 'Substituídos', sits: ['substituido'], icone: <Files size={20} />, tom: 'cinza' },
  ];
  return (
    <>
      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">Programas legais e documentos</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        {cartoes.map((c) => (
          <Indicador key={c.rotulo} rotulo={c.rotulo} valor={n(c.sits)} para={`/documentos?situacao=${c.sits.join(',')}`} icone={c.icone} tom={c.tom} alerta={c.alerta} />
        ))}
      </div>
    </>
  );
}
