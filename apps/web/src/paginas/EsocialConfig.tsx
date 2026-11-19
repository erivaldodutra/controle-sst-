import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldAlert, Upload } from 'lucide-react';
import { useState } from 'react';
import { AMBIENTES_ESOCIAL, ORGAOS_CLASSE_AMBIENTAL, UFS } from '@sst/shared';
import { api, qs } from '../lib/api';
import { cpf, dataBr, dataHoraBr } from '../lib/formato';
import { useSessao } from '../lib/sessao';
import { Ambiente } from '../componentes/esocial';
import { Formulario } from '../componentes/saude';
import { Aviso, Campo, Carregando, ExigeEmpresa, Modal, Titulo, Vazio } from '../componentes/ui';
import { useConfigEsocial } from './Esocial';

type Janela = null | 'geral' | 'certificado' | 'cadeia' | 'liberar' | 'remover' | { resp: any | null };

function FormGeral({ c, aoSalvar }: { c: any; aoSalvar: (r: any) => void }) {
  const [d, setD] = useState({
    ambiente: c.ambiente as 1 | 2, inicioObrigatoriedade: c.inicioObrigatoriedade ?? '',
    transmissorTipo: c.transmissorTipo as 1 | 2, transmissorInscricao: c.transmissorInscricao ?? '',
  });
  return (
    <Formulario aoEnviar={async () => aoSalvar(await api.put(`/esocial/config/${c.empresaId}`, { ...d, inicioObrigatoriedade: d.inicioObrigatoriedade || null }))}>
      <Campo rotulo="Ambiente do eSocial" obrigatorio>
        <select className="campo" value={d.ambiente} onChange={(e) => setD({ ...d, ambiente: Number(e.target.value) as 1 | 2 })}>
          <option value={2}>{AMBIENTES_ESOCIAL[2]}</option>
          <option value={1} disabled={!c.producaoLiberadaEm}>{AMBIENTES_ESOCIAL[1]}{c.producaoLiberadaEm ? '' : ' (libere antes)'}</option>
        </select>
      </Campo>
      <Campo rotulo="Início da obrigatoriedade dos eventos de SST para a empresa">
        <input type="date" className="campo" value={d.inicioObrigatoriedade} onChange={(e) => setD({ ...d, inicioObrigatoriedade: e.target.value })} />
        <span className="mt-1 block text-xs text-slate-500">Registros anteriores a esta data não aparecem como pendência.</span>
      </Campo>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Campo rotulo="Transmissor" obrigatorio>
          <select className="campo" value={d.transmissorTipo} onChange={(e) => setD({ ...d, transmissorTipo: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>CNPJ</option><option value={2}>CPF</option>
          </select>
        </Campo>
        <Campo rotulo="Inscrição de quem transmite (titular do certificado)" obrigatorio>
          <input className="campo" required value={d.transmissorInscricao} onChange={(e) => setD({ ...d, transmissorInscricao: e.target.value })} />
        </Campo>
      </div>
      <p className="text-xs text-slate-500">Use o CNPJ da própria empresa ou o CNPJ/CPF do procurador com procuração eletrônica no eSocial.</p>
    </Formulario>
  );
}

function FormCertificado({ empresaId, aoSalvar }: { empresaId: string; aoSalvar: (r: any) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  return (
    <Formulario botao="Enviar certificado" aoEnviar={async () => {
      const f = new FormData();
      if (arquivo) f.append('arquivo', arquivo);
      f.append('senha', senha);
      const r = await api.post(`/esocial/config/${empresaId}/certificado`, f);
      setSenha('');
      aoSalvar(r);
    }}>
      <p className="text-sm text-slate-700">
        Certificado A1 (.pfx ou .p12) da empresa ou do procurador. O arquivo e a senha ficam cifrados no banco deste computador e nunca podem ser
        baixados de volta. Ao enviar um novo, o anterior é apagado.
      </p>
      <Campo rotulo="Arquivo do certificado" obrigatorio>
        <input type="file" className="campo" accept=".pfx,.p12" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      </Campo>
      <Campo rotulo="Senha do certificado" obrigatorio>
        <input type="password" className="campo" autoComplete="off" required value={senha} onChange={(e) => setSenha(e.target.value)} />
      </Campo>
    </Formulario>
  );
}

function FormCadeia({ empresaId, aoSalvar }: { empresaId: string; aoSalvar: (r: any) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  return (
    <Formulario botao="Adicionar à cadeia" aoEnviar={async () => {
      const f = new FormData();
      if (arquivo) f.append('arquivo', arquivo);
      aoSalvar(await api.post(`/esocial/config/${empresaId}/cadeia`, f));
    }} extra={<button type="button" className="btn-secundario" onClick={async () => aoSalvar(await api.post(`/esocial/config/${empresaId}/cadeia`, new FormData()))}>Limpar cadeia</button>}>
      <p className="text-sm text-slate-700">
        Normalmente não é preciso: o Windows já confia nas autoridades da ICP-Brasil. Se a conexão com o eSocial falhar por certificado do
        servidor não confiável, baixe a cadeia da ICP-Brasil (.pem, .cer ou .crt) no site do ITI e adicione aqui. Com cadeia cadastrada, só ela é usada.
      </p>
      <Campo rotulo="Certificado de autoridade" obrigatorio>
        <input type="file" className="campo" accept=".pem,.cer,.crt" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      </Campo>
    </Formulario>
  );
}

function FormResponsavel({ empresaId, r, aoSalvar }: { empresaId: string; r: any | null; aoSalvar: () => void }) {
  const [d, setD] = useState<any>(r ? { ...r, dscOc: r.dscOc ?? '', fim: r.fim ?? '' } : { nome: '', cpf: '', ideOc: 4, dscOc: '', nrOc: '', ufOc: '', inicio: '', fim: '' });
  const m = (k: string) => (e: any) => setD({ ...d, [k]: e.target.value });
  return (
    <Formulario aoEnviar={async () => {
      const corpo = { ...d, empresaId, ideOc: Number(d.ideOc), dscOc: d.dscOc || null, fim: d.fim || null };
      if (r) await api.put(`/esocial/responsaveis/${r.id}`, corpo); else await api.post('/esocial/responsaveis', corpo);
      aoSalvar();
    }}>
      <p className="text-sm text-slate-600">Profissional legalmente habilitado pelos registros ambientais (LTCAT/PGR), informado em todo S-2240 do período.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome" obrigatorio><input className="campo" required value={d.nome} onChange={m('nome')} /></Campo>
        <Campo rotulo="CPF" obrigatorio><input className="campo" required value={d.cpf} onChange={m('cpf')} /></Campo>
        <Campo rotulo="Órgão de classe" obrigatorio>
          <select className="campo" value={d.ideOc} onChange={m('ideOc')}>
            {Object.entries(ORGAOS_CLASSE_AMBIENTAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {Number(d.ideOc) === 9 && <Campo rotulo="Sigla do órgão" obrigatorio><input className="campo" required maxLength={20} value={d.dscOc} onChange={m('dscOc')} /></Campo>}
        <Campo rotulo="Número do registro" obrigatorio><input className="campo" required maxLength={14} value={d.nrOc} onChange={m('nrOc')} /></Campo>
        <Campo rotulo="UF do registro" obrigatorio>
          <select className="campo" required value={d.ufOc} onChange={m('ufOc')}>
            <option value="" />{UFS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Responsável desde" obrigatorio><input type="date" className="campo" required value={d.inicio} onChange={m('inicio')} /></Campo>
        <Campo rotulo="Até (vazio se atual)"><input type="date" className="campo" value={d.fim} onChange={m('fim')} /></Campo>
      </div>
    </Formulario>
  );
}

export function EsocialConfig() {
  const s = useSessao();
  const qc = useQueryClient();
  const [janela, setJanela] = useState<Janela>(null);
  const [erro, setErro] = useState<unknown>();
  const cfg = useConfigEsocial(s.empresaId);
  const resp = useQuery({
    queryKey: ['esocial-responsaveis', s.empresaId],
    queryFn: () => api.get(`/esocial/responsaveis${qs({ empresaId: s.empresaId })}`),
    enabled: !!s.empresaId,
  });
  const salvo = (r: any) => {
    qc.setQueryData(['esocial-config', s.empresaId], r);
    qc.invalidateQueries({ queryKey: ['esocial-pendencias'] });
    setJanela(null);
  };
  const fechar = () => setJanela(null);
  const c = cfg.data;
  const configurar = !!s.empresaId && s.pode('esocial.configurar');
  const preparar = !!s.empresaId && s.pode('esocial.preparar');
  const diasCert = c?.certificado ? Math.floor((new Date(c.certificado.validoAte).getTime() - Date.now()) / 86400000) : null;
  return (
    <>
      <Titulo titulo="Configuração e certificados do eSocial" subtitulo="Ambiente, certificado digital A1 e responsáveis pelos registros ambientais, por empresa." />
      <ExigeEmpresa empresaId={s.empresaId}>
        <Aviso erro={erro ?? cfg.error} />
        {!c ? <Carregando /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="cartao p-5 text-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-semibold">Ambiente e transmissor</h2>
                {configurar && <button className="btn-secundario" onClick={() => setJanela('geral')}><Pencil size={15} /> Alterar</button>}
              </div>
              <dl className="space-y-1.5">
                <div>Ambiente: <Ambiente a={c.ambiente} /></div>
                <div><span className="text-slate-500">Empregador (inscrição no eSocial): </span><span className="font-mono">{c.empregadorInscricao}</span></div>
                <div><span className="text-slate-500">Transmissor: </span><span className="font-mono">{c.transmissorInscricao}</span> ({c.transmissorTipo === 1 ? 'CNPJ' : 'CPF'})</div>
                <div><span className="text-slate-500">Início da obrigatoriedade: </span>{dataBr(c.inicioObrigatoriedade)}</div>
                <div className="break-all text-xs text-slate-500">Envio: {c.enderecos?.envio}</div>
              </dl>
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="font-medium">Liberação da produção</div>
                {c.producaoLiberadaEm ? <p className="mt-1 text-emerald-700">Liberada em {dataHoraBr(c.producaoLiberadaEm)}.</p> : (
                  <>
                    <p className="mt-1 text-slate-600">
                      A empresa começa na produção restrita (testes do governo). A produção só pode ser liberada depois que pelo menos um evento
                      for aceito lá, com recibo. Eventos aceitos na produção restrita: <strong>{c.aceitosProducaoRestrita}</strong>.
                    </p>
                    {configurar && <button className="btn-secundario mt-2" disabled={!c.aceitosProducaoRestrita} onClick={() => setJanela('liberar')}><ShieldAlert size={15} /> Liberar produção</button>}
                  </>
                )}
              </div>
            </section>
            <section className="cartao p-5 text-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-semibold">Certificado digital A1</h2>
                {configurar && <button className="btn-secundario" onClick={() => setJanela('certificado')}><KeyRound size={15} /> {c.certificado ? 'Trocar' : 'Cadastrar'}</button>}
              </div>
              {!c.certificado ? <p className="text-red-700">Nenhum certificado cadastrado. Sem ele não é possível aprovar (assinar) nem enviar eventos.</p> : (
                <dl className="space-y-1.5">
                  <div><span className="text-slate-500">Titular: </span>{c.certificado.titular}</div>
                  <div><span className="text-slate-500">Documento: </span><span className="font-mono">{c.certificado.documento ?? '—'}</span></div>
                  <div><span className="text-slate-500">Emissor: </span>{c.certificado.emissor}</div>
                  <div>
                    <span className="text-slate-500">Validade: </span>{dataBr(c.certificado.validoDe)} a {dataBr(c.certificado.validoAte)}
                    {diasCert !== null && <span className={diasCert < 30 ? ' font-medium text-red-700' : ' text-slate-500'}> ({diasCert < 0 ? 'vencido' : `${diasCert} dias restantes`})</span>}
                  </div>
                  <div className="break-all text-xs text-slate-500">Impressão digital SHA-256: {c.certificado.impressaoDigital}</div>
                  <div className="text-xs text-slate-500">Cadastrado em {dataHoraBr(c.certificado.criadoEm)}</div>
                </dl>
              )}
              {configurar && c.certificado && <button className="btn-secundario mt-3" onClick={() => setJanela('remover')}>Remover certificado</button>}
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Cadeia de confiança do servidor</div>
                  {configurar && <button className="btn-secundario" onClick={() => setJanela('cadeia')}><Upload size={15} /> Gerenciar</button>}
                </div>
                <p className="mt-1 text-slate-600">{c.temCadeia ? `${c.certificadosCadeia} certificado(s) de autoridade cadastrado(s).` : 'Usando as autoridades confiáveis do Windows.'}</p>
              </div>
            </section>
          </div>
        )}
        <section className="cartao mt-4 overflow-x-auto">
          <div className="flex items-center justify-between gap-3 px-5 pt-4">
            <h2 className="text-sm font-semibold">Responsáveis pelos registros ambientais (S-2240)</h2>
            {preparar && <button className="btn-secundario" onClick={() => setJanela({ resp: null })}><Plus size={15} /> Novo responsável</button>}
          </div>
          {resp.isLoading ? <Carregando /> : !resp.data?.length ? <Vazio>Nenhum responsável cadastrado. O S-2240 exige ao menos um responsável vigente na data das condições.</Vazio> : (
            <table className="tabela mt-2">
              <thead><tr><th>Nome</th><th>CPF</th><th>Registro</th><th>Período</th><th /></tr></thead>
              <tbody>{resp.data.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.nome}</td><td>{cpf(r.cpf)}</td>
                  <td>{r.ideOc === 9 ? r.dscOc : ORGAOS_CLASSE_AMBIENTAL[r.ideOc as 1 | 4]} {r.nrOc}/{r.ufOc}</td>
                  <td>{dataBr(r.inicio)} a {r.fim ? dataBr(r.fim) : 'atual'}</td>
                  <td className="text-right">{preparar && <button className="btn-secundario" onClick={() => setJanela({ resp: r })}><Pencil size={14} /> Editar</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </ExigeEmpresa>

      <Modal titulo="Ambiente e transmissor" aberto={janela === 'geral'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'geral' && c && <FormGeral c={c} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Certificado digital A1" aberto={janela === 'certificado'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'certificado' && <FormCertificado empresaId={s.empresaId!} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Cadeia de confiança" aberto={janela === 'cadeia'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'cadeia' && <FormCadeia empresaId={s.empresaId!} aoSalvar={salvo} />}
      </Modal>
      <Modal titulo="Remover certificado" aberto={janela === 'remover'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'remover' && (
          <Formulario perigo botao="Remover" aoEnviar={async () => salvo(await api.delete(`/esocial/config/${s.empresaId}/certificado`))}>
            <p className="text-sm text-slate-700">O arquivo e a senha são apagados do banco. Eventos já assinados continuam válidos; novos não poderão ser aprovados até cadastrar outro certificado.</p>
          </Formulario>
        )}
      </Modal>
      <Modal titulo="Liberar produção" aberto={janela === 'liberar'} aoFechar={fechar} largura="max-w-lg">
        {janela === 'liberar' && (
          <Formulario perigo botao="Liberar produção" aoEnviar={async () => { setErro(undefined); salvo(await api.post(`/esocial/config/${s.empresaId}/liberar-producao`)); }}>
            <p className="text-sm text-slate-700">
              Depois de liberada, a empresa poderá trocar o ambiente para produção. Na produção, os eventos enviados têm valor jurídico e só podem ser
              corrigidos por retificação ou exclusão. A liberação fica registrada com seu nome e não pode ser desfeita.
            </p>
          </Formulario>
        )}
      </Modal>
      <Modal titulo={typeof janela === 'object' && janela?.resp ? 'Editar responsável' : 'Novo responsável'} aberto={typeof janela === 'object' && !!janela} aoFechar={fechar}>
        {typeof janela === 'object' && janela && (
          <FormResponsavel empresaId={s.empresaId!} r={janela.resp} aoSalvar={() => { qc.invalidateQueries({ queryKey: ['esocial-responsaveis'] }); fechar(); }} />
        )}
      </Modal>
    </>
  );
}
