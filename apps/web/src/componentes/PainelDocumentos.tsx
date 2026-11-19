import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';

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
  const cartoes = [
    { rotulo: 'Documentos regulares', sits: ['regular'], cor: '' },
    { rotulo: 'Pendentes', sits: ['pendente'], cor: 'text-red-700' },
    { rotulo: 'Próximos da revisão ou vencimento', sits: ['proximo_revisao', 'proximo_vencimento'], cor: 'text-amber-700' },
    { rotulo: 'Vencidos', sits: ['vencido'], cor: 'text-red-700' },
    { rotulo: 'Em elaboração ou revisão', sits: ['em_elaboracao', 'em_revisao'], cor: '' },
    { rotulo: 'Substituídos', sits: ['substituido'], cor: '' },
  ];
  return (
    <>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-600">Programas legais e documentos</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {cartoes.map((c) => {
          const v = n(c.sits);
          return (
            <Link key={c.rotulo} to={`/documentos?situacao=${c.sits.join(',')}`}>
              <div className="cartao p-4 transition hover:border-marca-500">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.rotulo}</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${v ? c.cor : ''}`}>{v.toLocaleString('pt-BR')}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
