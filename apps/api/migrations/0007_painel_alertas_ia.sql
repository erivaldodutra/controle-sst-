-- Fase 6: notificações, preferências de alerta, assistente de IA (sugestões para aprovação humana).
-- Calendário, indicadores e relatórios são calculados dos dados que já existem: nada é digitado de novo.

-- ---------------------------------------------------------------------------
-- Notificações por usuário (geradas dos prazos; uma por item e estado)
-- ---------------------------------------------------------------------------
CREATE TABLE notificacao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  usuario_id  uuid NOT NULL REFERENCES usuario(id),
  empresa_id  uuid REFERENCES empresa(id),
  categoria   text NOT NULL CHECK (categoria IN ('aso', 'treinamento', 'documento', 'acao', 'esocial', 'certificado')),
  -- Identifica o prazo (categoria, registro, data e estado): o mesmo aviso não se repete.
  chave       text NOT NULL,
  titulo      text NOT NULL,
  detalhe     text,
  link        text,
  data        date,
  estado      text NOT NULL CHECK (estado IN ('atrasado', 'proximo')),
  criada_em   timestamptz NOT NULL DEFAULT now(),
  lida_em     timestamptz,
  UNIQUE (usuario_id, chave)
);
CREATE INDEX notificacao_usuario ON notificacao (usuario_id, lida_em, criada_em DESC);

CREATE TABLE preferencia_notificacao (
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  usuario_id  uuid NOT NULL REFERENCES usuario(id),
  categoria   text NOT NULL CHECK (categoria IN ('aso', 'treinamento', 'documento', 'acao', 'esocial', 'certificado')),
  ativo       boolean NOT NULL,
  PRIMARY KEY (usuario_id, categoria)
);

-- Cada usuário só vê e altera as próprias notificações e preferências.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notificacao', 'preferencia_notificacao']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_usuario ON %I
                    USING (tenant_id = app.tenant_atual() AND usuario_id = app.usuario_atual())
                    WITH CHECK (tenant_id = app.tenant_atual() AND usuario_id = app.usuario_atual())', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Assistente de IA (opcional, precisa de internet)
-- ---------------------------------------------------------------------------
CREATE TABLE ia_config (
  tenant_id      uuid PRIMARY KEY REFERENCES tenant(id),
  ativo          boolean NOT NULL DEFAULT false,
  -- Chave da API cifrada com a chave de dados do computador; nunca devolvida pela API.
  chave_cifrada  text,
  chave_final    text,
  modelo         text NOT NULL DEFAULT 'claude-opus-5-5',
  criado_por     uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  CHECK (NOT ativo OR chave_cifrada IS NOT NULL)
);

CREATE TABLE sugestao_ia (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  tipo             text NOT NULL CHECK (tipo IN ('explicar_rejeicao', 'resumo_pendencias')),
  evento_id        uuid REFERENCES esocial_evento(id),
  titulo           text NOT NULL,
  -- Exatamente o que foi enviado ao serviço de IA (sem CPF, nome nem dado clínico), para conferência.
  enviado          jsonb NOT NULL,
  texto            text NOT NULL,
  acoes_sugeridas  jsonb NOT NULL DEFAULT '[]',
  modelo           text NOT NULL,
  situacao         text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'aceita', 'descartada')),
  decidido_por     uuid REFERENCES usuario(id),
  decidido_por_nome text,
  decidido_em      timestamptz,
  motivo_descarte  text,
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  CHECK ((situacao = 'pendente') = (decidido_em IS NULL)),
  CHECK (situacao <> 'descartada' OR motivo_descarte IS NOT NULL),
  CHECK (tipo <> 'explicar_rejeicao' OR evento_id IS NOT NULL)
);
CREATE INDEX sugestao_ia_empresa ON sugestao_ia (empresa_id, situacao, criado_em DESC);

