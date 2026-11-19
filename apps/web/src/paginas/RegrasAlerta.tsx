import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CATEGORIAS_ALERTA, type CategoriaAlerta } from '@sst/shared';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Formulario } from '../componentes/saude';
import { Aviso, Carregando, Titulo } from '../componentes/ui';
import { ConfigAlertas } from './Vencimentos';

function Preferencias({ atual }: { atual: Record<CategoriaAlerta, boolean> }) {
  const qc = useQueryClient();
  const [cat, setCat] = useState(atual);
  const [ok, setOk] = useState(false);
  return (
    <Formulario botao="Salvar minhas preferências" aoEnviar={async () => {
      setOk(false);
      await api.put('/notificacoes/preferencias', { categorias: cat });
      qc.invalidateQueries({ queryKey: ['notificacoes'] });
      qc.invalidateQueries({ queryKey: ['preferencias'] });
      setOk(true);
    }}>
      {ok && <Aviso tipo="ok">Preferências salvas.</Aviso>}
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(CATEGORIAS_ALERTA) as CategoriaAlerta[]).map((c) => (
          <label key={c} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-marca-600" checked={cat[c]} onChange={(e) => setCat({ ...cat, [c]: e.target.checked })} />
            {CATEGORIAS_ALERTA[c]}
          </label>
        ))}
      </div>
    </Formulario>
  );
}

/** Regras de alerta: antecedência (geral, para todos) e quais avisos cada pessoa quer receber no sino do topo. */
export function RegrasAlerta() {
  const s = useSessao();
  const qc = useQueryClient();
  const [salvo, setSalvo] = useState(false);
  const cfg = useQuery({ queryKey: ['config-alertas'], queryFn: () => api.get('/configuracoes/alertas') });
  const pref = useQuery({ queryKey: ['preferencias'], queryFn: () => api.get('/notificacoes/preferencias') });
  return (
    <>
      <Titulo titulo="Regras de alerta" subtitulo="Os avisos aparecem no sino do topo quando um prazo está atrasado ou dentro da antecedência configurada. Nenhum aviso é enviado para fora do computador." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cartao p-5">
          <h2 className="mb-1 font-semibold">Antecedência dos alertas</h2>
          <p className="mb-4 text-sm text-slate-500">Configuração geral do sistema{s.pode('sistema.configurar') ? '' : ' (só um administrador altera)'}.</p>
          {salvo && <Aviso tipo="ok">Antecedência salva.</Aviso>}
          {!cfg.data ? <Carregando /> : s.pode('sistema.configurar') ? (
            <ConfigAlertas atual={cfg.data.alertasDias} aoSalvar={() => { setSalvo(true); qc.invalidateQueries(); }} />
          ) : (
            <p className="text-sm">Avisar com <b>{cfg.data.alertasDias.join(', ')}</b> dias de antecedência.</p>
          )}
        </section>
        <section className="cartao p-5">
          <h2 className="mb-1 font-semibold">Avisos que eu recebo</h2>
          <p className="mb-4 text-sm text-slate-500">Vale só para você. Cada módulo continua respeitando as suas permissões.</p>
          {!pref.data ? <Carregando /> : <Preferencias atual={pref.data.categorias} />}
        </section>
      </div>
    </>
  );
}
