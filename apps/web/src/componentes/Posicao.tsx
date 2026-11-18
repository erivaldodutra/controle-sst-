import { Campo } from './ui';
import { useEstabelecimentos, useEstrutura } from '../paginas/Estrutura';

export interface Posicao {
  estabelecimentoId: string;
  setorId: string | null;
  cargoId: string | null;
  funcaoId: string | null;
  gheId: string | null;
}

export const posicaoVazia: Posicao = { estabelecimentoId: '', setorId: null, cargoId: null, funcaoId: null, gheId: null };

/** Seletores de estabelecimento, setor, GHE, função e cargo, filtrados pelo estabelecimento. */
export function SeletorPosicao({ empresaId, valor, onChange, erros = {} }: {
  empresaId: string; valor: Posicao; onChange: (p: Posicao) => void; erros?: Record<string, string>;
}) {
  const ests = useEstabelecimentos(empresaId);
  const setores = useEstrutura(empresaId, 'setores');
  const ghes = useEstrutura(empresaId, 'ghes');
  const funcoes = useEstrutura(empresaId, 'funcoes');
  const cargos = useEstrutura(empresaId, 'cargos');
  const set = (k: keyof Posicao) => (e: any) => onChange({ ...valor, [k]: e.target.value || null });
  const doEstab = (l?: any[]) => (l ?? []).filter((x) => x.estabelecimentoId === valor.estabelecimentoId);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Campo rotulo="Estabelecimento" className="col-span-2" erro={erros['posicao.estabelecimentoId']} obrigatorio>
        <select className="campo" value={valor.estabelecimentoId} required
          onChange={(e) => onChange({ ...valor, estabelecimentoId: e.target.value, setorId: null, gheId: null })}>
          <option value="" />
          {ests.data?.filter((x: any) => x.ativo).map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Setor">
        <select className="campo" value={valor.setorId ?? ''} onChange={set('setorId')} disabled={!valor.estabelecimentoId}>
          <option value="">—</option>
          {doEstab(setores.data).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="GHE">
        <select className="campo" value={valor.gheId ?? ''} onChange={set('gheId')} disabled={!valor.estabelecimentoId}>
          <option value="">—</option>
          {doEstab(ghes.data).map((x) => <option key={x.id} value={x.id}>{x.codigo} - {x.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Função">
        <select className="campo" value={valor.funcaoId ?? ''} onChange={set('funcaoId')}>
          <option value="">—</option>
          {funcoes.data?.map((x: any) => <option key={x.id} value={x.id}>{x.nome}{x.cbo ? ` (CBO ${x.cbo})` : ''}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Cargo">
        <select className="campo" value={valor.cargoId ?? ''} onChange={set('cargoId')}>
          <option value="">—</option>
          {cargos.data?.map((x: any) => <option key={x.id} value={x.id}>{x.nome}{x.cbo ? ` (CBO ${x.cbo})` : ''}</option>)}
        </select>
      </Campo>
    </div>
  );
}
