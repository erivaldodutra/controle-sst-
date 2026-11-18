import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ErroApi } from '../lib/api';
import { dataHoraBr } from '../lib/formato';
import { Aviso, Campo, Carregando, Titulo, Vazio } from '../componentes/ui';

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

interface Config { pasta: string | null; frequencia: 'desligado' | 'diario' | 'semanal'; aoSair: boolean; manter: number }

const FREQUENCIAS = { diario: 'Todo dia', semanal: 'Toda semana', desligado: 'Desligado' } as const;

function ConfigAutomatico({ d, executar, ocupado }: { d: any; executar: (fn: () => Promise<string | undefined>) => void; ocupado: boolean }) {
  const [c, setC] = useState<Config>(d.config);
  useEffect(() => setC(d.config), [d.config]);
  const mudou = JSON.stringify(c) !== JSON.stringify(d.config);
  return (
    <div className="cartao space-y-3 p-5 text-sm">
      <h2 className="font-semibold">Backup automático e pasta de destino</h2>
      <p className="text-slate-600">
        Para proteger de verdade contra perda do notebook ou defeito no disco, escolha uma pasta em outro disco: pendrive, HD externo ou pasta sincronizada com a nuvem.
        Se a pasta não estiver conectada na hora, o backup fica guardado junto dos dados e você é avisado aqui.
      </p>
      <Campo rotulo="Pasta dos backups">
        <div className="flex flex-wrap gap-2">
          <input className="campo min-w-0 flex-1" value={c.pasta ?? ''} placeholder={`Padrão: ${d.pastaPadrao}`}
            onChange={(e) => setC({ ...c, pasta: e.target.value || null })} />
          <button type="button" className="btn-secundario" disabled={ocupado} onClick={() => executar(async () => {
            const r = await api.post('/backup/escolha-de-pasta');
            if (r.pasta) setC((x) => ({ ...x, pasta: r.pasta }));
            return undefined;
          })}><FolderOpen size={16} /> Escolher pasta…</button>
          {c.pasta && <button type="button" className="btn-secundario" onClick={() => setC({ ...c, pasta: null })}>Usar a padrão</button>}
        </div>
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Fazer backup automático">
          <select className="campo" value={c.frequencia} onChange={(e) => setC({ ...c, frequencia: e.target.value as Config['frequencia'] })}>
            {Object.entries(FREQUENCIAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Quantos backups automáticos manter">
          <input className="campo" type="number" min={1} max={100} value={c.manter} onChange={(e) => setC({ ...c, manter: Number(e.target.value) || 1 })} />
        </Campo>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={c.aoSair} onChange={(e) => setC({ ...c, aoSair: e.target.checked })} />
        Também fazer backup ao fechar o sistema
      </label>
      <p className="text-xs text-slate-500">
        O automático roda enquanto o sistema estiver ligado no computador, quando passa um dia (ou uma semana) desde o último backup.
        {d.proximoAutomatico && <> Próximo previsto: {dataHoraBr(d.proximoAutomatico)}.</>}
        {!d.senhaConfigurada && ' Precisa da senha dos backups definida para funcionar.'}
      </p>
      <button className="btn-primario" disabled={ocupado || !mudou} onClick={() => executar(async () => {
        await api.post('/backup/configuracao', { ...c, pasta: c.pasta?.trim() || null });
        return 'Configuração de backup salva.';
      })}>Salvar configuração</button>
    </div>
  );
}

export function Backup() {
  const qc = useQueryClient();
  const est = useQuery({ queryKey: ['backup'], queryFn: () => api.get('/backup'), retry: false });
  const [senha, setSenha] = useState({ nova: '', confirma: '' });
  const [restSenha, setRestSenha] = useState('');
  const [restArquivo, setRestArquivo] = useState('');
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
  if (!d) return <Aviso erro={est.error} />;
  const restaurar = (caminho?: string) => executar(async () => {
    if (!window.confirm('Restaurar substitui todos os dados atuais pelos do backup e reinicia o sistema. Os dados atuais ficam guardados à parte. Continuar?')) return undefined;
    const r = await api.post('/backup/restauracao', { senha: restSenha, caminho });
    return r.restaurado ? 'Backup restaurado. O sistema está reiniciando; recarregue a página em alguns segundos.' : undefined;
  });
  return (
    <>
      <Titulo titulo="Backup e restauração" subtitulo={<>Cópia completa e criptografada dos dados. Dados do sistema em: <span className="font-mono text-slate-700">{d.pastaDados}</span></>} />
      <Aviso erro={erro} />
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {d.aviso && <Aviso tipo="erro">{d.aviso}</Aviso>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="cartao space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Senha dos backups</h2>
          <p className="text-slate-600">
            Os backups são protegidos por esta senha. Guarde-a em lugar seguro: sem ela não é possível restaurar, inclusive em outro computador.
            {d.senhaConfigurada ? ' Uma senha já está definida; definir outra vale para os próximos backups.' : ''}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Nova senha"><input className="campo" type="password" value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} autoComplete="new-password" /></Campo>
            <Campo rotulo="Confirme"><input className="campo" type="password" value={senha.confirma} onChange={(e) => setSenha({ ...senha, confirma: e.target.value })} autoComplete="new-password" /></Campo>
          </div>
          <button className="btn-primario" disabled={ocupado || !senha.nova} onClick={() => executar(async () => {
            if (senha.nova !== senha.confirma) throw new Error('As senhas não conferem');
            await api.post('/backup/senha', { senha: senha.nova });
            setSenha({ nova: '', confirma: '' });
            return 'Senha dos backups definida. Os backups automáticos passam a ser feitos conforme a configuração ao lado.';
          })}>Definir senha</button>
          <div className="border-t border-slate-200 pt-3">
            <h2 className="mb-2 font-semibold">Fazer backup agora</h2>
            <p className="mb-3 text-slate-600">O sistema fica indisponível por alguns segundos durante a cópia. Será gravado em <span className="font-mono">{d.pasta}</span>.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primario" disabled={ocupado || !d.senhaConfigurada} onClick={() => executar(async () => {
                const r = await api.post('/backup/agora');
                return `Backup criado: ${r.arquivo}`;
              })}>Fazer backup agora</button>
              <button className="btn-secundario" disabled={ocupado || !d.backups.length} onClick={() => executar(async () => {
                const r = await api.post('/backup/exportacao');
                return r.arquivo ? `Cópia salva em ${r.arquivo}` : undefined;
              })}>Salvar cópia do último em…</button>
            </div>
          </div>
        </div>
        <ConfigAutomatico d={d} executar={executar} ocupado={ocupado} />
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Backups</h2>
      <div className="cartao overflow-x-auto">
        {!d.backups.length ? <Vazio>Nenhum backup ainda.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Arquivo</th><th>Pasta</th><th>Criado em</th><th className="text-right">Tamanho</th></tr></thead>
            <tbody>{d.backups.map((b: any) => (
              <tr key={b.caminho}><td>{b.arquivo}</td><td className="text-xs text-slate-600">{b.pasta}</td><td>{dataHoraBr(b.criadoEm)}</td><td className="text-right">{mb(b.bytes)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="cartao mt-6 space-y-3 border-red-200 p-5 text-sm">
        <h2 className="font-semibold text-red-800">Restaurar um backup</h2>
        <p className="text-slate-600">Substitui todos os dados atuais pelos do backup escolhido e reinicia o sistema. Os dados atuais ficam guardados numa pasta à parte, não são apagados.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Backup">
            <select className="campo" value={restArquivo} onChange={(e) => setRestArquivo(e.target.value)}>
              <option value="">Escolher outro arquivo no computador…</option>
              {d.backups.map((b: any) => <option key={b.caminho} value={b.caminho}>{dataHoraBr(b.criadoEm)} · {b.arquivo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Senha do backup"><input className="campo" type="password" value={restSenha} onChange={(e) => setRestSenha(e.target.value)} /></Campo>
          <button className="btn-perigo" disabled={ocupado || !restSenha} onClick={() => restaurar(restArquivo || undefined)}>
            {restArquivo ? 'Restaurar este backup' : 'Escolher arquivo e restaurar'}
          </button>
        </div>
      </div>
    </>
  );
}
