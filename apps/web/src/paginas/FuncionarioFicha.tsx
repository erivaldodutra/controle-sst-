import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TIPOS_CONTRATO } from '@sst/shared';
import { api, ErroApi } from '../lib/api';
import { cpf, dataBr, dataHoraBr, hojeIso, SITUACOES } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Posicao, posicaoVazia, SeletorPosicao } from '../componentes/Posicao';
import { Aviso, Campo, Carregando, Etiqueta, Modal, Titulo, Vazio } from '../componentes/ui';

function FormSimples({ titulo, children, aoEnviar, botao = 'Salvar', perigo }: {
  titulo?: string; children: ReactNode; aoEnviar: () => Promise<unknown>; botao?: string; perigo?: boolean;
}) {
  const [erro, setErro] = useState<unknown>();
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(undefined);
    setEnviando(true);
    try {
      await aoEnviar();
    } catch (x) {
      setErro(x instanceof ErroApi && x.corpo?.campos ? new Error(x.corpo.campos.map((c: any) => c.mensagem).join('; ')) : x);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-3">
      {titulo && <p className="text-sm text-slate-600">{titulo}</p>}
      <Aviso erro={erro} />
      {children}
      <button className={perigo ? 'btn-perigo' : 'btn-primario'} disabled={enviando}>{botao}</button>
    </form>
  );
}

type Acao =
  | { tipo: 'pessoa' }
  | { tipo: 'vinculo'; v: any }
  | { tipo: 'movimentar'; v: any }
  | { tipo: 'afastar'; v: any }
  | { tipo: 'retorno'; a: any }
  | { tipo: 'desligar'; v: any };

