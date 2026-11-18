import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api, ErroApi, qs } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Etiqueta, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';

type Tipo = 'setores' | 'cargos' | 'funcoes' | 'ghes';
const ABAS: { tipo: Tipo; rotulo: string; singular: string }[] = [
  { tipo: 'setores', rotulo: 'Setores', singular: 'setor' },
  { tipo: 'funcoes', rotulo: 'Funções', singular: 'função' },
  { tipo: 'cargos', rotulo: 'Cargos', singular: 'cargo' },
  { tipo: 'ghes', rotulo: 'GHE', singular: 'GHE' },
];
const porEstab = (t: Tipo) => t === 'setores' || t === 'ghes';

export function useEstabelecimentos(empresaId: string | null) {
  return useQuery({
    queryKey: ['estabelecimentos', empresaId],
    queryFn: () => api.get(`/empresas/${empresaId}/estabelecimentos`),
    enabled: !!empresaId,
  });
}

export function useEstrutura(empresaId: string | null, tipo: Tipo, inativos = false) {
  return useQuery({
    queryKey: ['estrutura', empresaId, tipo, inativos],
    queryFn: () => api.get(`/empresas/${empresaId}/estrutura/${tipo}${qs({ inativos: inativos ? 1 : undefined })}`),
    enabled: !!empresaId,
  });
}

function Form({ tipo, empresaId, inicial, aoSalvar }: { tipo: Tipo; empresaId: string; inicial?: any; aoSalvar: () => void }) {
  const ests = useEstabelecimentos(empresaId);
  const [d, setD] = useState<any>({ ativo: true, ...(inicial ?? {}) });
  const [erro, setErro] = useState<unknown>();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    const corpo: any = { nome: d.nome, ativo: d.ativo };
    if (porEstab(tipo)) corpo.estabelecimentoId = d.estabelecimentoId;
    if (tipo === 'ghes') corpo.codigo = d.codigo;
    if (tipo === 'setores' || tipo === 'ghes' || tipo === 'cargos') corpo.descricao = d.descricao || null;
    if (tipo === 'cargos' || tipo === 'funcoes') corpo.cbo = d.cbo || null;
    if (tipo === 'funcoes') corpo.descricaoAtividades = d.descricaoAtividades || null;
    try {
      if (inicial) await api.put(`/estrutura/${tipo}/${inicial.id}`, corpo);
      else await api.post(`/empresas/${empresaId}/estrutura/${tipo}`, corpo);
      aoSalvar();
    } catch (x) {
      setErro(x);
      if (x instanceof ErroApi) setCampos(x.campos);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-3">
      <Aviso erro={erro} />
      {porEstab(tipo) && (
        <Campo rotulo="Estabelecimento" erro={campos.estabelecimentoId} obrigatorio>
          <select className="campo" value={d.estabelecimentoId ?? ''} onChange={set('estabelecimentoId')} required>
            <option value="" />
            {ests.data?.filter((x: any) => x.ativo).map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </Campo>
      )}
      {tipo === 'ghes' && (
        <Campo rotulo="Código do GHE" erro={campos.codigo} obrigatorio><input className="campo" value={d.codigo ?? ''} onChange={set('codigo')} required /></Campo>
      )}
      <Campo rotulo="Nome" erro={campos.nome} obrigatorio><input className="campo" value={d.nome ?? ''} onChange={set('nome')} required /></Campo>
      {(tipo === 'cargos' || tipo === 'funcoes') && (
        <Campo rotulo="CBO (6 dígitos)" erro={campos.cbo}><input className="campo" value={d.cbo ?? ''} onChange={set('cbo')} /></Campo>
      )}
      {tipo === 'funcoes' ? (
        <Campo rotulo="Descrição das atividades"><textarea className="campo" rows={5} value={d.descricaoAtividades ?? ''} onChange={set('descricaoAtividades')} /></Campo>
      ) : (
        <Campo rotulo="Descrição"><textarea className="campo" rows={3} value={d.descricao ?? ''} onChange={set('descricao')} /></Campo>
      )}
      {inicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
      <button className="btn-primario">Salvar</button>
    </form>
  );
}

export function Estrutura() {
  const s = useSessao();
  const qc = useQueryClient();
  const [aba, setAba] = useState<Tipo>('setores');
  const [inativos, setInativos] = useState(false);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const lista = useEstrutura(s.empresaId, aba, inativos);
  const def = ABAS.find((a) => a.tipo === aba)!;
  const podeEditar = s.pode('estrutura.editar');
  return (
    <>
      <Titulo
        titulo="Setores, funções e GHE"
        subtitulo="Estrutura da empresa usada nas lotações dos funcionários"
        acoes={podeEditar && s.empresaId && <button className="btn-primario" onClick={() => setEdit(null)}><Plus size={16} /> Novo {def.singular}</button>}
      />
      <ExigeEmpresa empresaId={s.empresaId}>
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200">
          {ABAS.map((a) => (
            <button key={a.tipo} onClick={() => setAba(a.tipo)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.tipo ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {a.rotulo}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 pb-1 text-sm text-slate-600">
            <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos
          </label>
        </div>
        <div className="cartao overflow-x-auto">
          {lista.isLoading ? <Carregando /> : !lista.data?.length ? <Vazio>Nenhum registro.</Vazio> : (
            <table className="tabela">
              <thead>
                <tr>
                  {aba === 'ghes' && <th>Código</th>}
                  <th>Nome</th>
                  {porEstab(aba) && <th>Estabelecimento</th>}
                  {(aba === 'cargos' || aba === 'funcoes') && <th>CBO</th>}
                  <th className="text-right">Lotados hoje</th><th />
                </tr>
              </thead>
              <tbody>
                {lista.data.map((x: any) => (
                  <tr key={x.id} className={podeEditar ? 'cursor-pointer' : ''} onClick={() => podeEditar && setEdit(x)}>
                    {aba === 'ghes' && <td className="font-medium">{x.codigo}</td>}
                    <td>{x.nome}</td>
                    {porEstab(aba) && <td>{x.estabelecimentoNome}</td>}
                    {(aba === 'cargos' || aba === 'funcoes') && <td className="tabular-nums">{x.cbo ?? '—'}</td>}
                    <td className="text-right tabular-nums">{x.totalLotados}</td>
                    <td>{!x.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {aba === 'ghes' && (
          <p className="mt-3 text-xs text-slate-500">Os riscos, agentes e medidas de controle de cada GHE serão vinculados ao PGR na fase de programas legais.</p>
        )}
      </ExigeEmpresa>
      <Modal titulo={edit ? `Editar ${def.singular}` : `Novo ${def.singular}`} aberto={edit !== undefined} aoFechar={() => setEdit(undefined)} largura="max-w-lg">
        {edit !== undefined && s.empresaId && (
          <Form key={edit?.id ?? 'novo'} tipo={aba} empresaId={s.empresaId} inicial={edit ?? undefined}
            aoSalvar={() => { setEdit(undefined); qc.invalidateQueries({ queryKey: ['estrutura', s.empresaId] }); }} />
        )}
      </Modal>
    </>
  );
}
