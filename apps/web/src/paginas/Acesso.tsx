import { ShieldCheck } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { api, ErroApi } from '../lib/api';
import { Aviso, Campo } from '../componentes/ui';

function Moldura({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-50 to-slate-100 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="text-marca-600" size={28} />
          <div>
            <div className="text-lg font-semibold">Controle SST</div>
            <div className="text-xs text-slate-500">{titulo}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfiguracaoInicial({ aoConcluir }: { aoConcluir: () => void }) {
  const [d, setD] = useState({ organizacao: '', nome: '', email: '', senha: '', confirma: '' });
  const [erro, setErro] = useState<unknown>();
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    setCampos({});
    if (d.senha !== d.confirma) return setCampos({ confirma: 'As senhas não conferem' });
    setEnviando(true);
    try {
      await api.post('/auth/configuracao-inicial', { organizacao: d.organizacao, nome: d.nome, email: d.email, senha: d.senha });
      await api.post('/auth/login', { email: d.email, senha: d.senha });
      aoConcluir();
    } catch (x) {
      setErro(x);
      if (x instanceof ErroApi) setCampos(x.campos);
    } finally {
      setEnviando(false);
    }
  };
  const set = (k: keyof typeof d) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Moldura titulo="Primeira configuração deste computador">
      <p className="mb-4 text-sm text-slate-600">
        Cadastre a sua organização e o primeiro administrador. Os dados ficam somente neste computador.
      </p>
      <Aviso erro={erro} />
      <form onSubmit={enviar} className="space-y-3">
        <Campo rotulo="Nome da organização (consultoria ou empresa)" erro={campos.organizacao} obrigatorio>
          <input className="campo" value={d.organizacao} onChange={set('organizacao')} required />
        </Campo>
        <Campo rotulo="Seu nome" erro={campos.nome} obrigatorio><input className="campo" value={d.nome} onChange={set('nome')} required /></Campo>
        <Campo rotulo="E-mail (usado para entrar)" erro={campos.email} obrigatorio>
          <input className="campo" type="email" value={d.email} onChange={set('email')} required />
        </Campo>
        <Campo rotulo="Senha (mínimo 10 caracteres, com letras e números)" erro={campos.senha} obrigatorio>
          <input className="campo" type="password" value={d.senha} onChange={set('senha')} required autoComplete="new-password" />
        </Campo>
        <Campo rotulo="Confirme a senha" erro={campos.confirma} obrigatorio>
          <input className="campo" type="password" value={d.confirma} onChange={set('confirma')} required autoComplete="new-password" />
        </Campo>
        <button className="btn-primario w-full justify-center" disabled={enviando}>Concluir configuração</button>
      </form>
    </Moldura>
  );
}

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pedeMfa, setPedeMfa] = useState(false);
  const [erro, setErro] = useState<unknown>();
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    setEnviando(true);
    try {
      await api.post('/auth/login', { email, senha, codigoMfa: pedeMfa ? codigo : undefined });
      aoEntrar();
    } catch (x) {
      if (x instanceof ErroApi && x.corpo?.mfa) setPedeMfa(true);
      setErro(x);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Moldura titulo="Entrar">
      <Aviso erro={erro} />
      <form onSubmit={enviar} className="space-y-3">
        <Campo rotulo="E-mail"><input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Campo>
        <Campo rotulo="Senha"><input className="campo" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" /></Campo>
        {pedeMfa && (
          <Campo rotulo="Código do aplicativo autenticador">
            <input className="campo" inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus />
          </Campo>
        )}
        <button className="btn-primario w-full justify-center" disabled={enviando}>Entrar</button>
      </form>
      <p className="mt-4 text-xs text-slate-500">Esqueceu a senha? Peça ao administrador do sistema para redefini-la.</p>
    </Moldura>
  );
}

export function TrocaObrigatoria({ aoConcluir }: { aoConcluir: () => void }) {
  return (
    <Moldura titulo="Defina uma nova senha">
      <p className="mb-4 text-sm text-slate-600">Sua senha é temporária. Defina uma senha pessoal para continuar.</p>
      <FormSenha aoConcluir={aoConcluir} />
    </Moldura>
  );
}

export function FormSenha({ aoConcluir }: { aoConcluir: () => void }) {
  const [d, setD] = useState({ atual: '', nova: '', confirma: '' });
  const [erro, setErro] = useState<unknown>();
  const [ok, setOk] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    if (d.nova !== d.confirma) return setErro(new Error('As senhas não conferem'));
    try {
      await api.post('/auth/senha', { atual: d.atual, nova: d.nova });
      setOk(true);
      setD({ atual: '', nova: '', confirma: '' });
      aoConcluir();
    } catch (x) {
      setErro(x instanceof ErroApi && x.corpo?.campos ? new Error(x.corpo.campos[0].mensagem) : x);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-3">
      <Aviso erro={erro} />
      {ok && <Aviso tipo="ok">Senha alterada. As outras sessões foram encerradas.</Aviso>}
      <Campo rotulo="Senha atual"><input className="campo" type="password" value={d.atual} onChange={(e) => setD({ ...d, atual: e.target.value })} required autoComplete="current-password" /></Campo>
      <Campo rotulo="Nova senha (mínimo 10 caracteres, com letras e números)"><input className="campo" type="password" value={d.nova} onChange={(e) => setD({ ...d, nova: e.target.value })} required autoComplete="new-password" /></Campo>
      <Campo rotulo="Confirme a nova senha"><input className="campo" type="password" value={d.confirma} onChange={(e) => setD({ ...d, confirma: e.target.value })} required autoComplete="new-password" /></Campo>
      <button className="btn-primario">Alterar senha</button>
    </form>
  );
}
