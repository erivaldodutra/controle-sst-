import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ErroApi, qs } from '../lib/api';
import { dataHoraBr, inscricao } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo, Vazio } from '../componentes/ui';

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

function camposEndereco(end: any, set: (e: any) => void) {
  const f = (k: string) => (ev: any) => set({ ...end, [k]: ev.target.value });
  return (
    <div className="grid grid-cols-6 gap-3">
      <Campo rotulo="CEP" className="col-span-2"><input className="campo" value={end.cep ?? ''} onChange={f('cep')} /></Campo>
      <Campo rotulo="Logradouro" className="col-span-4"><input className="campo" value={end.logradouro ?? ''} onChange={f('logradouro')} /></Campo>
      <Campo rotulo="Número" className="col-span-2"><input className="campo" value={end.numero ?? ''} onChange={f('numero')} /></Campo>
      <Campo rotulo="Complemento" className="col-span-4"><input className="campo" value={end.complemento ?? ''} onChange={f('complemento')} /></Campo>
      <Campo rotulo="Bairro" className="col-span-2"><input className="campo" value={end.bairro ?? ''} onChange={f('bairro')} /></Campo>
      <Campo rotulo="Município" className="col-span-3"><input className="campo" value={end.municipio ?? ''} onChange={f('municipio')} /></Campo>
      <Campo rotulo="UF" className="col-span-1">
        <select className="campo" value={end.uf ?? ''} onChange={f('uf')}>
          <option value="" />
          {UFS.map((u) => <option key={u}>{u}</option>)}
        </select>
      </Campo>
    </div>
  );
}

