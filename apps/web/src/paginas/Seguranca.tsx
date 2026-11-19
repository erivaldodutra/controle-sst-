import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { dataBr, dataHoraBr } from '../lib/formato';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Titulo } from '../componentes/ui';

function FormPolitica({ atual }: { atual: any }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    inatividadeMinutos: String(atual.inatividadeMinutos),
    retencaoAvisosDias: String(atual.retencaoAvisosDias),
    retencaoSessoesDias: String(atual.retencaoSessoesDias),
  });
  const [ok, setOk] = useState(false);
  const num = (k: keyof typeof f, rotulo: string, min: number, max: number, unidade: string) => (
    <Campo rotulo={rotulo}>
      <div className="flex items-center gap-2">
        <input type="number" className="campo w-28" min={min} max={max} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        <span className="text-sm text-slate-500">{unidade}</span>
      </div>
    </Campo>
  );
  return (
    <Formulario botao="Salvar política" aoEnviar={async () => {
      setOk(false);
      await api.put('/seguranca/politica', {
        inatividadeMinutos: Number(f.inatividadeMinutos),
        retencaoAvisosDias: Number(f.retencaoAvisosDias),
        retencaoSessoesDias: Number(f.retencaoSessoesDias),
      });
      qc.invalidateQueries({ queryKey: ['politica'] });
      setOk(true);
    }}>
      {ok && <Aviso tipo="ok">Política salva. A inatividade vale a partir da próxima consulta de cada sessão.</Aviso>}
      {num('inatividadeMinutos', 'Encerrar a sessão depois de', 5, 720, 'minutos sem uso')}
      {num('retencaoAvisosDias', 'Apagar avisos do sino já lidos há mais de', 30, 3650, 'dias')}
      {num('retencaoSessoesDias', 'Apagar registros de sessões encerradas há mais de', 30, 3650, 'dias')}
    </Formulario>
  );
}

/** Política de segurança da sessão e de retenção: o que é temporário (e quando sai) e o que nunca é apagado. */
export function Seguranca() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['politica'], queryFn: () => api.get('/seguranca/politica') });
  const [limpando, setLimpando] = useState(false);
  const [resultado, setResultado] = useState<any>();
  const [erro, setErro] = useState<unknown>();
  const d = q.data;
  const limpar = async () => {
    setErro(undefined);
    setResultado(undefined);
    setLimpando(true);
    try {
      setResultado(await api.post('/seguranca/retencao'));
      qc.invalidateQueries({ queryKey: ['politica'] });
    } catch (x) { setErro(x); } finally { setLimpando(false); }
  };
  return (
    <>
      <Titulo titulo="Segurança e retenção"
        subtitulo="Quanto tempo a sessão fica aberta sem uso e o que o sistema pode apagar. Registros com valor legal nunca são apagados: são inativados, cancelados ou substituídos por nova versão." />
      <Aviso erro={erro ?? q.error} />
      {!d ? <Carregando /> : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="cartao p-5">
              <h2 className="mb-1 flex items-center gap-2 font-semibold"><Lock size={16} /> Sessão e dados temporários</h2>
              <p className="mb-4 text-sm text-slate-500">A consulta automática do sino não conta como uso. Depois do prazo, o sistema pede a senha de novo.</p>
              <FormPolitica atual={d} />
            </section>
            <section className="cartao flex flex-col p-5">
              <h2 className="mb-1 flex items-center gap-2 font-semibold"><Trash2 size={16} /> Limpeza dos dados temporários</h2>
              <p className="mb-4 text-sm text-slate-500">Roda sozinha uma vez por dia com o programa aberto. Só remove avisos já lidos e sessões encerradas, nos prazos ao lado.</p>
              {resultado && <Aviso tipo="ok">Limpeza feita: {resultado.avisosRemovidos} aviso(s) e {resultado.sessoesRemovidas} sessão(ões) removidos.</Aviso>}
              <div className="flex-1 overflow-x-auto">
                {d.execucoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma execução registrada ainda.</p> : (
                  <table className="tabela">
                    <thead><tr><th>Executada em</th><th className="text-right">Avisos</th><th className="text-right">Sessões</th></tr></thead>
                    <tbody>
                      {d.execucoes.map((e: any) => (
                        <tr key={e.executadaEm}><td>{dataHoraBr(e.executadaEm)}</td><td className="text-right tabular-nums">{e.avisosRemovidos}</td><td className="text-right tabular-nums">{e.sessoesRemovidas}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="mt-4"><button className="btn-secundario" disabled={limpando} onClick={limpar}>{limpando ? 'Limpando…' : 'Executar limpeza agora'}</button></div>
            </section>
          </div>
          <section className="cartao p-5">
            <h2 className="mb-1 font-semibold">Registros com valor legal (nunca apagados)</h2>
            <p className="mb-4 text-sm text-slate-500">O prazo é o mínimo pedido pela norma. O sistema guarda tudo por tempo indeterminado; só o backup e a sua política documental decidem o arquivamento.</p>
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Categoria</th><th>Guarda mínima</th><th>Base</th><th className="text-right">Registros</th><th>Desde</th></tr></thead>
                <tbody>
                  {d.categorias.map((c: any) => (
                    <tr key={c.chave}>
                      <td className="font-medium">{c.nome}</td><td>{c.prazo}</td><td className="text-slate-500">{c.base}</td>
                      <td className="text-right tabular-nums">{c.registros.toLocaleString('pt-BR')}</td><td>{dataBr(c.desde)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