-- A IA não decide: o texto recebido não muda, e só uma pessoa aceita ou descarta, uma única vez.
CREATE OR REPLACE FUNCTION app.regras_sugestao_ia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.texto IS DISTINCT FROM OLD.texto OR NEW.enviado IS DISTINCT FROM OLD.enviado OR NEW.acoes_sugeridas IS DISTINCT FROM OLD.acoes_sugeridas
     OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.modelo IS DISTINCT FROM OLD.modelo THEN
    RAISE EXCEPTION 'A sugestão da IA não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.situacao <> 'pendente' THEN
    RAISE EXCEPTION 'A sugestão já foi decidida' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.situacao <> 'pendente' AND NEW.decidido_por IS DISTINCT FROM app.usuario_atual() THEN
    RAISE EXCEPTION 'A decisão precisa ser de quem está conectado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sugestao_ia_regras BEFORE UPDATE ON sugestao_ia FOR EACH ROW EXECUTE FUNCTION app.regras_sugestao_ia();

ALTER TABLE ia_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY ia_config_tenant ON ia_config USING (tenant_id = app.tenant_atual()) WITH CHECK (tenant_id = app.tenant_atual());
ALTER TABLE sugestao_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY sugestao_ia_empresa ON sugestao_ia
  USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))
  WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id));

-- Auditoria: a chave da API fica fora do registro (como a senha do certificado).
CREATE OR REPLACE FUNCTION app.registrar_auditoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_antes  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_depois jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_ref    jsonb := coalesce(v_depois, v_antes);
  v_fora   text[] := ARRAY['senha_hash', 'mfa_segredo', 'token_hash', 'linhas', 'conteudo', 'pfx_cifrado', 'senha_cifrada', 'xml',
                           'xml_assinado', 'recibo_xml', 'xml_envio', 'retorno_envio', 'retorno_consulta', 'atestado', 'chave_cifrada'];
BEGIN
  v_antes  := v_antes  - v_fora;
  v_depois := v_depois - v_fora;
  IF TG_OP = 'UPDATE' AND v_antes = v_depois THEN
    RETURN NULL;
  END IF;
  INSERT INTO auditoria (tenant_id, usuario_id, empresa_id, tabela, registro_id, operacao, antes, depois, contexto)
  VALUES ((v_ref->>'tenant_id')::uuid, app.usuario_atual(),
          CASE WHEN TG_TABLE_NAME = 'empresa' THEN (v_ref->>'id')::uuid ELSE (v_ref->>'empresa_id')::uuid END,
          TG_TABLE_NAME, coalesce(v_ref->>'id', v_ref->>'aso_exame_id', v_ref->>'empresa_id', v_ref->>'tenant_id'), TG_OP, v_antes, v_depois,
          nullif(current_setting('app.contexto', true), ''));
  RETURN NULL;
END $$;

CREATE TRIGGER ia_config_auditoria AFTER INSERT OR UPDATE OR DELETE ON ia_config FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria();
CREATE TRIGGER sugestao_ia_auditoria AFTER INSERT OR UPDATE OR DELETE ON sugestao_ia FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria();
CREATE TRIGGER ia_config_atualizado BEFORE UPDATE ON ia_config FOR EACH ROW EXECUTE FUNCTION app.tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- Permissão nova nos perfis padrão (igual a PERFIS_PADRAO em packages/shared; um teste confere)
-- ---------------------------------------------------------------------------
INSERT INTO perfil_permissao (perfil_id, tenant_id, permissao)
SELECT p.id, p.tenant_id, n.permissao
  FROM perfil p
  JOIN (VALUES
    ('ADMIN_GERAL', 'ia.usar'), ('ADMIN_EMPRESA', 'ia.usar'), ('ENG_SEGURANCA', 'ia.usar'), ('TEC_SEGURANCA', 'ia.usar'),
    ('MEDICO', 'ia.usar'), ('RH', 'ia.usar'), ('OPERADOR_ESOCIAL', 'ia.usar')
  ) AS n (codigo, permissao) ON n.codigo = p.codigo
 WHERE p.sistema
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    GRANT SELECT, INSERT, UPDATE ON notificacao, ia_config, sugestao_ia TO sst_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON preferencia_notificacao TO sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;
