import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { UFS } from '@sst/shared';
import { api } from '../lib/api';
import { dataBr, hojeIso, inscricao } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Formulario, useCadastroSaude } from '../componentes/saude';
import { Campo, Carregando, Etiqueta, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';

type Aba = 'medicos' | 'clinicas' | 'tipos-exame' | 'coordenador';
const ABAS: { aba: Aba; rotulo: string; singular?: string }[] = [
  { aba: 'medicos', rotulo: 'Médicos', singular: 'médico' },
  { aba: 'clinicas', rotulo: 'Clínicas', singular: 'clínica' },
  { aba: 'tipos-exame', rotulo: 'Tipos de exame', singular: 'tipo de exame' },
  { aba: 'coordenador', rotulo: 'Médico coordenador do PCMSO' },
];

function FormCadastro({ aba, inicial, aoSalvar }: { aba: Exclude<Aba, 'coordenador'>; inicial?: any; aoSalvar: () => void }) {
  const [d, setD] = useState<any>({ ativo: true, ...(inicial ?? {}) });
  const set = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  const salvar = async () => {
    const corpo: any = { ...d };
    delete corpo.id;
    for (const k of Object.keys(corpo)) if (corpo[k] === '') corpo[k] = null;
    if (inicial) await api.put(`/saude/${aba}/${inicial.id}`, corpo);
    else await api.post(`/saude/${aba}`, corpo);
    aoSalvar();
  };
  return (
    <Formulario aoEnviar={salvar}>
      {aba === 'medicos' && (
        <>
          <Campo rotulo="Nome" obrigatorio><input className="campo" value={d.nome ?? ''} onChange={set('nome')} required /></Campo>
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="CRM" obrigatorio className="col-span-2"><input className="campo" value={d.crm ?? ''} onChange={set('crm')} inputMode="numeric" required /></Campo>
            <Campo rotulo="UF do CRM" obrigatorio>
              <select className="campo" value={d.ufCrm ?? ''} onChange={set('ufCrm')} required>
                <option value="" />
                {UFS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Campo>
          </div>
          <Campo rotulo="CPF (necessário para o eSocial quando for o coordenador do PCMSO)"><input className="campo" value={d.cpf ?? ''} onChange={set('cpf')} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="E-mail"><input className="campo" type="email" value={d.email ?? ''} onChange={set('email')} /></Campo>
            <Campo rotulo="Telefone"><input className="campo" value={d.telefone ?? ''} onChange={set('telefone')} /></Campo>
          </div>
        </>
      )}
      {aba === 'clinicas' && (
        <>
          <Campo rotulo="Razão social" obrigatorio><input className="campo" value={d.razaoSocial ?? ''} onChange={set('razaoSocial')} required /></Campo>
          <Campo rotulo="Nome fantasia"><input className="campo" value={d.nomeFantasia ?? ''} onChange={set('nomeFantasia')} /></Campo>
          <Campo rotulo="CNPJ"><input className="campo" value={d.cnpj ?? ''} onChange={set('cnpj')} /></Campo>
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Município" className="col-span-2"><input className="campo" value={d.municipio ?? ''} onChange={set('municipio')} /></Campo>
            <Campo rotulo="UF">
              <select className="campo" value={d.uf ?? ''} onChange={set('uf')}>
                <option value="" />
                {UFS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Telefone"><input className="campo" value={d.telefone ?? ''} onChange={set('telefone')} /></Campo>
            <Campo rotulo="E-mail"><input className="campo" type="email" value={d.email ?? ''} onChange={set('email')} /></Campo>
          </div>
        </>
      )}
      {aba === 'tipos-exame' && (
        <>
          <Campo rotulo="Nome do exame" obrigatorio><input className="campo" value={d.nome ?? ''} onChange={set('nome')} placeholder="ex.: Audiometria tonal" required /></Campo>
          <Campo rotulo="Código do procedimento no eSocial (Tabela 27, 4 dígitos)">
            <input className="campo" value={d.codigoEsocial ?? ''} onChange={set('codigoEsocial')} inputMode="numeric" maxLength={4} />
          </Campo>
          <Campo rotulo="Descrição"><textarea className="campo" rows={3} value={d.descricao ?? ''} onChange={set('descricao')} /></Campo>
        </>
      )}
      {inicial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.ativo} onChange={(e) => setD({ ...d, ativo: e.target.checked })} /> Ativo</label>}
    </Formulario>
  );
}

function Coordenador({ empresaId, podeEditar }: { empresaId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['coordenador', empresaId], queryFn: () => api.get<any[]>(`/empresas/${empresaId}/medico-coordenador`) });
  const medicos = useCadastroSaude('medicos');
  const [d, setD] = useState({ medicoId: '', inicio: hojeIso() });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="cartao overflow-x-auto">
        {lista.isLoading ? <Carregando /> : !lista.data?.length ? <Vazio>Nenhum médico coordenador definido para esta empresa.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Médico</th><th>CRM</th><th>Início</th><th>Fim</th></tr></thead>
            <tbody>
              {lista.data.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.nome} {!c.fim && <Etiqueta cor="bg-emerald-100 text-emerald-800">Atual</Etiqueta>}</td>
                  <td>{c.crm}/{c.ufCrm}</td><td>{dataBr(c.inicio)}</td><td>{dataBr(c.fim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {podeEditar && (
        <div className="cartao p-4">
          <h3 className="mb-2 text-sm font-semibold">Definir novo coordenador</h3>
          <p className="mb-3 text-xs text-slate-500">O período do coordenador atual é encerrado no dia anterior ao início do novo. O histórico fica guardado.</p>
          <Formulario botao="Definir" aoEnviar={async () => {
            await api.post(`/empresas/${empresaId}/medico-coordenador`, d);
            qc.invalidateQueries({ queryKey: ['coordenador', empresaId] });
          }}>
            <Campo rotulo="Médico" obrigatorio>
              <select className="campo" value={d.medicoId} onChange={(e) => setD({ ...d, medicoId: e.target.value })} required>
                <option value="" />
                {medicos.data?.map((m) => <option key={m.id} value={m.id}>{m.nome} · CRM {m.crm}/{m.ufCrm}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Início" obrigatorio><input className="campo" type="date" value={d.inicio} onChange={(e) => setD({ ...d, inicio: e.target.value })} required /></Campo>
          </Formulario>
        </div>
      )}
    </div>
  );
}

export function CadastrosSaude() {
  const s = useSessao();
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>('medicos');
  const [inativos, setInativos] = useState(false);
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const podeEditar = s.pode('saude.editar');
  const def = ABAS.find((a) => a.aba === aba)!;
  const lista = useCadastroSaude(aba === 'coordenador' ? 'medicos' : aba, inativos);
  return (
    <>
      <Titulo
        titulo="Cadastros de saúde"
        subtitulo="Médicos, clínicas e exames usados nos ASOs de todas as empresas"
        acoes={podeEditar && aba !== 'coordenador' && <button className="btn-primario" onClick={() => setEdit(null)}><Plus size={16} /> Novo {def.singular}</button>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {ABAS.map((a) => (
          <button key={a.aba} onClick={() => setAba(a.aba)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === a.aba ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {a.rotulo}
          </button>
        ))}
        {aba !== 'coordenador' && (
          <label className="ml-auto flex items-center gap-2 pb-1 text-sm text-slate-600">
            <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos
          </label>
        )}
      </div>
      {aba === 'coordenador' ? (
        <ExigeEmpresa empresaId={s.empresaId}>{s.empresaId && <Coordenador empresaId={s.empresaId} podeEditar={podeEditar} />}</ExigeEmpresa>
      ) : (
        <div className="cartao overflow-x-auto">
          {lista.isLoading ? <Carregando /> : !lista.data?.length ? <Vazio>Nenhum registro.</Vazio> : (
            <table className="tabela">
              <thead>
                <tr>
                  {aba === 'medicos' && <><th>Nome</th><th>CRM</th><th>Contato</th></>}
                  {aba === 'clinicas' && <><th>Razão social</th><th>CNPJ</th><th>Município</th></>}
                  {aba === 'tipos-exame' && <><th>Exame</th><th>Código eSocial</th><th>Descrição</th></>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.data.map((x) => (
                  <tr key={x.id} className={podeEditar ? 'cursor-pointer' : ''} onClick={() => podeEditar && setEdit(x)}>
                    {aba === 'medicos' && <><td className="font-medium">{x.nome}</td><td>{x.crm}/{x.ufCrm}</td><td>{x.email ?? x.telefone ?? '—'}</td></>}
                    {aba === 'clinicas' && <><td className="font-medium">{x.razaoSocial}</td><td>{x.cnpj ? inscricao(1, x.cnpj) : '—'}</td><td>{[x.municipio, x.uf].filter(Boolean).join('/') || '—'}</td></>}
                    {aba === 'tipos-exame' && <><td className="font-medium">{x.nome}</td><td className="tabular-nums">{x.codigoEsocial ?? '—'}</td><td className="text-slate-600">{x.descricao ?? ''}</td></>}
                    <td>{!x.ativo && <Etiqueta cor="bg-slate-200 text-slate-700">Inativo</Etiqueta>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <Modal titulo={edit ? `Editar ${def.singular}` : `Novo ${def.singular}`} aberto={edit !== undefined && aba !== 'coordenador'} aoFechar={() => setEdit(undefined)} largura="max-w-lg">
        {edit !== undefined && aba !== 'coordenador' && (
          <FormCadastro key={edit?.id ?? 'novo'} aba={aba} inicial={edit ?? undefined}
            aoSalvar={() => { setEdit(undefined); qc.invalidateQueries({ queryKey: ['saude', aba] }); }} />
        )}
      </Modal>
    </>
  );
}
