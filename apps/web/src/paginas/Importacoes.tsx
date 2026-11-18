import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { cpf, dataBr, dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Aviso, Etiqueta, ExigeEmpresa, Titulo, Vazio } from '../componentes/ui';

const SIT: Record<string, [string, string]> = {
  pre_visualizada: ['Aguardando confirmação', 'bg-amber-100 text-amber-800'],
  confirmada: ['Gravada', 'bg-emerald-100 text-emerald-800'],
  descartada: ['Descartada', 'bg-slate-200 text-slate-700'],
};

export function Importacoes() {
  const s = useSessao();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<any>(null);
  const [erro, setErro] = useState<unknown>();
  const [ok, setOk] = useState<string>();
  const [ocupado, setOcupado] = useState(false);
  const hist = useQuery({ queryKey: ['importacoes', s.empresaId], queryFn: () => api.get(`/empresas/${s.empresaId}/importacoes`), enabled: !!s.empresaId });

  const enviar = async (arquivo: File) => {
    setErro(undefined); setOk(undefined); setPrevia(null); setOcupado(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      setPrevia(await api.post(`/empresas/${s.empresaId}/importacoes/funcionarios`, fd));
      qc.invalidateQueries({ queryKey: ['importacoes'] });
    } catch (x) { setErro(x); } finally {
      setOcupado(false);
      if (input.current) input.current.value = '';
    }
  };
  const confirmar = async () => {
    setErro(undefined); setOcupado(true);
    try {
      const r = await api.post(`/importacoes/${previa.id}/confirmacao`);
      setOk(`${r.gravados} funcionário(s) gravado(s).`);
      setPrevia(null);
      qc.invalidateQueries({ queryKey: ['importacoes'] });
      qc.invalidateQueries({ queryKey: ['funcionarios'] });
    } catch (x) { setErro(x); } finally { setOcupado(false); }
  };
  const descartar = async () => {
    await api.delete(`/importacoes/${previa.id}`).catch(() => {});
    setPrevia(null);
    qc.invalidateQueries({ queryKey: ['importacoes'] });
  };

  return (
    <>
      <Titulo titulo="Importar funcionários" subtitulo="Planilha Excel com prévia e confirmação antes de gravar" />
      <ExigeEmpresa empresaId={s.empresaId}>
        <div className="cartao mb-4 p-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            <li>Baixe o modelo e preencha uma linha por funcionário.</li>
            <li>Cadastre antes os estabelecimentos, setores, funções, cargos e GHE usados na planilha (<Link className="underline" to="/estrutura">Estrutura</Link>).</li>
            <li>Envie a planilha. O sistema mostra os erros de cada linha e não grava nada até você confirmar.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn-secundario" href="/api/importacoes/funcionarios/modelo"><Download size={15} /> Baixar modelo</a>
            <button className="btn-primario" disabled={ocupado} onClick={() => input.current?.click()}><Upload size={15} /> Enviar planilha</button>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && enviar(e.target.files[0])} />
          </div>
        </div>
        <Aviso erro={erro} />
        {ok && <Aviso tipo="ok">{ok}</Aviso>}
        {previa && (
          <div className="cartao mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="text-sm">
                <b>{previa.totalLinhas}</b> linha(s) lida(s): <b className="text-emerald-700">{previa.linhasValidas} válida(s)</b>, <b className="text-red-700">{previa.erros.length} com erro</b>
              </div>
              <div className="flex gap-2">
                <button className="btn-secundario" onClick={descartar}>Descartar</button>
                <button className="btn-primario" disabled={ocupado || previa.linhasValidas === 0} onClick={confirmar}>Gravar {previa.linhasValidas} válida(s)</button>
              </div>
            </div>
            {previa.erros.length > 0 && (
              <div className="max-h-80 overflow-y-auto">
                <table className="tabela">
                  <thead><tr><th className="w-20">Linha</th><th>Problemas</th></tr></thead>
                  <tbody>{previa.erros.map((e: any) => <tr key={e.linha}><td>{e.linha}</td><td className="text-red-700">{e.mensagens.join('; ')}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {previa.amostra.length > 0 && (
              <>
                <div className="px-4 pt-3 text-xs font-semibold uppercase text-slate-500">Linhas válidas (primeiras 20)</div>
                <table className="tabela">
                  <thead><tr><th>Linha</th><th>Nome</th><th>CPF</th><th>Matrícula</th><th>Admissão</th></tr></thead>
                  <tbody>{previa.amostra.map((a: any) => <tr key={a.linha}><td>{a.linha}</td><td>{a.nome}</td><td>{cpf(a.cpf)}</td><td>{a.matricula}</td><td>{dataBr(a.dataAdmissao)}</td></tr>)}</tbody>
                </table>
              </>
            )}
          </div>
        )}
        <h2 className="mb-2 mt-6 font-semibold">Importações anteriores</h2>
        <div className="cartao overflow-x-auto">
          {!hist.data?.length ? <Vazio>Nenhuma importação.</Vazio> : (
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Arquivo</th><th>Usuário</th><th className="text-right">Linhas</th><th className="text-right">Válidas</th><th className="text-right">Com erro</th><th>Situação</th></tr></thead>
              <tbody>
                {hist.data.map((h: any) => (
                  <tr key={h.id}>
                    <td className="tabular-nums">{dataHoraBr(h.criadoEm)}</td><td>{h.arquivoNome}</td><td>{h.usuario}</td>
                    <td className="text-right">{h.totalLinhas}</td><td className="text-right">{h.linhasValidas}</td><td className="text-right">{h.linhasComErro}</td>
                    <td><Etiqueta cor={SIT[h.situacao]?.[1] ?? ''}>{SIT[h.situacao]?.[0]}</Etiqueta></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </ExigeEmpresa>
    </>
  );
}