export function FuncionarioFicha() {
  const { id } = useParams();
  const s = useSessao();
  const qc = useQueryClient();
  const [aba, setAba] = useState<'vinculos' | 'historico'>('vinculos');
  const [acao, setAcao] = useState<Acao | null>(null);
  const f = useQuery({ queryKey: ['funcionario', id], queryFn: () => api.get(`/funcionarios/${id}`) });
  const hist = useQuery({ queryKey: ['funcionario', id, 'historico'], queryFn: () => api.get(`/funcionarios/${id}/historico`), enabled: aba === 'historico' });
  useEffect(() => {
    if (f.data && s.empresaId !== f.data.empresaId) s.setEmpresaId(f.data.empresaId);
  }, [f.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const feito = () => {
    setAcao(null);
    qc.invalidateQueries({ queryKey: ['funcionario', id] });
    qc.invalidateQueries({ queryKey: ['funcionarios'] });
  };
  if (f.isLoading) return <Carregando />;
  if (f.isError) return <Aviso erro={f.error} />;
  const d = f.data;
  const pode = s.pode('funcionarios.editar');
  const empresa = s.empresas.find((e) => e.id === d.empresaId);
  return (
    <>
      <Titulo
        titulo={d.nome}
        subtitulo={`CPF ${cpf(d.cpf)} · ${empresa?.razaoSocial ?? ''}`}
        acoes={pode && <button className="btn-secundario" onClick={() => setAcao({ tipo: 'pessoa' })}>Editar dados pessoais</button>}
      />
      <div className="cartao mb-4 grid grid-cols-2 gap-3 p-4 text-sm md:grid-cols-5">
        {[
          ['Nascimento', dataBr(d.dataNascimento)], ['Sexo', d.sexo ?? '—'], ['E-mail', d.email ?? '—'],
          ['Telefone', d.telefone ?? '—'], ['Atualizado em', dataHoraBr(d.atualizadoEm)],
        ].map(([r, v]) => <div key={r}><div className="text-xs text-slate-500">{r}</div><div>{v}</div></div>)}
      </div>
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {([['vinculos', 'Vínculos e lotações'], ['historico', 'Histórico de alterações']] as const).map(([k, r]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? 'border-marca-600 font-medium text-marca-700' : 'border-transparent text-slate-500'}`}>{r}</button>
        ))}
      </div>

      {aba === 'vinculos' && d.vinculos.map((v: any) => (
        <div key={v.id} className="cartao mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">Matrícula {v.matricula}</span>
              <Etiqueta cor={SITUACOES[v.situacao]?.cor ?? ''}>{SITUACOES[v.situacao]?.rotulo}</Etiqueta>
              <span className="text-slate-500">Admissão {dataBr(v.dataAdmissao)}{v.dataDesligamento && ` · Desligamento ${dataBr(v.dataDesligamento)}`}</span>
            </div>
            {pode && !v.dataDesligamento && (
              <div className="flex flex-wrap gap-2">
                <button className="btn-secundario" onClick={() => setAcao({ tipo: 'vinculo', v })}>Editar vínculo</button>
                <button className="btn-secundario" onClick={() => setAcao({ tipo: 'movimentar', v })}>Transferir / mudar função</button>
                <button className="btn-secundario" onClick={() => setAcao({ tipo: 'afastar', v })}>Registrar afastamento</button>
                <button className="btn-secundario text-red-700" onClick={() => setAcao({ tipo: 'desligar', v })}>Desligar</button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 py-3 text-sm md:grid-cols-4">
            <div><div className="text-xs text-slate-500">Categoria eSocial</div>{v.categoria ?? '—'}</div>
            <div><div className="text-xs text-slate-500">Tipo de contrato</div>{v.tipoContrato ? TIPOS_CONTRATO[v.tipoContrato as 1] : '—'}</div>
            <div><div className="text-xs text-slate-500">Jornada</div>{v.jornada ?? '—'}</div>
            {v.motivoDesligamento && <div><div className="text-xs text-slate-500">Motivo do desligamento</div>{v.motivoDesligamento}</div>}
          </div>
          <h3 className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Histórico de lotação e exposição</h3>
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Período</th><th>Estabelecimento</th><th>Setor</th><th>GHE</th><th>Função</th><th>CBO</th><th>Cargo</th><th>Motivo</th></tr></thead>
              <tbody>
                {v.lotacoes.map((l: any) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap tabular-nums">{dataBr(l.inicio)} a {l.fim ? dataBr(l.fim) : 'atual'}</td>
                    <td>{l.estabelecimento}</td><td>{l.setor ?? '—'}</td><td>{l.ghe ?? '—'}</td>
                    <td>{l.funcao ?? '—'}</td><td className="tabular-nums">{l.cbo ?? '—'}</td><td>{l.cargo ?? '—'}</td>
                    <td className="text-slate-600">{l.motivo}<div className="text-xs text-slate-400">por {l.registradoPor ?? '—'} em {dataHoraBr(l.registradoEm)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {v.afastamentos.length > 0 && (
            <>
              <h3 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Afastamentos</h3>
              <table className="tabela">
                <thead><tr><th>Início</th><th>Retorno</th><th>Motivo</th><th /></tr></thead>
                <tbody>
                  {v.afastamentos.map((a: any) => (
                    <tr key={a.id}>
                      <td className="tabular-nums">{dataBr(a.inicio)}</td>
                      <td className="tabular-nums">{a.fim ? dataBr(a.fim) : 'em aberto'}</td>
                      <td>{a.motivo}</td>
                      <td className="text-right">{pode && !a.fim && <button className="text-sm text-marca-700 hover:underline" onClick={() => setAcao({ tipo: 'retorno', a })}>Registrar retorno</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="px-4 py-3 text-xs text-slate-400">ASOs, treinamentos e eventos eSocial deste vínculo aparecerão aqui nas próximas fases.</p>
        </div>
      ))}

      {aba === 'historico' && (
        <div className="cartao overflow-x-auto">
          {hist.isLoading ? <Carregando /> : !hist.data?.length ? <Vazio>Sem registros.</Vazio> : (
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Alterações</th></tr></thead>
              <tbody>
                {hist.data.map((h: any) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap tabular-nums">{dataHoraBr(h.em)}</td>
                    <td>{h.usuario ?? 'sistema'}</td>
                    <td>{descreverOperacao(h)}</td>
                    <td className="text-xs text-slate-600">{diferencas(h.antes, h.depois)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal titulo={tituloAcao(acao)} aberto={!!acao} aoFechar={() => setAcao(null)} largura="max-w-xl">
        {acao?.tipo === 'pessoa' && <FormPessoa d={d} aoSalvar={feito} />}
        {acao?.tipo === 'vinculo' && <FormVinculo v={acao.v} aoSalvar={feito} />}
        {acao?.tipo === 'movimentar' && <FormMovimentar empresaId={d.empresaId} v={acao.v} aoSalvar={feito} />}
        {acao?.tipo === 'afastar' && <FormAfastar v={acao.v} aoSalvar={feito} />}
        {acao?.tipo === 'retorno' && <FormRetorno a={acao.a} aoSalvar={feito} />}
        {acao?.tipo === 'desligar' && <FormDesligar v={acao.v} aoSalvar={feito} />}
      </Modal>
    </>
  );
}

const tituloAcao = (a: Acao | null) =>
  !a ? '' : ({ pessoa: 'Editar dados pessoais', vinculo: 'Editar vínculo', movimentar: 'Transferência ou mudança de função', afastar: 'Registrar afastamento', retorno: 'Registrar retorno', desligar: 'Desligar funcionário' } as const)[a.tipo];

const NOMES_TABELA: Record<string, string> = { funcionario: 'Dados pessoais', vinculo: 'Vínculo', lotacao: 'Lotação', afastamento: 'Afastamento' };
const OPS: Record<string, string> = { INSERT: 'registrado(a)', UPDATE: 'alterado(a)', DELETE: 'excluído(a)' };
const descreverOperacao = (h: any) => `${NOMES_TABELA[h.tabela] ?? h.tabela} ${OPS[h.operacao] ?? h.operacao}`;
const OCULTOS = new Set(['id', 'tenant_id', 'empresa_id', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por', 'vinculo_id', 'funcionario_id']);
function diferencas(antes: any, depois: any) {
  if (!antes) return Object.entries(depois ?? {}).filter(([k, v]) => !OCULTOS.has(k) && v !== null).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return Object.keys(depois ?? {})
    .filter((k) => !OCULTOS.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
    .map((k) => `${k}: ${antes[k] ?? '—'} → ${depois[k] ?? '—'}`)
    .join(' · ');
}

function FormPessoa({ d, aoSalvar }: { d: any; aoSalvar: () => void }) {
  const [p, setP] = useState({ nome: d.nome, cpf: d.cpf, dataNascimento: d.dataNascimento ?? '', sexo: d.sexo ?? '', email: d.email ?? '', telefone: d.telefone ?? '' });
  const s = (k: keyof typeof p) => (e: any) => setP({ ...p, [k]: e.target.value });
  return (
    <FormSimples aoEnviar={async () => { await api.put(`/funcionarios/${d.id}`, { ...p, dataNascimento: p.dataNascimento || null, sexo: p.sexo || null, email: p.email || null, telefone: p.telefone || null }); aoSalvar(); }}>
      <Campo rotulo="Nome completo" obrigatorio><input className="campo" value={p.nome} onChange={s('nome')} required /></Campo>
      <Campo rotulo="CPF" obrigatorio><input className="campo" value={p.cpf} onChange={s('cpf')} required /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Data de nascimento"><input className="campo" type="date" value={p.dataNascimento} onChange={s('dataNascimento')} /></Campo>
        <Campo rotulo="Sexo"><select className="campo" value={p.sexo} onChange={s('sexo')}><option value="" /><option>F</option><option>M</option></select></Campo>
        <Campo rotulo="E-mail"><input className="campo" value={p.email} onChange={s('email')} /></Campo>
        <Campo rotulo="Telefone"><input className="campo" value={p.telefone} onChange={s('telefone')} /></Campo>
      </div>
    </FormSimples>
  );
}

function FormVinculo({ v, aoSalvar }: { v: any; aoSalvar: () => void }) {
  const [d, setD] = useState({ matricula: v.matricula, categoria: v.categoria ?? '', tipoContrato: v.tipoContrato ?? '', jornada: v.jornada ?? '' });
  const s = (k: keyof typeof d) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <FormSimples titulo="A data de admissão não é editável aqui. Se estiver errada, desligue e readmita com a data correta, para manter o histórico."
      aoEnviar={async () => { await api.put(`/vinculos/${v.id}`, { matricula: d.matricula, categoria: d.categoria || null, tipoContrato: d.tipoContrato ? Number(d.tipoContrato) : null, jornada: d.jornada || null }); aoSalvar(); }}>
      <Campo rotulo="Matrícula" obrigatorio><input className="campo" value={d.matricula} onChange={s('matricula')} required /></Campo>
      <Campo rotulo="Categoria eSocial"><input className="campo" value={d.categoria} onChange={s('categoria')} /></Campo>
      <Campo rotulo="Tipo de contrato">
        <select className="campo" value={d.tipoContrato} onChange={s('tipoContrato')}>
          <option value="" />{Object.entries(TIPOS_CONTRATO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Jornada"><input className="campo" value={d.jornada} onChange={s('jornada')} /></Campo>
    </FormSimples>
  );
}

function FormMovimentar({ empresaId, v, aoSalvar }: { empresaId: string; v: any; aoSalvar: () => void }) {
  const atual = v.lotacoes[0];
  const [inicio, setInicio] = useState(hojeIso());
  const [motivo, setMotivo] = useState('');
  const [pos, setPos] = useState<Posicao>(atual ? {
    estabelecimentoId: atual.estabelecimentoId, setorId: atual.setorId, cargoId: atual.cargoId, funcaoId: atual.funcaoId, gheId: atual.gheId,
  } : posicaoVazia);
  return (
    <FormSimples titulo="A lotação atual será encerrada na véspera da data informada e uma nova será aberta. O histórico anterior não é alterado."
      aoEnviar={async () => { await api.post(`/vinculos/${v.id}/movimentacoes`, { inicio, motivo, posicao: pos }); aoSalvar(); }}>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="A partir de" obrigatorio><input className="campo" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required /></Campo>
        <Campo rotulo="Motivo" obrigatorio><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: Promoção, transferência" required /></Campo>
      </div>
      <SeletorPosicao empresaId={empresaId} valor={pos} onChange={setPos} />
    </FormSimples>
  );
}

function FormAfastar({ v, aoSalvar }: { v: any; aoSalvar: () => void }) {
  const [d, setD] = useState({ inicio: hojeIso(), fim: '', motivo: '' });
  return (
    <FormSimples aoEnviar={async () => { await api.post(`/vinculos/${v.id}/afastamentos`, { ...d, fim: d.fim || null }); aoSalvar(); }}>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Início" obrigatorio><input className="campo" type="date" value={d.inicio} onChange={(e) => setD({ ...d, inicio: e.target.value })} required /></Campo>
        <Campo rotulo="Retorno previsto (se souber)"><input className="campo" type="date" value={d.fim} onChange={(e) => setD({ ...d, fim: e.target.value })} /></Campo>
      </div>
      <Campo rotulo="Motivo" obrigatorio><input className="campo" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} required /></Campo>
    </FormSimples>
  );
}

function FormRetorno({ a, aoSalvar }: { a: any; aoSalvar: () => void }) {
  const [fim, setFim] = useState(hojeIso());
  return (
    <FormSimples titulo={`Afastamento iniciado em ${dataBr(a.inicio)}. Informe o último dia de afastamento.`}
      aoEnviar={async () => { await api.post(`/afastamentos/${a.id}/encerramento`, { fim }); aoSalvar(); }}>
      <Campo rotulo="Último dia de afastamento" obrigatorio><input className="campo" type="date" value={fim} onChange={(e) => setFim(e.target.value)} required /></Campo>
    </FormSimples>
  );
}

function FormDesligar({ v, aoSalvar }: { v: any; aoSalvar: () => void }) {
  const [d, setD] = useState({ data: hojeIso(), motivo: '' });
  return (
    <FormSimples perigo botao="Confirmar desligamento" titulo="O vínculo e a lotação atual serão encerrados nesta data. O histórico é mantido."
      aoEnviar={async () => { await api.post(`/vinculos/${v.id}/desligamento`, { data: d.data, motivo: d.motivo || null }); aoSalvar(); }}>
      <Campo rotulo="Data do desligamento" obrigatorio><input className="campo" type="date" value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} required /></Campo>
      <Campo rotulo="Motivo"><input className="campo" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} /></Campo>
    </FormSimples>
  );
}
