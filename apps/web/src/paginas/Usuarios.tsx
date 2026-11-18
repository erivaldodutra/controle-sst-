import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { api, ErroApi } from '../lib/api';
import { dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo } from '../componentes/ui';

function FormUsuario({ inicial, aoSalvar }: { inicial?: any; aoSalvar: () => void }) {
  const s = useSessao();
  const perfis = useQuery({ queryKey: ['perfis'], queryFn: () => api.get('/perfis') });
  const [d, setD] = useState({ nome: inicial?.nome ?? '', email: inicial?.email ?? '', ativo: inicial?.ativo ?? true, senhaTemporaria: '' });
  const [atrib, setAtrib] = useState<{ perfil: string; empresaId: string | null }[]>(
    inicial?.atribuicoes?.map((a: any) => ({ perfil: a.perfil, empresaId: a.empresaId })) ?? [{ perfil: 'VISUALIZADOR', empresaId: s.empresaId }],
  );
  const [erro, setErro] = useState<unknown>();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    try {
      if (inicial) await api.put(`/usuarios/${inicial.id}`, { nome: d.nome, email: d.email, ativo: d.ativo, atribuicoes: atrib });
      else await api.post('/usuarios', { ...d, atribuicoes: atrib });
      aoSalvar();
    } catch (x) {
      setErro(x);
      if (x instanceof ErroApi) setCampos(x.campos);
    }
  };
  const global = s.podeGlobal('usuarios.gerenciar');
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Aviso erro={erro} />
      <Campo rotulo="Nome" erro={campos.nome} obrigatorio><input className="campo" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} required /></Campo>
      <Campo rotulo="E-mail" erro={campos.email} obrigatorio><input className="campo" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} required /></Campo>
      {!inicial && (
        <Campo rotulo="Senha temporária (a pessoa troca no primeiro acesso)" erro={campos.senhaTemporaria} obrigatorio>
          <input className="campo" value={d.senhaTemporaria} onChange={(e) => setD({ ...d, senhaTemporaria: e.target.value })} required autoComplete="off" />
        </Campo>
      )}
      <div>
        <div className="rotulo">Perfis e empresas</div>
        <div className="space-y-2">
          {atrib.map((a, i) => (
            <div key={i} className="flex gap-2">
              <select className="campo" value={a.perfil} onChange={(e) => setAtrib(atrib.map((x, j) => (j === i ? { ...x, perfil: e.target.value } : x)))}>
                {perfis.data?.map((p: any) => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
              </select>
              <select className="campo" value={a.empresaId ?? ''} onChange={(e) => setAtrib(atrib.map((x, j) => (j === i ? { ...x, empresaId: e.target.value || null } : x)))}>
                {global && <option value="">Todas as empresas</option>}
                {s.empresas.map((e) => <option key={e.id} value={e.id}>{e.nomeFantasia || e.razaoSocial}</option>)}
              </select>
              <button type="button" className="btn-secundario" aria-label="Remover" onClick={() => setAtrib(atrib.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm text-marca-700 hover:underline" onClick={() => setAtrib([...atrib, { perfil: 'VISUALIZADOR', empresaId: s.empresaId }])}>+ Adicionar perfil</button>
        {campos.atribuicoes && <div className="text-xs text-red-600">{campos.atribuicoes}</div>}
      </div>
      {inicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
      <button className="btn-primario">Salvar usuário</button>
    </form>
  );
}

function FormRedefinir({ u, aoSalvar }: { u: any; aoSalvar: () => void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<unknown>();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await api.post(`/usuarios/${u.id}/redefinicao-senha`, { senhaTemporaria: senha }); aoSalvar(); }
      catch (x) { setErro(x instanceof ErroApi && x.corpo?.campos ? new Error(x.corpo.campos[0].mensagem) : x); }
    }}>
      <p className="text-sm text-slate-600">A senha de {u.nome} será substituída por uma temporária, as sessões abertas serão encerradas e o autenticador será desligado.</p>
      <Aviso erro={erro} />
      <Campo rotulo="Senha temporária" obrigatorio><input className="campo" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="off" /></Campo>
      <button className="btn-primario">Redefinir senha</button>
    </form>
  );
}

export function Usuarios() {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get('/usuarios') });
  const perfis = useQuery({ queryKey: ['perfis'], queryFn: () => api.get('/perfis') });
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [senha, setSenha] = useState<any>(null);
  const nomePerfil = (c: string) => perfis.data?.find((p: any) => p.codigo === c)?.nome ?? c;
  const feito = () => { setEdit(undefined); setSenha(null); qc.invalidateQueries({ queryKey: ['usuarios'] }); };
  return (
    <>
      <Titulo titulo="Usuários e perfis" subtitulo="Quem acessa o sistema neste computador e o que pode fazer" acoes={<button className="btn-primario" onClick={() => setEdit(null)}><Plus size={16} /> Novo usuário</button>} />
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : (
          <table className="tabela">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfis</th><th>Último acesso</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.data?.map((u: any) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.nome}</td>
                  <td>{u.email}</td>
                  <td className="text-xs">{u.atribuicoes.map((a: any, i: number) => <div key={i}>{nomePerfil(a.perfil)} · {a.empresaNome ?? 'todas as empresas'}</div>)}</td>
                  <td className="tabular-nums">{dataHoraBr(u.ultimoAcessoEm)}</td>
                  <td className="space-x-1">
                    {!u.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}
                    {u.bloqueado && <Etiqueta cor="bg-red-100 text-red-700">Bloqueado</Etiqueta>}
                    {u.mfaAtivo && <Etiqueta cor="bg-marca-100 text-marca-700">2 fatores</Etiqueta>}
                  </td>
                  <td className="whitespace-nowrap text-right text-sm">
                    <button className="mr-3 text-marca-700 hover:underline" onClick={() => setEdit(u)}>Editar</button>
                    <button className="text-slate-600 hover:underline" onClick={() => setSenha(u)}>Redefinir senha</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Perfis</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {perfis.data?.map((p: any) => (
          <div key={p.codigo} className="cartao p-3 text-sm">
            <div className="font-medium">{p.nome}</div>
            <ul className="mt-1 text-xs text-slate-500">{p.permissoes.map((x: string) => <li key={x}>{x}</li>)}</ul>
          </div>
        ))}
      </div>
      <Modal titulo={edit ? 'Editar usuário' : 'Novo usuário'} aberto={edit !== undefined} aoFechar={() => setEdit(undefined)} largura="max-w-xl">
        {edit !== undefined && <FormUsuario key={edit?.id ?? 'novo'} inicial={edit ?? undefined} aoSalvar={feito} />}
      </Modal>
      <Modal titulo="Redefinir senha" aberto={!!senha} aoFechar={() => setSenha(null)} largura="max-w-md">
        {senha && <FormRedefinir u={senha} aoSalvar={feito} />}
      </Modal>
    </>
  );
}
