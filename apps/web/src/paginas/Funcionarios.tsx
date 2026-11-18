import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TIPOS_CONTRATO } from '@sst/shared';
import { api, ErroApi, qs } from '../lib/api';
import { cpf, dataBr, hojeIso, SITUACOES } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Posicao, posicaoVazia, SeletorPosicao } from '../componentes/Posicao';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo, Vazio } from '../componentes/ui';
import { useEstabelecimentos, useEstrutura } from './Estrutura';

export function FormAdmissao({ empresaId, aoSalvar }: { empresaId: string; aoSalvar: (r: { funcionarioId: string }) => void }) {
  const [p, setP] = useState({ nome: '', cpf: '', dataNascimento: '', sexo: '', email: '', telefone: '' });
  const [v, setV] = useState({ matricula: '', dataAdmissao: '', categoria: '', tipoContrato: '', jornada: '' });
  const [pos, setPos] = useState<Posicao>(posicaoVazia);
  const [erro, setErro] = useState<unknown>();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    setCampos({});
    try {
      const r = await api.post(`/empresas/${empresaId}/funcionarios`, {
        pessoa: { ...p, dataNascimento: p.dataNascimento || null, sexo: p.sexo || null, email: p.email || null, telefone: p.telefone || null },
        matricula: v.matricula, dataAdmissao: v.dataAdmissao, categoria: v.categoria || null,
        tipoContrato: v.tipoContrato ? Number(v.tipoContrato) : null, jornada: v.jornada || null, posicao: pos,
      });
      aoSalvar(r);
    } catch (x) {
      setErro(x);
      if (x instanceof ErroApi) setCampos(x.campos);
    }
  };
  const sp = (k: keyof typeof p) => (e: any) => setP({ ...p, [k]: e.target.value });
  const sv = (k: keyof typeof v) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <form onSubmit={enviar} className="space-y-5">
      <Aviso erro={erro} />
      <section className="grid grid-cols-6 gap-3">
        <h3 className="col-span-6 text-sm font-semibold">Dados pessoais</h3>
        <Campo rotulo="Nome completo" className="col-span-6" erro={campos['pessoa.nome']} obrigatorio><input className="campo" value={p.nome} onChange={sp('nome')} required /></Campo>
        <Campo rotulo="CPF" className="col-span-3" erro={campos['pessoa.cpf']} obrigatorio><input className="campo" value={p.cpf} onChange={sp('cpf')} required /></Campo>
        <Campo rotulo="Data de nascimento" className="col-span-2" erro={campos['pessoa.dataNascimento']}><input className="campo" type="date" value={p.dataNascimento} onChange={sp('dataNascimento')} /></Campo>
        <Campo rotulo="Sexo" className="col-span-1"><select className="campo" value={p.sexo} onChange={sp('sexo')}><option value="" /><option value="F">F</option><option value="M">M</option></select></Campo>
        <Campo rotulo="E-mail" className="col-span-3" erro={campos['pessoa.email']}><input className="campo" value={p.email} onChange={sp('email')} /></Campo>
        <Campo rotulo="Telefone" className="col-span-3"><input className="campo" value={p.telefone} onChange={sp('telefone')} /></Campo>
      </section>
      <section className="grid grid-cols-6 gap-3">
        <h3 className="col-span-6 text-sm font-semibold">Vínculo</h3>
        <Campo rotulo="Matrícula" className="col-span-2" erro={campos.matricula} obrigatorio><input className="campo" value={v.matricula} onChange={sv('matricula')} required /></Campo>
        <Campo rotulo="Data de admissão" className="col-span-2" erro={campos.dataAdmissao} obrigatorio><input className="campo" type="date" value={v.dataAdmissao} onChange={sv('dataAdmissao')} required /></Campo>
        <Campo rotulo="Categoria eSocial" className="col-span-2" erro={campos.categoria}><input className="campo" placeholder="ex.: 101" value={v.categoria} onChange={sv('categoria')} /></Campo>
        <Campo rotulo="Tipo de contrato" className="col-span-3">
          <select className="campo" value={v.tipoContrato} onChange={sv('tipoContrato')}>
            <option value="" />
            {Object.entries(TIPOS_CONTRATO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Jornada" className="col-span-3"><input className="campo" placeholder="ex.: 44h semanais, 08h–17h" value={v.jornada} onChange={sv('jornada')} /></Campo>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Lotação inicial</h3>
        <SeletorPosicao empresaId={empresaId} valor={pos} onChange={setPos} erros={campos} />
      </section>
      <button className="btn-primario">Admitir funcionário</button>
    </form>
  );
}

