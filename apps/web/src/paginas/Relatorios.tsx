import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { baixar } from '../componentes/esocial';
import { Aviso, Campo, Carregando, Titulo } from '../componentes/ui';

/** Relatórios que aceitam período (pela data do registro). */
const COM_PERIODO = ['acoes', 'ocorrencias', 'esocial', 'calendario'];

/** Central de relatórios: PDF e Excel gerados no próprio computador, com as mesmas permissões das telas. */
export function Relatorios() {
  const s = useSessao();
  const q = useQuery({ queryKey: ['relatorios'], queryFn: () => api.get('/relatorios') });
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [gerando, setGerando] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>();
  const empresa = s.empresas.find((e) => e.id === s.empresaId);
  const gerar = async (tipo: string, nome: string, formato: 'pdf' | 'xlsx') => {
    setErro(undefined);
    setGerando(`${tipo}-${formato}`);
    const periodo = COM_PERIODO.includes(tipo) ? { de, ate } : {};
    try {
      await baixar(`/relatorios/${tipo}${qs({ formato, empresaId: s.empresaId, ...periodo })}`, `${nome} ${hojeIso()}.${formato}`);
    } catch (x) { setErro(x); } finally { setGerando(null); }
  };
  return (
    <>
      <Titulo titulo="Central de relatórios"
        subtitulo="Os relatórios saem dos mesmos dados das telas, em PDF ou Excel, gerados no computador (não precisa de internet). Nenhum traz resultado de exame ou dado clínico." />
      <div className="cartao mb-4 flex flex-wrap items-end gap-4 p-4">
        <div className="text-sm">
          <div className="rotulo">Empresa</div>
          <div className="py-2 font-medium">{empresa ? (empresa.nomeFantasia || empresa.razaoSocial) : 'Todas as empresas que você acessa'}</div>
          <div className="text-xs text-slate-500">Troque no seletor do topo.</div>
        </div>
        <Campo rotulo="Período de" className="w-40"><input type="date" className="campo" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo rotulo="até" className="w-40"><input type="date" className="campo" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} /></Campo>
        <p className="max-w-xs text-xs text-slate-500">O período vale para ações (abertura), ocorrências (data), eventos do eSocial (referência) e calendário (prazo).</p>
      </div>
      <Aviso erro={erro ?? q.error} />
      {!q.data ? <Carregando /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.filter((r: any) => r.disponivel).map((r: any) => (
            <section key={r.tipo} className="cartao flex flex-col p-5">
              <h2 className="font-semibold text-tinta">{r.nome}</h2>
              <p className="mt-1 flex-1 text-sm text-slate-600">{r.descricao}</p>
              {COM_PERIODO.includes(r.tipo) && (de || ate) && <p className="mt-2 text-xs text-slate-500">Com o período escolhido acima.</p>}
              <div className="mt-4 flex gap-2">
                <button className="btn-secundario" disabled={!!gerando} onClick={() => gerar(r.tipo, r.nome, 'pdf')}>
                  <FileText size={15} /> {gerando === `${r.tipo}-pdf` ? 'Gerando…' : 'PDF'}
                </button>
                <button className="btn-secundario" disabled={!!gerando} onClick={() => gerar(r.tipo, r.nome, 'xlsx')}>
                  <FileSpreadsheet size={15} /> {gerando === `${r.tipo}-xlsx` ? 'Gerando…' : 'Excel'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
