import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ErroApi } from '../lib/api';
import { dataHoraBr } from '../lib/formato';
import { Aviso, Campo, Carregando, Titulo, Vazio } from '../componentes/ui';

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function Backup() {
  const qc = useQueryClient();
  const est = useQuery({ queryKey: ['backup'], queryFn: () => api.get('/backup'), retry: false });
  const [senha, setSenha] = useState({ nova: '', confirma: '' });
  const [restSenha, setRestSenha] = useState('');
  const [erro, setErro] = useState<unknown>();
  const [ok, setOk] = useState<string>();
  const [ocupado, setOcupado] = useState(false);
  const executar = async (fn: () => Promise<string | undefined>) => {
    setErro(undefined); setOk(undefined); setOcupado(true);
    try { const m = await fn(); if (m) setOk(m); qc.invalidateQueries({ queryKey: ['backup'] }); }
    catch (x) { setErro(x instanceof ErroApi && x.corpo?.campos ? new Error(x.corpo.campos[0].mensagem) : x); }
    finally { setOcupado(false); }
  };
  if (est.isLoading) return <Carregando />;
  if (est.error instanceof ErroApi && est.error.status === 404)
    return <Aviso tipo="info">O backup é feito pelo aplicativo instalado no computador.</Aviso>;
  const d = est.data;
  return (
    <>
      <Titulo titulo="Backup e restauração" subtitulo="Cópia completa e criptografada dos dados deste computador" />
      <Aviso erro={erro} />
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="cartao space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Senha dos backups</h2>
          <p className="text-slate-600">
            Os backups são protegidos por esta senha. Guarde-a em lugar seguro: sem ela não é possível restaurar, inclusive em outro computador.
            {d?.senhaConfigurada ? ' Uma senha já está definida; definir outra vale para os próximos backups.' : ''}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Nova senha"><input className="campo" type="password" value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} autoComplete="new-password" /></Campo>
            <Campo rotulo="Confirme"><input className="campo" type="password" value={senha.confirma} onChange={(e) => setSenha({ ...senha, confirma: e.target.value })} autoComplete="new-password" /></Campo>
          </div>
          <button className="btn-primario" disabled={ocupado || !senha.nova} onClick={() => executar(async () => {
            if (senha.nova !== senha.confirma) throw new Error('As senhas não conferem');
            await api.post('/backup/senha', { senha: senha.nova });
            setSenha({ nova: '', confirma: '' });
            return 'Senha dos backups definida. A partir de agora um backup é feito sempre que o sistema é fechado.';
          })}>Definir senha</button>
        </div>
        <div className="cartao space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Fazer backup</h2>
          <p className="text-slate-600">O sistema fica indisponível por alguns segundos durante a cópia. Os 10 backups mais recentes ficam guardados neste computador; leve uma cópia para um pendrive ou HD externo.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primario" disabled={ocupado || !d?.senhaConfigurada} onClick={() => executar(async () => { await api.post('/backup/agora'); return 'Backup criado.'; })}>Fazer backup agora</button>
            <button className="btn-secundario" disabled={ocupado || !d?.backups.length} onClick={() => executar(async () => {
              const r = await api.post('/backup/exportacao');
              return r.arquivo ? `Cópia salva em ${r.arquivo}` : undefined;
            })}>Salvar cópia em…</button>
          </div>
        </div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Backups neste computador</h2>
      <div className="cartao overflow-x-auto">
        {!d?.backups.length ? <Vazio>Nenhum backup ainda.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Arquivo</th><th>Criado em</th><th className="text-right">Tamanho</th></tr></thead>
            <tbody>{d.backups.map((b: any) => <tr key={b.arquivo}><td>{b.arquivo}</td><td>{dataHoraBr(b.criadoEm)}</td><td className="text-right">{mb(b.bytes)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">Pasta: {d?.pasta}</p>
      <div className="cartao mt-6 space-y-3 border-red-200 p-5 text-sm">
        <h2 className="font-semibold text-red-800">Restaurar um backup</h2>
        <p className="text-slate-600">Substitui todos os dados atuais pelos do backup escolhido e reinicia o sistema. Os dados atuais ficam guardados numa pasta à parte, não são apagados.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Senha do backup"><input className="campo" type="password" value={restSenha} onChange={(e) => setRestSenha(e.target.value)} /></Campo>
          <button className="btn-perigo" disabled={ocupado || !restSenha} onClick={() => executar(async () => {
            const r = await api.post('/backup/restauracao', { senha: restSenha });
            return r.restaurado ? 'Backup restaurado. O sistema está reiniciando…' : undefined;
          })}>Escolher arquivo e restaurar</button>
        </div>
      </div>
    </>
  );
}