function FormLote({ empresaId, vinculoIds, aoSalvar }: { empresaId: string; vinculoIds: string[]; aoSalvar: () => void }) {
  const [inicio, setInicio] = useState(hojeIso());
  const [motivo, setMotivo] = useState('');
  const [pos, setPos] = useState<Posicao>(posicaoVazia);
  const [erro, setErro] = useState<unknown>();
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    try {
      await api.post('/vinculos/movimentacao-em-lote', { vinculoIds, inicio, motivo, posicao: pos });
      aoSalvar();
    } catch (x) {
      setErro(x);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Aviso tipo="info">A nova lotação vale para os {vinculoIds.length} funcionários selecionados. Se algum não puder ser movimentado, nenhum será.</Aviso>
      <Aviso erro={erro} />
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="A partir de" obrigatorio><input className="campo" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required /></Campo>
        <Campo rotulo="Motivo" obrigatorio><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required /></Campo>
      </div>
      <SeletorPosicao empresaId={empresaId} valor={pos} onChange={setPos} />
      <button className="btn-primario">Aplicar movimentação</button>
    </form>
  );
}

export function Funcionarios() {
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(params.entries());
  const [busca, setBusca] = useState(f.busca ?? '');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [admitindo, setAdmitindo] = useState(false);
  const [lote, setLote] = useState(false);
  const pagina = Number(f.pagina) || 1;
  const filtro = { empresaId: s.empresaId, situacao: f.situacao, estabelecimentoId: f.estabelecimentoId, setorId: f.setorId, funcaoId: f.funcaoId, gheId: f.gheId, busca: f.busca, pagina, limite: 50 };
  const { data, isLoading } = useQuery({ queryKey: ['funcionarios', filtro], queryFn: () => api.get(`/funcionarios${qs(filtro)}`) });
  const ests = useEstabelecimentos(s.empresaId);
  const setores = useEstrutura(s.empresaId, 'setores');
  const funcoes = useEstrutura(s.empresaId, 'funcoes');
  const ghes = useEstrutura(s.empresaId, 'ghes');
  const setF = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    n.delete('pagina');
    setParams(n);
    setSelecionados([]);
  };
  const podeEditar = s.pode('funcionarios.editar');
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.limite)) : 1;
  return (
    <>
      <Titulo
        titulo="Funcionários"
        subtitulo={data ? `${data.total.toLocaleString('pt-BR')} vínculo(s)` : undefined}
        acoes={podeEditar && (
          <>
            {selecionados.length > 0 && s.empresaId && <button className="btn-secundario" onClick={() => setLote(true)}><ArrowRightLeft size={15} /> Movimentar {selecionados.length}</button>}
            <button className="btn-primario" disabled={!s.empresaId} title={!s.empresaId ? 'Escolha uma empresa no topo' : ''} onClick={() => setAdmitindo(true)}><Plus size={16} /> Admitir</button>
          </>
        )}
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <form className="lg:col-span-2" onSubmit={(e) => { e.preventDefault(); setF('busca', busca); }}>
          <input className="campo" placeholder="Nome, CPF ou matrícula (Enter)" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </form>
        <select className="campo" value={f.situacao ?? ''} onChange={(e) => setF('situacao', e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(SITUACOES).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
        </select>
        {s.empresaId && (
          <>
            <select className="campo" value={f.estabelecimentoId ?? ''} onChange={(e) => setF('estabelecimentoId', e.target.value)}>
              <option value="">Todos os estabelecimentos</option>
              {ests.data?.map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            <select className="campo" value={f.setorId ?? ''} onChange={(e) => setF('setorId', e.target.value)}>
              <option value="">Todos os setores</option>
              {setores.data?.filter((x: any) => !f.estabelecimentoId || x.estabelecimentoId === f.estabelecimentoId).map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            <select className="campo" value={f.funcaoId ?? ''} onChange={(e) => setF('funcaoId', e.target.value)}>
              <option value="">Todas as funções</option>
              {funcoes.data?.map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            <select className="campo" value={f.gheId ?? ''} onChange={(e) => setF('gheId', e.target.value)}>
              <option value="">Todos os GHE</option>
              {ghes.data?.map((x: any) => <option key={x.id} value={x.id}>{x.codigo}</option>)}
            </select>
          </>
        )}
      </div>
      <div className="cartao overflow-x-auto">
        {isLoading ? <Carregando /> : !data?.itens.length ? <Vazio>Nenhum funcionário encontrado.</Vazio> : (
          <table className="tabela">
            <thead>
              <tr>
                {podeEditar && s.empresaId && (
                  <th className="w-8"><input type="checkbox" aria-label="Selecionar todos"
                    checked={selecionados.length > 0 && selecionados.length === data.itens.filter((i: any) => i.situacao !== 'desligado').length}
                    onChange={(e) => setSelecionados(e.target.checked ? data.itens.filter((i: any) => i.situacao !== 'desligado').map((i: any) => i.vinculoId) : [])} /></th>
                )}
                <th>Nome</th><th>CPF</th><th>Matrícula</th><th>Admissão</th>
                {!s.empresaId && <th>Empresa</th>}
                <th>Setor</th><th>Função</th><th>GHE</th><th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.itens.map((i: any) => (
                <tr key={i.vinculoId} className="cursor-pointer" onClick={() => nav(`/funcionarios/${i.funcionarioId}`)}>
                  {podeEditar && s.empresaId && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {i.situacao !== 'desligado' && (
                        <input type="checkbox" checked={selecionados.includes(i.vinculoId)}
                          onChange={(e) => setSelecionados(e.target.checked ? [...selecionados, i.vinculoId] : selecionados.filter((x) => x !== i.vinculoId))} />
                      )}
                    </td>
                  )}
                  <td className="font-medium">{i.nome}</td>
                  <td className="tabular-nums">{cpf(i.cpf)}</td>
                  <td>{i.matricula}</td>
                  <td className="tabular-nums">{dataBr(i.dataAdmissao)}</td>
                  {!s.empresaId && <td>{s.empresas.find((e) => e.id === i.empresaId)?.razaoSocial}</td>}
                  <td>{i.setor ?? '—'}</td>
                  <td>{i.funcao ?? '—'}</td>
                  <td>{i.ghe ?? '—'}</td>
                  <td><Etiqueta cor={SITUACOES[i.situacao]?.cor ?? ''}>{SITUACOES[i.situacao]?.rotulo ?? i.situacao}</Etiqueta></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && totalPaginas > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-secundario" disabled={pagina <= 1} onClick={() => setF('pagina', String(pagina - 1))}>Anterior</button>
          <span>Página {pagina} de {totalPaginas}</span>
          <button className="btn-secundario" disabled={pagina >= totalPaginas} onClick={() => { const n = new URLSearchParams(params); n.set('pagina', String(pagina + 1)); setParams(n); }}>Próxima</button>
        </div>
      )}
      {s.pode('funcionarios.importar') && (
        <p className="mt-4 text-xs text-slate-500">Para cadastrar muitos funcionários de uma vez, use <Link className="underline" to="/importacoes">Importar planilha</Link>.</p>
      )}
      <Modal titulo="Admitir funcionário" aberto={admitindo} aoFechar={() => setAdmitindo(false)}>
        {admitindo && s.empresaId && (
          <FormAdmissao empresaId={s.empresaId} aoSalvar={(r) => { setAdmitindo(false); qc.invalidateQueries({ queryKey: ['funcionarios'] }); nav(`/funcionarios/${r.funcionarioId}`); }} />
        )}
      </Modal>
      <Modal titulo="Movimentação em lote" aberto={lote} aoFechar={() => setLote(false)}>
        {lote && s.empresaId && (
          <FormLote empresaId={s.empresaId} vinculoIds={selecionados} aoSalvar={() => { setLote(false); setSelecionados([]); qc.invalidateQueries({ queryKey: ['funcionarios'] }); }} />
        )}
      </Modal>
    </>
  );
}
