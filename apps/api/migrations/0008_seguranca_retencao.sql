-- Fase 7: segurança (sessão encerrada por inatividade) e política de retenção.

-- ---------------------------------------------------------------------------
-- Inatividade: a sessão cai depois de N minutos sem uso (além do limite de horas do login).
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_config
  ADD COLUMN inatividade_minutos integer NOT NULL DEFAULT 60 CHECK (inatividade_minutos BETWEEN 5 AND 720),
  -- Retenção dos dados temporários (avisos lidos e sessões encerradas). Registros com valor legal nunca são apagados.
  ADD COLUMN retencao_avisos_dias integer NOT NULL DEFAULT 180 CHECK (retencao_avisos_dias BETWEEN 30 AND 3650),
  ADD COLUMN retencao_sessoes_dias integer NOT NULL DEFAULT 90 CHECK (retencao_sessoes_dias BETWEEN 30 AND 3650);

CREATE OR REPLACE FUNCTION app.sessao_buscar(p_token_hash text)
RETURNS TABLE (sessao_id uuid, usuario_id uuid, tenant_id uuid, expira_em timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  SELECT s.id, s.usuario_id, s.tenant_id, s.expira_em
    FROM sessao s JOIN usuario u ON u.id = s.usuario_id
    LEFT JOIN tenant_config c ON c.tenant_id = s.tenant_id
   WHERE s.token_hash = p_token_hash AND s.revogada_em IS NULL AND s.expira_em > now() AND u.ativo
     AND s.ultimo_uso_em > now() - make_interval(mins => coalesce(c.inatividade_minutos, 60))
$$;

-- ---------------------------------------------------------------------------
-- Retenção: limpeza só de dados temporários, com registro de cada execução.
-- ---------------------------------------------------------------------------
CREATE TABLE retencao_execucao (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  executada_em       timestamptz NOT NULL DEFAULT now(),
  avisos_removidos   integer NOT NULL,
  sessoes_removidas  integer NOT NULL
);
CREATE INDEX retencao_execucao_tenant ON retencao_execucao (tenant_id, executada_em DESC);
ALTER TABLE retencao_execucao ENABLE ROW LEVEL SECURITY;
CREATE POLICY retencao_execucao_tenant ON retencao_execucao USING (tenant_id = app.tenant_atual()) WITH CHECK (tenant_id = app.tenant_atual());

/**
 * Remove avisos lidos e sessões encerradas mais antigos que o prazo do tenant.
 * Roda como dono (SECURITY DEFINER) porque cada usuário só enxerga as próprias linhas.
 * Nunca toca em registros com valor legal (ASO, documentos, ações, eventos, auditoria).
 */
CREATE OR REPLACE FUNCTION app.aplicar_retencao(p_tenant uuid, p_forcar boolean DEFAULT false)
RETURNS TABLE (avisos integer, sessoes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  c tenant_config%ROWTYPE;
  n_av integer;
  n_se integer;
BEGIN
  SELECT * INTO c FROM tenant_config WHERE tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Uma execução por dia basta (o serviço tenta a cada poucas horas, enquanto o programa está aberto).
  IF NOT p_forcar AND EXISTS (SELECT 1 FROM retencao_execucao r WHERE r.tenant_id = p_tenant AND r.executada_em > now() - interval '20 hours') THEN
    RETURN;
  END IF;
  DELETE FROM notificacao
   WHERE tenant_id = p_tenant AND lida_em IS NOT NULL AND lida_em < now() - make_interval(days => c.retencao_avisos_dias);
  GET DIAGNOSTICS n_av = ROW_COUNT;
  DELETE FROM sessao
   WHERE tenant_id = p_tenant
     AND coalesce(revogada_em, expira_em) < now() - make_interval(days => c.retencao_sessoes_dias);
  GET DIAGNOSTICS n_se = ROW_COUNT;
  INSERT INTO retencao_execucao (tenant_id, avisos_removidos, sessoes_removidas) VALUES (p_tenant, n_av, n_se);
  RETURN QUERY SELECT n_av, n_se;
END $$;

/** Aplica a retenção em todos os tenants (usado pelo agendamento interno, sem usuário logado). */
CREATE OR REPLACE FUNCTION app.aplicar_retencao_todos()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  t uuid;
  n integer := 0;
BEGIN
  FOR t IN SELECT tenant_id FROM tenant_config LOOP
    IF EXISTS (SELECT 1 FROM app.aplicar_retencao(t)) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- Índices para os volumes de produção (conferidos no teste de carga).
CREATE INDEX IF NOT EXISTS notificacao_limpeza ON notificacao (tenant_id, lida_em) WHERE lida_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessao_limpeza ON sessao (tenant_id, expira_em);

CREATE TRIGGER retencao_execucao_auditoria AFTER INSERT ON retencao_execucao FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    GRANT SELECT ON retencao_execucao TO sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;