const vazioParaNull = (o: Record<string, any>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

export function FormEmpresa({ inicial, aoSalvar }: { inicial?: any; aoSalvar: (e: any) => void }) {
  const [d, setD] = useState<any>(() => ({
    tipoInscricao: 1, inscricao: '', razaoSocial: '', nomeFantasia: '', cnaePrincipal: '', cnaesSecundarios: '',
    grauRisco: '', naturezaJuridica: '', classificacaoTributaria: '', responsavelNome: '', responsavelCpf: '',
    responsavelEmail: '', responsavelTelefone: '', contatoEmail: '', contatoTelefone: '', observacoes: '',
    ...(inicial ? { ...inicial, cnaesSecundarios: (inicial.cnaesSecundarios ?? []).join(', '), grauRisco: inicial.grauRisco ?? '' } : {}),
    endereco: inicial?.endereco ?? {},
  }));
  const [erro, setErro] = useState<unknown>();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    setCampos({});
    const corpo = {
      ...vazioParaNull(d),
      tipoInscricao: Number(d.tipoInscricao),
      inscricao: d.inscricao,
      grauRisco: d.grauRisco ? Number(d.grauRisco) : null,
      cnaesSecundarios: String(d.cnaesSecundarios || '').split(/[,;\s]+/).filter(Boolean),
      endereco: vazioParaNull(d.endereco),
    };
    delete (corpo as any).id;
    try {
      aoSalvar(inicial ? await api.put(`/empresas/${inicial.id}`, corpo) : await api.post('/empresas', corpo));
    } catch (x) {
      setErro(x);
      if (x instanceof ErroApi) setCampos(x.campos);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-5">
      <Aviso erro={erro} />
      <section className="grid grid-cols-6 gap-3">
        <Campo rotulo="Tipo de inscrição" className="col-span-2" obrigatorio>
          <select className="campo" value={d.tipoInscricao} onChange={set('tipoInscricao')}>
            <option value={1}>CNPJ</option>
            <option value={2}>CPF</option>
          </select>
        </Campo>
        <Campo rotulo={Number(d.tipoInscricao) === 1 ? 'CNPJ' : 'CPF'} className="col-span-4" erro={campos.inscricao} obrigatorio>
          <input className="campo" value={d.inscricao} onChange={set('inscricao')} required />
        </Campo>
        <Campo rotulo="Razão social" className="col-span-6" erro={campos.razaoSocial} obrigatorio>
          <input className="campo" value={d.razaoSocial} onChange={set('razaoSocial')} required />
        </Campo>
        <Campo rotulo="Nome fantasia" className="col-span-6"><input className="campo" value={d.nomeFantasia ?? ''} onChange={set('nomeFantasia')} /></Campo>
        <Campo rotulo="CNAE principal (7 dígitos)" className="col-span-2" erro={campos.cnaePrincipal}>
          <input className="campo" value={d.cnaePrincipal ?? ''} onChange={set('cnaePrincipal')} />
        </Campo>
        <Campo rotulo="CNAEs secundários (separados por vírgula)" className="col-span-4" erro={campos['cnaesSecundarios.0']}>
          <input className="campo" value={d.cnaesSecundarios} onChange={set('cnaesSecundarios')} />
        </Campo>
        <Campo rotulo="Grau de risco (NR-04)" className="col-span-2">
          <select className="campo" value={d.grauRisco} onChange={set('grauRisco')}>
            <option value="">—</option>
            {[1, 2, 3, 4].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Natureza jurídica (4 dígitos)" className="col-span-2" erro={campos.naturezaJuridica}>
          <input className="campo" value={d.naturezaJuridica ?? ''} onChange={set('naturezaJuridica')} />
        </Campo>
        <Campo rotulo="Classificação tributária (eSocial)" className="col-span-2" erro={campos.classificacaoTributaria}>
          <input className="campo" value={d.classificacaoTributaria ?? ''} onChange={set('classificacaoTributaria')} placeholder="ex.: 99" />
        </Campo>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Endereço</h3>
        {camposEndereco(d.endereco, (endereco) => setD({ ...d, endereco }))}
      </section>
      <section className="grid grid-cols-6 gap-3">
        <h3 className="col-span-6 text-sm font-semibold">Responsável legal e contato</h3>
        <Campo rotulo="Nome do responsável legal" className="col-span-4"><input className="campo" value={d.responsavelNome ?? ''} onChange={set('responsavelNome')} /></Campo>
        <Campo rotulo="CPF do responsável" className="col-span-2" erro={campos.responsavelCpf}><input className="campo" value={d.responsavelCpf ?? ''} onChange={set('responsavelCpf')} /></Campo>
        <Campo rotulo="E-mail do responsável" className="col-span-3" erro={campos.responsavelEmail}><input className="campo" value={d.responsavelEmail ?? ''} onChange={set('responsavelEmail')} /></Campo>
        <Campo rotulo="Telefone do responsável" className="col-span-3"><input className="campo" value={d.responsavelTelefone ?? ''} onChange={set('responsavelTelefone')} /></Campo>
        <Campo rotulo="E-mail de contato" className="col-span-3" erro={campos.contatoEmail}><input className="campo" value={d.contatoEmail ?? ''} onChange={set('contatoEmail')} /></Campo>
        <Campo rotulo="Telefone de contato" className="col-span-3"><input className="campo" value={d.contatoTelefone ?? ''} onChange={set('contatoTelefone')} /></Campo>
        <Campo rotulo="Observações" className="col-span-6"><textarea className="campo" rows={3} value={d.observacoes ?? ''} onChange={set('observacoes')} /></Campo>
      </section>
      <p className="text-xs text-slate-500">Certificado digital e configurações de transmissão do eSocial entram na fase do módulo eSocial.</p>
      <button className="btn-primario">Salvar empresa</button>
    </form>
  );
}

export function Empresas() {
  const s = useSessao();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState('');
  const [inativas, setInativas] = useState(false);
  const nova = params.get('nova') === '1';
  const { data, isLoading } = useQuery({
    queryKey: ['empresas', busca, inativas],
    queryFn: () => api.get(`/empresas${qs({ busca, inativas: inativas ? 1 : undefined })}`),
  });
  return (
    <>
      <Titulo
        titulo="Empresas"
        subtitulo="Empregadores atendidos e seus estabelecimentos"
        acoes={s.podeGlobal('empresas.editar') && (
          <button className="btn-primario" onClick={() => setParams({ nova: '1' })}><Plus size={16} /> Nova empresa</button>
        )}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="campo max-w-sm" placeholder="Filtrar por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={inativas} onChange={(e) => setInativas(e.target.checked)} /> Mostrar inativas
        </label>
      </div>
      <div className="cartao overflow-x-auto">
        {isLoading ? <Carregando /> : !data?.length ? <Vazio>Nenhuma empresa cadastrada.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Razão social</th><th>CNPJ/CPF</th><th>Grau de risco</th><th className="text-right">Estabelecimentos</th><th className="text-right">Funcionários ativos</th><th /></tr></thead>
            <tbody>
              {data.map((e: any) => (
                <tr key={e.id}>
                  <td>
                    <Link className="font-medium text-marca-700 hover:underline" to={`/empresas/${e.id}`}>{e.razaoSocial}</Link>
                    {e.nomeFantasia && <div className="text-xs text-slate-500">{e.nomeFantasia}</div>}
                  </td>
                  <td className="tabular-nums">{inscricao(e.tipoInscricao, e.inscricao)}</td>
                  <td>{e.grauRisco ?? '—'}</td>
                  <td className="text-right tabular-nums">{e.totalEstabelecimentos}</td>
                  <td className="text-right tabular-nums">{e.totalFuncionariosAtivos}</td>
                  <td>{!e.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativa</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal titulo="Nova empresa" aberto={nova} aoFechar={() => setParams({})}>
        <FormEmpresa
          aoSalvar={(e) => {
            qc.invalidateQueries({ queryKey: ['empresas'] });
            setParams({});
            s.setEmpresaId(e.id);
          }}
        />
      </Modal>
    </>
  );
}

function FormEstabelecimento({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial?: any; aoSalvar: () => void }) {
  const [d, setD] = useState<any>(() => ({
    tipoInscricao: 1, inscricao: '', nome: '', matriz: false, cnae: '', grauRisco: '', observacoes: '', ativo: true,
    ...(inicial ?? {}), endereco: inicial?.endereco ?? {}, grauRiscoTxt: undefined,
  }));
  const [erro, setErro] = useState<unknown>();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    const corpo = {
      tipoInscricao: Number(d.tipoInscricao), inscricao: d.inscricao, nome: d.nome, matriz: !!d.matriz,
      cnae: d.cnae || null, grauRisco: d.grauRisco ? Number(d.grauRisco) : null, observacoes: d.observacoes || null,
      endereco: vazioParaNull(d.endereco), ativo: d.ativo,
    };
    try {
      if (inicial) await api.put(`/estabelecimentos/${inicial.id}`, corpo);
      else await api.post(`/empresas/${empresaId}/estabelecimentos`, corpo);
      aoSalvar();
    } catch (x) {
      setErro(x);
      if (x instanceof ErroApi) setCampos(x.campos);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Aviso erro={erro} />
      <div className="grid grid-cols-6 gap-3">
        <Campo rotulo="Tipo de inscrição" className="col-span-2" obrigatorio>
          <select className="campo" value={d.tipoInscricao} onChange={set('tipoInscricao')}>
            <option value={1}>CNPJ</option><option value={3}>CAEPF</option><option value={4}>CNO</option>
          </select>
        </Campo>
        <Campo rotulo="Inscrição" className="col-span-4" erro={campos.inscricao} obrigatorio><input className="campo" value={d.inscricao} onChange={set('inscricao')} required /></Campo>
        <Campo rotulo="Nome do estabelecimento" className="col-span-6" erro={campos.nome} obrigatorio><input className="campo" value={d.nome} onChange={set('nome')} required /></Campo>
        <Campo rotulo="CNAE (7 dígitos)" className="col-span-2" erro={campos.cnae}><input className="campo" value={d.cnae ?? ''} onChange={set('cnae')} /></Campo>
        <Campo rotulo="Grau de risco" className="col-span-2">
          <select className="campo" value={d.grauRisco ?? ''} onChange={set('grauRisco')}>
            <option value="">—</option>{[1, 2, 3, 4].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Campo>
        <label className="col-span-2 flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={!!d.matriz} onChange={(e) => setD({ ...d, matriz: e.target.checked })} /> Matriz
        </label>
      </div>
      {camposEndereco(d.endereco, (endereco) => setD({ ...d, endereco }))}
      <Campo rotulo="Observações"><textarea className="campo" rows={2} value={d.observacoes ?? ''} onChange={set('observacoes')} /></Campo>
      {inicial && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>
      )}
      <button className="btn-primario">Salvar estabelecimento</button>
    </form>
  );
}

export function EmpresaDetalhe() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [estab, setEstab] = useState<any | null | undefined>(undefined);
  useEffect(() => {
    if (id && s.empresaId !== id) s.setEmpresaId(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const emp = useQuery({ queryKey: ['empresa', id], queryFn: () => api.get(`/empresas/${id}`) });
  const ests = useQuery({ queryKey: ['estabelecimentos', id], queryFn: () => api.get(`/empresas/${id}/estabelecimentos`) });
  const ativa = useMutation({
    mutationFn: (ativo: boolean) => api.patch(`/empresas/${id}/ativo`, { ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['empresa', id] }),
  });
  if (emp.isLoading) return <Carregando />;
  if (emp.isError) return <Aviso erro={emp.error} />;
  const e = emp.data;
  const podeEditar = s.pode('empresas.editar');
  const end = e.endereco ?? {};
  return (
    <>
      <Titulo
        titulo={e.razaoSocial}
        subtitulo={<>{inscricao(e.tipoInscricao, e.inscricao)} {!e.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativa</Etiqueta>}</>}
        acoes={podeEditar && (
          <>
            <button className="btn-secundario" onClick={() => ativa.mutate(!e.ativo)}>{e.ativo ? 'Inativar' : 'Reativar'}</button>
            <button className="btn-primario" onClick={() => setEditando(true)}>Editar</button>
          </>
        )}
      />
      <Aviso erro={ativa.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="cartao p-4 text-sm lg:col-span-1">
          <dl className="space-y-2">
            {[
              ['Nome fantasia', e.nomeFantasia],
              ['CNAE principal', e.cnaePrincipal],
              ['CNAEs secundários', e.cnaesSecundarios?.join(', ')],
              ['Grau de risco', e.grauRisco],
              ['Natureza jurídica', e.naturezaJuridica],
              ['Classificação tributária', e.classificacaoTributaria],
              ['Endereço', [end.logradouro, end.numero, end.complemento, end.bairro, end.municipio, end.uf].filter(Boolean).join(', ')],
              ['Responsável legal', e.responsavelNome],
              ['Contato', [e.contatoEmail, e.contatoTelefone].filter(Boolean).join(' · ')],
              ['Atualizado em', dataHoraBr(e.atualizadoEm)],
            ].map(([r, v]) => (
              <div key={r as string}><dt className="text-xs text-slate-500">{r}</dt><dd>{v || '—'}</dd></div>
            ))}
          </dl>
        </div>
        <div className="cartao lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Estabelecimentos</h2>
            {podeEditar && <button className="btn-secundario" onClick={() => setEstab(null)}><Plus size={15} /> Novo</button>}
          </div>
          {!ests.data?.length ? <Vazio>Nenhum estabelecimento. Cadastre ao menos um para lotar funcionários.</Vazio> : (
            <table className="tabela">
              <thead><tr><th>Nome</th><th>Inscrição</th><th>Grau</th><th /></tr></thead>
              <tbody>
                {ests.data.map((x: any) => (
                  <tr key={x.id} className={podeEditar ? 'cursor-pointer' : ''} onClick={() => podeEditar && setEstab(x)}>
                    <td>{x.nome} {x.matriz && <Etiqueta cor="bg-marca-100 text-marca-700">Matriz</Etiqueta>}</td>
                    <td className="tabular-nums">{inscricao(x.tipoInscricao, x.inscricao)}</td>
                    <td>{x.grauRisco ?? '—'}</td>
                    <td>{!x.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <Modal titulo="Editar empresa" aberto={editando} aoFechar={() => setEditando(false)}>
        <FormEmpresa inicial={e} aoSalvar={() => { setEditando(false); qc.invalidateQueries({ queryKey: ['empresa', id] }); qc.invalidateQueries({ queryKey: ['empresas'] }); }} />
      </Modal>
      <Modal titulo={estab ? 'Editar estabelecimento' : 'Novo estabelecimento'} aberto={estab !== undefined} aoFechar={() => setEstab(undefined)}>
        {estab !== undefined && (
          <FormEstabelecimento empresaId={id!} inicial={estab ?? undefined} aoSalvar={() => { setEstab(undefined); qc.invalidateQueries({ queryKey: ['estabelecimentos', id] }); }} />
        )}
      </Modal>
    </>
  );
}
