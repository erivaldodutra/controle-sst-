import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Carregando, Titulo, Vazio } from '../componentes/ui';

const TABELAS: Record<string, string> = {
  empresa: 'Empresa', estabelecimento: 'Estabelecimento', setor: 'Setor', cargo: 'Cargo', funcao: 'Função', ghe: 'GHE',
  funcionario: 'Funcionário', vinculo: 'Vínculo', lotacao: 'Lotação', afastamento: 'Afastamento', importacao: 'Importação',
  usuario: 'Usuário', usuario_atribuicao: 'Perfil de usuário', perfil: 'Perfil', perfil_permissao: 'Permissão de perfil',
};
const OPS: Record<string, string> = { INSERT: 'Inclusão', UPDATE: 'Alteração', DELETE: 'Exclusão' };
const OCULTOS = new Set(['tenant_id', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por']);

function resumo(a: any) {
  if (!a.antes) return Object.entries(a.depois ?? {}).filter(([k, v]) => !OCULTOS.has(k) && k !== 'id' && v !== null).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  if (!a.depois) return 'registro removido';
  return Object.keys(a.depois).filter((k) => !OCULTOS.has(k) && JSON.stringify(a.antes[k]) !== JSON.stringify(a.depois[k]))
    .map((k) => `${k}: ${JSON.stringify(a.antes[k])} → ${JSON.stringify(a.depois[k])}`).join(' · ');
}

export function Auditoria() {
  const s = useSessao();
  const [tabela, setTabela] = useState('');
  const [pagina, setPagina] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['auditoria', s.empresaId, tabela, pagina],
    queryFn: () => api.get(`/auditoria${qs({ empresaId: s.empresaId, tabela, pagina, limite: 100 })}`),
  });
  return (
    <>
      <Titulo titulo="Auditoria" subtitulo="Registro permanente de todas as inclusões, alterações e exclusões. Não pode ser editado." />
      <div className="mb-3 flex gap-2">
        <select className="campo max-w-xs" value={tabela} onChange={(e) => { setTabela(e.target.value); setPagina(1); }}>
          <option value="">Todos os registros</option>
          {Object.entries(TABELAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="cartao overflow-x-auto">
        {isLoading ? <Carregando /> : !data?.length ? <Vazio>Nenhum registro.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Usuário</th><th>Registro</th><th>Operação</th><th>Empresa</th><th>Detalhes</th></tr></thead>
            <tbody>
              {data.map((a: any) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap tabular-nums">{dataHoraBr(a.em)}</td>
                  <td>{a.usuario ?? 'sistema'}</td>
                  <td>{TABELAS[a.tabela] ?? a.tabela}</td>
                  <td>{OPS[a.operacao] ?? a.operacao}{a.contexto && <div className="text-xs text-slate-400">{a.contexto}</div>}</td>
                  <td>{a.empresa ?? '—'}</td>
                  <td className="max-w-xl break-words text-xs text-slate-600">{resumo(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2 text-sm">
        <button className="btn-secundario" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
        <button className="btn-secundario" disabled={(data?.length ?? 0) < 100} onClick={() => setPagina(pagina + 1)}>Próxima</button>
      </div>
    </>
  );
}
