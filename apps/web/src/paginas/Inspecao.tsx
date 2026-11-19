import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RESULTADOS_ITEM, TIPOS_INSPECAO } from '@sst/shared';
import { api } from '../lib/api';
import { dataBr, hojeIso } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { FormAcao, OrigemFixa, SituacaoAcao } from '../componentes/acoes';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo } from '../componentes/ui';
import { FormSimples } from './Acao';
import { useEstrutura } from './Estrutura';
import { FormInspecao, SituacaoInspecao } from './Inspecoes';

const COR_RES: Record<string, string> = {
  conforme: 'bg-emerald-100 text-emerald-800', nao_conforme: 'bg-red-100 text-red-800', nao_aplicavel: 'bg-slate-100 text-slate-600',
};

function FormItem({ insp, item, aoSalvar }: { insp: any; item?: any; aoSalvar: (r: any) => void }) {
  const setores = useEstrutura(insp.empresaId, 'setores');
  const [d, setD] = useState<any>(item ?? { resultado: 'conforme', setorId: insp.setorId ?? '' });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const corpo = { descricao: d.descricao, resultado: d.resultado, observacao: d.observacao || null, setorId: d.setorId || null };
      aoSalvar(item ? await api.put(`/inspecao-itens/${item.id}`, corpo) : await api.post(`/inspecoes/${insp.id}/itens`, corpo));
    }}>
      <Campo rotulo="Item verificado" obrigatorio><input className="campo" value={d.descricao ?? ''} onChange={set('descricao')} required placeholder="ex.: proteção da serra circular" /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Resultado" obrigatorio>
          <select className="campo" value={d.resultado} onChange={set('resultado')}>{Object.entries(RESULTADOS_ITEM).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select>
        </Campo>
        <Campo rotulo="Setor">
          <select className="campo" value={d.setorId ?? ''} onChange={set('setorId')}>
            <option value="" />
            {setores.data?.filter((x: any) => x.estabelecimentoId === insp.estabelecimentoId).map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Observação"><textarea className="campo" rows={2} value={d.observacao ?? ''} onChange={set('observacao')} /></Campo>
    </Formulario>
  );
}

