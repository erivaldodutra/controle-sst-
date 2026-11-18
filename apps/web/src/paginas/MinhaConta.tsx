import QRCode from 'qrcode';
import { useState } from 'react';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { FormSenha } from './Acesso';
import { Aviso, Campo, Titulo } from '../componentes/ui';

function Autenticador() {
  const [etapa, setEtapa] = useState<'inicio' | 'qr' | 'ok'>('inicio');
  const [qr, setQr] = useState<{ img: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<unknown>();
  const [msg, setMsg] = useState<string>();
  const iniciar = async () => {
    setErro(undefined);
    try {
      const r = await api.post('/auth/mfa/iniciar');
      setQr({ img: await QRCode.toDataURL(r.uri, { margin: 1, width: 200 }), segredo: r.segredo });
      setEtapa('qr');
    } catch (x) { setErro(x); }
  };
  const confirmar = async () => {
    setErro(undefined);
    try { await api.post('/auth/mfa/confirmar', { codigo }); setEtapa('ok'); setMsg('Autenticador ativado. Ele será pedido em cada login.'); }
    catch (x) { setErro(x); }
  };
  const desativar = async () => {
    setErro(undefined);
    try { await api.post('/auth/mfa/desativar', { senha }); setMsg('Autenticador desativado.'); setSenha(''); }
    catch (x) { setErro(x); }
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar) para exigir um código além da senha.</p>
      <Aviso erro={erro} />
      {msg && <Aviso tipo="ok">{msg}</Aviso>}
      {etapa === 'inicio' && <button className="btn-primario" onClick={iniciar}>Configurar autenticador</button>}
      {etapa === 'qr' && qr && (
        <div className="space-y-3">
          <img src={qr.img} alt="QR code do autenticador" className="rounded border border-slate-200" />
          <p className="text-xs text-slate-500">Sem câmera? Digite a chave: <code className="select-all">{qr.segredo}</code></p>
          <Campo rotulo="Código de 6 dígitos mostrado no aplicativo"><input className="campo max-w-40" inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)} /></Campo>
          <button className="btn-primario" onClick={confirmar}>Ativar</button>
        </div>
      )}
      <details className="pt-2">
        <summary className="cursor-pointer text-slate-500">Desativar autenticador</summary>
        <div className="mt-2 flex gap-2">
          <input className="campo max-w-60" type="password" placeholder="Sua senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
          <button className="btn-secundario" onClick={desativar}>Desativar</button>
        </div>
      </details>
    </div>
  );
}

export function MinhaConta() {
  const s = useSessao();
  return (
    <>
      <Titulo titulo="Minha conta" subtitulo={`${s.eu.nome} · ${s.eu.email}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="cartao p-5"><h2 className="mb-3 font-semibold">Alterar senha</h2><FormSenha aoConcluir={() => {}} /></div>
        <div className="cartao p-5"><h2 className="mb-3 font-semibold">Verificação em duas etapas</h2><Autenticador /></div>
      </div>
    </>
  );
}