export function Inspecao() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [janela, setJanela] = useState<null | 'editar' | 'item' | 'concluir' | { item: any } | { acao: OrigemFixa }>(null);
  const [erro, setErro] = useState<unknown>();
  const q = useQuery({ queryKey: ['inspecao', id], queryFn: () => api.get(`/inspecoes/${id}`) });
  const i = q.data;
  if (q.error) return <Aviso erro={q.error} />;
  if (!i) return <Carregando />;
  const salvo = (r: any) => {
    qc.setQueryData(['inspecao', id], r);
    qc.invalidateQueries({ queryKey: ['inspecoes'] });
    setJanela(null);
  };
  const editar = i.situacao === 'aberta' && s.pode('inspecoes.editar');
  const fechar = () => setJanela(null);
  return (
    <>
      <Link to="/inspecoes" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-tinta"><ArrowLeft size={15} /> Inspeções</Link>
      <Titulo
        titulo={`Inspeção ${i.codigo}`}
        subtitulo={<>{dataBr(i.data)} · {TIPOS_INSPECAO[i.tipo as keyof typeof TIPOS_INSPECAO]} · {i.estabelecimentoNome}{i.setorNome ? ` · ${i.setorNome}` : ''} · {i.responsavelNome}</>}
        acoes={<>
          <SituacaoInspecao s={i.situacao} />
          {editar && <button className="btn-secundario" onClick={() => setJanela('editar')}><Pencil size={15} /> Editar</button>}
          {editar && <button className="btn-primario" onClick={() => setJanela('concluir')}><Check size={15} /> Concluir</button>}
        </>}
      />
      <Aviso erro={erro} />
      {i.escopo && <p className="mb-4 whitespace-pre-line text-sm text-slate-600">Escopo: {i.escopo}</p>}
      {i.conclusao && <p className="mb-4 whitespace-pre-line rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Conclusão ({dataBr(i.concluidaEm)}): {i.conclusao}</p>}
      <section className="cartao overflow-x-auto">
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-sm font-semibold">Itens verificados</h2>
          {editar && <button className="btn-secundario" onClick={() => setJanela('item')}><Plus size={15} /> Item</button>}
        </div>
        {!i.itensLista.length ? <p className="px-5 py-6 text-sm text-slate-500">Nenhum item registrado.</p> : (
          <table className="tabela mt-2">
            <thead><tr><th>#</th><th>Item</th><th>Resultado</th><th>Ações</th><th /></tr></thead>
            <tbody>
              {i.itensLista.map((x: any) => (
                <tr key={x.id}>
                  <td className="tabular-nums text-slate-500">{x.ordem}</td>
                  <td><div>{x.descricao}</div>{(x.observacao || x.setorNome) && <div className="text-xs text-slate-500">{[x.setorNome, x.observacao].filter(Boolean).join(' · ')}</div>}</td>
                  <td><Etiqueta cor={COR_RES[x.resultado]}>{RESULTADOS_ITEM[x.resultado as keyof typeof RESULTADOS_ITEM]}</Etiqueta></td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {x.acoes.map((a: any) => <Link key={a.id} to={`/acoes/${a.id}`} className="inline-flex items-center gap-1 text-sm text-marca-700 hover:underline">{a.codigo} <SituacaoAcao s={a.situacao} /></Link>)}
                      {x.resultado === 'nao_conforme' && s.pode('acoes.editar') && (
                        <button className="text-sm text-marca-700 hover:underline" onClick={() => setJanela({ acao: {
                          origem: 'inspecao', rotulo: `${i.codigo}, item ${x.ordem}: ${x.descricao}`, inspecaoItemId: x.id,
                          estabelecimentoId: i.estabelecimentoId, setorId: x.setorId ?? i.setorId, descricao: '',
                        } })}>+ gerar ação</button>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {editar && <button className="p-1 text-slate-400 hover:text-tinta" aria-label="Editar item" onClick={() => setJanela({ item: x })}><Pencil size={15} /></button>}
                    {editar && !x.acoes.length && (
                      <button className="p-1 text-slate-400 hover:text-red-600" aria-label="Remover item" onClick={async () => {
                        if (!window.confirm('Remover este item?')) return;
                        setErro(undefined);
                        try { salvo(await api.delete(`/inspecao-itens/${x.id}`)); } catch (e) { setErro(e); }
                      }}><Trash2 size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Modal titulo="Editar inspeção" aberto={janela === 'editar'} aoFechar={fechar} largura="max-w-xl">
        {janela === 'editar' && <FormInspecao empresaId={i.empresaId} inicial={i} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Novo item" aberto={janela === 'item'} aoFechar={fechar} largura="max-w-lg">{janela === 'item' && <FormItem insp={i} aoSalvar={salvo} />}</Modal>
      <Modal titulo="Editar item" aberto={typeof janela === 'object' && !!janela && 'item' in janela} aoFechar={fechar} largura="max-w-lg">
        {typeof janela === 'object' && janela && 'item' in janela && <FormItem insp={i} item={janela.item} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Concluir inspeção" aberto={janela === 'concluir'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'concluir' && <FormSimples campos={[{ k: 'data', r: 'Data', tipo: 'date', inicial: hojeIso(), min: i.data, max: hojeIso() }, { k: 'conclusao', r: 'Conclusão', area: true }]}
          botao="Concluir" enviar={(d) => api.post(`/inspecoes/${i.id}/conclusao`, d)} aoSalvar={salvo}
          nota="Depois de concluída, a inspeção não recebe itens novos. As ações abertas continuam no plano de ação." />}
      </Modal>
      <Modal titulo="Nova ação" aberto={typeof janela === 'object' && !!janela && 'acao' in janela} aoFechar={fechar}>
        {typeof janela === 'object' && janela && 'acao' in janela && <FormAcao empresaId={i.empresaId} fixa={janela.acao} aoSalvar={(a) => nav(`/acoes/${a.id}`)} />}
      </Modal>
    </>
  );
}
