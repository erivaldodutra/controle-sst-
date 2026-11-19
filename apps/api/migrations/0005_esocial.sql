-- Fase 5: eSocial S-2210, S-2220, S-2240 e S-3000 (leiaute S-1.3).
--
-- Regras garantidas pelo banco (não só pela API):
--   * evento só vai para aprovado/enviado com XML assinado e aprovação de uma pessoa;
--   * evento só fica "processado" com número de recibo do eSocial;
--   * evento aprovado não muda de conteúdo; processado só pode ser excluído (S-3000);
--   * lote e eventos sempre do mesmo ambiente (produção restrita x produção);
--   * produção só é liberada depois de evento processado na produção restrita;
--   * o certificado A1 fica cifrado e é apagado ao ser desativado.

-- ---------------------------------------------------------------------------
-- Tabelas oficiais do eSocial (dados públicos, iguais para todos os tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE esocial_tabela (
  tabela     smallint NOT NULL,
  codigo     text NOT NULL,
  descricao  text NOT NULL,
  grupo      text,
  aplicacao  text,
  versao     text NOT NULL,
  inicio     date,
  fim        date,
  PRIMARY KEY (tabela, codigo, versao),
  CHECK (fim IS NULL OR inicio IS NULL OR fim >= inicio)
);

-- ---------------------------------------------------------------------------
-- Configuração por empresa
-- ---------------------------------------------------------------------------
CREATE TABLE esocial_config (
  empresa_id               uuid PRIMARY KEY REFERENCES empresa(id),
  tenant_id                uuid NOT NULL REFERENCES tenant(id),
  -- 1 produção, 2 produção restrita (testes). Começa sempre na produção restrita.
  ambiente                 smallint NOT NULL DEFAULT 2 CHECK (ambiente IN (1, 2)),
  inicio_obrigatoriedade   date,
  transmissor_tipo         smallint CHECK (transmissor_tipo IN (1, 2)),
  transmissor_inscricao    text CHECK (transmissor_inscricao ~ '^\d{11}$|^\d{14}$'),
  -- Certificados públicos de autoridades (PEM) a confiar na conexão, ex.: cadeia da ICP-Brasil.
  cadeia_ca                text,
  producao_liberada_em     timestamptz,
  producao_liberada_por    uuid,
  criado_em                timestamptz NOT NULL DEFAULT now(),
  criado_por               uuid,
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_por           uuid,
  CHECK (ambiente = 2 OR producao_liberada_em IS NOT NULL)
);

-- Certificado digital A1 (.pfx). O conteúdo e a senha ficam cifrados com a chave de dados
-- do sistema (que por sua vez é protegida pelo Windows). Nunca é devolvido pela API.
CREATE TABLE esocial_certificado (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  empresa_id         uuid NOT NULL REFERENCES empresa(id),
  titular            text NOT NULL,
  documento          text,
  emissor            text NOT NULL,
  numero_serie       text NOT NULL,
  impressao_digital  text NOT NULL CHECK (impressao_digital ~ '^[0-9a-f]{64}$'),
  valido_de          timestamptz NOT NULL,
  valido_ate         timestamptz NOT NULL,
  pfx_cifrado        text,
  senha_cifrada      text,
  ativo              boolean NOT NULL DEFAULT true,
  desativado_em      timestamptz,
  desativado_por     uuid,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  criado_por         uuid,
  CHECK (ativo = (pfx_cifrado IS NOT NULL AND senha_cifrada IS NOT NULL)),
  CHECK (ativo = (desativado_em IS NULL))
);
CREATE UNIQUE INDEX esocial_certificado_ativo ON esocial_certificado (empresa_id) WHERE ativo;

-- ---------------------------------------------------------------------------
-- S-2240: agentes nocivos por GHE e responsáveis pelos registros ambientais
-- ---------------------------------------------------------------------------
CREATE TABLE agente_nocivo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  empresa_id    uuid NOT NULL,
  ghe_id        uuid NOT NULL,
  codigo        text NOT NULL CHECK (codigo ~ '^\d{2}\.\d{2}\.\d{3}$'),
  descricao     text,
  tp_aval       smallint CHECK (tp_aval IN (1, 2)),
  int_conc      numeric,
  lim_tol       numeric,
  un_med        smallint CHECK (un_med BETWEEN 1 AND 30),
  tec_medicao   text,
  nr_proc_jud   text,
  utiliz_epc    smallint CHECK (utiliz_epc IN (0, 1, 2)),
  efic_epc      char(1) CHECK (efic_epc IN ('S', 'N')),
  utiliz_epi    smallint CHECK (utiliz_epi IN (0, 1, 2)),
  efic_epi      char(1) CHECK (efic_epi IN ('S', 'N')),
  epis          text[] NOT NULL DEFAULT '{}',
  epi_compl     jsonb,
  inicio        date NOT NULL,
  fim           date,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  FOREIGN KEY (ghe_id, empresa_id) REFERENCES ghe (id, empresa_id),
  CHECK (fim IS NULL OR fim >= inicio),
  EXCLUDE USING gist (ghe_id WITH =, codigo WITH =, daterange(inicio, fim, '[]') WITH &&)
);
CREATE INDEX agente_nocivo_ghe ON agente_nocivo (ghe_id);

CREATE TABLE responsavel_ambiental (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  nome           text NOT NULL,
  cpf            text NOT NULL CHECK (cpf ~ '^\d{11}$'),
  ide_oc         smallint NOT NULL CHECK (ide_oc IN (1, 4, 9)),
  dsc_oc         text,
  nr_oc          text NOT NULL,
  uf_oc          char(2) NOT NULL,
  inicio         date NOT NULL,
  fim            date,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  CHECK ((ide_oc = 9) = (dsc_oc IS NOT NULL)),
  CHECK (fim IS NULL OR fim >= inicio)
);

-- ---------------------------------------------------------------------------
-- S-2210: dados da CAT ligados à ocorrência. O atestado (CID, diagnóstico) é
-- dado sensível de saúde e só é lido/gravado por quem tem saude.clinico.
-- ---------------------------------------------------------------------------
CREATE TABLE cat (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  empresa_id     uuid NOT NULL,
  ocorrencia_id  uuid NOT NULL,
  vinculo_id     uuid NOT NULL,
  tp_cat         smallint NOT NULL CHECK (tp_cat IN (1, 2, 3)),
  dados          jsonb NOT NULL,
  atestado       jsonb,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  FOREIGN KEY (ocorrencia_id, empresa_id) REFERENCES ocorrencia (id, empresa_id),
  FOREIGN KEY (vinculo_id, empresa_id) REFERENCES vinculo (id, empresa_id),
  UNIQUE (id, empresa_id)
);
CREATE INDEX cat_ocorrencia ON cat (ocorrencia_id);

-- ---------------------------------------------------------------------------
-- Lotes e eventos
-- ---------------------------------------------------------------------------
CREATE SEQUENCE esocial_id_seq MINVALUE 1 MAXVALUE 99999 CYCLE;

CREATE TABLE esocial_lote (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  ambiente          smallint NOT NULL CHECK (ambiente IN (1, 2)),
  grupo             smallint NOT NULL DEFAULT 2 CHECK (grupo IN (1, 2, 3)),
  situacao          text NOT NULL CHECK (situacao IN ('enviando', 'aguardando', 'processado', 'recusado', 'rejeitado', 'falha_comunicacao')),
  protocolo         text,
  xml_envio         text NOT NULL,
  cd_resposta       integer,
  desc_resposta     text,
  ocorrencias       jsonb NOT NULL DEFAULT '[]',
  retorno_envio     text,
  retorno_consulta  text,
  enviado_em        timestamptz NOT NULL DEFAULT now(),
  enviado_por       uuid NOT NULL,
  enviado_por_nome  text NOT NULL,
  consultas         integer NOT NULL DEFAULT 0,
  consultado_em     timestamptz,
  processado_em     timestamptz,
  UNIQUE (id, empresa_id),
  CHECK (situacao NOT IN ('aguardando', 'processado', 'rejeitado') OR protocolo IS NOT NULL),
  CHECK ((situacao = 'processado') = (processado_em IS NOT NULL))
);
CREATE INDEX esocial_lote_empresa ON esocial_lote (empresa_id, enviado_em DESC);

CREATE TABLE esocial_evento (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  empresa_id           uuid NOT NULL REFERENCES empresa(id),
  tipo                 text NOT NULL CHECK (tipo IN ('S-2210', 'S-2220', 'S-2240', 'S-3000')),
  id_evento            text NOT NULL UNIQUE CHECK (id_evento ~ '^ID[12]\d{14}\d{14}\d{5}$'),
  ambiente             smallint NOT NULL CHECK (ambiente IN (1, 2)),
  ind_retif            smallint NOT NULL DEFAULT 1 CHECK (ind_retif IN (1, 2)),
  -- Retificação (S-2210/2220/2240 com indRetif 2) ou exclusão (S-3000): o evento original.
  evento_origem_id     uuid REFERENCES esocial_evento(id),
  vinculo_id           uuid,
  aso_id               uuid,
  lotacao_id           uuid,
  cat_id               uuid,
  referencia           date NOT NULL,
  resumo               text NOT NULL,
  xml                  text NOT NULL,
  -- Quando o XML foi montado pela última vez a partir dos cadastros.
  gerado_em            timestamptz NOT NULL DEFAULT now(),
  erros                jsonb NOT NULL DEFAULT '[]',
  situacao             text NOT NULL CHECK (situacao IN ('invalido', 'pendente', 'aprovado', 'enviado', 'processado', 'rejeitado', 'cancelado', 'excluido')),
  xml_assinado         text,
  aprovado_em          timestamptz,
  aprovado_por         uuid,
  aprovado_por_nome    text,
  lote_id              uuid,
  nr_recibo            text CHECK (nr_recibo ~ '^1\.\d\.\d{19}$'),
  recibo_xml           text,
  cd_resposta          integer,
  ocorrencias          jsonb NOT NULL DEFAULT '[]',
  processado_em        timestamptz,
  cancelado_em         timestamptz,
  cancelado_por        uuid,
  motivo_cancelamento  text,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  criado_por           uuid,
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_por       uuid,
  FOREIGN KEY (vinculo_id, empresa_id) REFERENCES vinculo (id, empresa_id),
  FOREIGN KEY (aso_id, empresa_id) REFERENCES aso (id, empresa_id),
  FOREIGN KEY (cat_id, empresa_id) REFERENCES cat (id, empresa_id),
  FOREIGN KEY (lote_id, empresa_id) REFERENCES esocial_lote (id, empresa_id),
  CHECK (ind_retif = 1 OR evento_origem_id IS NOT NULL),
  CHECK (tipo <> 'S-3000' OR evento_origem_id IS NOT NULL),
  CHECK ((nr_recibo IS NOT NULL) = (situacao IN ('processado', 'excluido'))),
  CHECK ((situacao IN ('processado', 'excluido')) = (processado_em IS NOT NULL)),
  CHECK (situacao NOT IN ('aprovado', 'enviado', 'processado', 'rejeitado', 'excluido')
         OR (xml_assinado IS NOT NULL AND aprovado_em IS NOT NULL AND aprovado_por IS NOT NULL AND aprovado_por_nome IS NOT NULL)),
  CHECK (situacao <> 'enviado' OR lote_id IS NOT NULL),
  CHECK ((situacao = 'cancelado') = (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL))
);
CREATE INDEX esocial_evento_empresa ON esocial_evento (empresa_id, situacao, criado_em DESC);
CREATE INDEX esocial_evento_aso ON esocial_evento (aso_id) WHERE aso_id IS NOT NULL;
CREATE INDEX esocial_evento_vinculo ON esocial_evento (vinculo_id) WHERE vinculo_id IS NOT NULL;
CREATE INDEX esocial_evento_cat ON esocial_evento (cat_id) WHERE cat_id IS NOT NULL;
CREATE INDEX esocial_evento_lote ON esocial_evento (lote_id) WHERE lote_id IS NOT NULL;

-- Todo envio de cada evento (um evento pode ir em mais de um lote se houve falha de comunicação).
CREATE TABLE esocial_lote_evento (
  lote_id     uuid NOT NULL REFERENCES esocial_lote(id),
  evento_id   uuid NOT NULL REFERENCES esocial_evento(id),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  PRIMARY KEY (lote_id, evento_id)
);

-- Transições permitidas do evento.
CREATE OR REPLACE FUNCTION app.regras_evento_esocial() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  permitido text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.situacao NOT IN ('invalido', 'pendente') THEN
      RAISE EXCEPTION 'Evento novo começa com erros ou aguardando aprovação' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  permitido := CASE OLD.situacao
    WHEN 'invalido'   THEN ARRAY['invalido', 'pendente', 'cancelado']
    WHEN 'pendente'   THEN ARRAY['pendente', 'invalido', 'aprovado', 'cancelado']
    WHEN 'aprovado'   THEN ARRAY['aprovado', 'pendente', 'enviado', 'cancelado']
    WHEN 'enviado'    THEN ARRAY['enviado', 'aprovado', 'processado', 'rejeitado']
    WHEN 'rejeitado'  THEN ARRAY['rejeitado', 'cancelado']
    WHEN 'processado' THEN ARRAY['processado', 'excluido']
    ELSE ARRAY[OLD.situacao]
  END;
  IF NOT (NEW.situacao = ANY (permitido)) OR (OLD.situacao IN ('cancelado', 'excluido') AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Evento % (%): mudança de "%" para "%" não é permitida', NEW.tipo, NEW.id_evento, OLD.situacao, NEW.situacao
      USING ERRCODE = 'P0001';
  END IF;
  -- Conteúdo fixo depois da aprovação.
  IF OLD.situacao NOT IN ('invalido', 'pendente') AND NEW.situacao <> 'pendente'
     AND (NEW.xml IS DISTINCT FROM OLD.xml OR NEW.xml_assinado IS DISTINCT FROM OLD.xml_assinado
          OR NEW.id_evento IS DISTINCT FROM OLD.id_evento OR NEW.ambiente IS DISTINCT FROM OLD.ambiente) THEN
    RAISE EXCEPTION 'Evento aprovado não pode ter o conteúdo alterado' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id_evento IS DISTINCT FROM OLD.id_evento OR NEW.ambiente IS DISTINCT FROM OLD.ambiente
     OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'Identificação do evento não muda' USING ERRCODE = 'P0001';
  END IF;
  -- Desaprovar limpa a assinatura.
  IF NEW.situacao = 'pendente' AND OLD.situacao = 'aprovado' AND NEW.xml_assinado IS NOT NULL THEN
    RAISE EXCEPTION 'Ao desfazer a aprovação a assinatura deve ser descartada' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.lote_id IS NOT NULL AND NEW.lote_id IS DISTINCT FROM OLD.lote_id
     AND (SELECT l.ambiente FROM esocial_lote l WHERE l.id = NEW.lote_id) <> NEW.ambiente THEN
    RAISE EXCEPTION 'O lote e o evento precisam ser do mesmo ambiente' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER esocial_evento_regras BEFORE INSERT OR UPDATE ON esocial_evento FOR EACH ROW EXECUTE FUNCTION app.regras_evento_esocial();

-- Lote de produção só com a produção liberada para a empresa.
CREATE OR REPLACE FUNCTION app.regras_lote_esocial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ambiente = 1 AND NOT EXISTS (
       SELECT 1 FROM esocial_config c WHERE c.empresa_id = NEW.empresa_id AND c.producao_liberada_em IS NOT NULL AND c.ambiente = 1) THEN
    RAISE EXCEPTION 'A produção do eSocial ainda não está liberada para esta empresa' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.ambiente IS DISTINCT FROM OLD.ambiente OR NEW.xml_envio IS DISTINCT FROM OLD.xml_envio
                           OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id) THEN
    RAISE EXCEPTION 'O conteúdo do lote não muda depois do envio' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.situacao IN ('processado', 'recusado', 'rejeitado', 'falha_comunicacao') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Lote já finalizado' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER esocial_lote_regras BEFORE INSERT OR UPDATE ON esocial_lote FOR EACH ROW EXECUTE FUNCTION app.regras_lote_esocial();

-- Liberar a produção exige pelo menos um evento processado (com recibo) na produção restrita.
CREATE OR REPLACE FUNCTION app.regras_config_esocial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.producao_liberada_em IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.producao_liberada_em IS NULL)
     AND NOT EXISTS (SELECT 1 FROM esocial_evento e WHERE e.empresa_id = NEW.empresa_id AND e.ambiente = 2
                       AND e.situacao IN ('processado', 'excluido') AND e.nr_recibo IS NOT NULL) THEN
    RAISE EXCEPTION 'A produção só é liberada depois de pelo menos um evento aceito (com recibo) na produção restrita'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER esocial_config_regras BEFORE INSERT OR UPDATE ON esocial_config FOR EACH ROW EXECUTE FUNCTION app.regras_config_esocial();

-- Certificado: só pode ser desativado (e o conteúdo apagado); nunca reativado ou trocado.
CREATE OR REPLACE FUNCTION app.regras_certificado_esocial() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT OLD.ativo OR NEW.ativo OR NEW.pfx_cifrado IS NOT NULL OR NEW.senha_cifrada IS NOT NULL
     OR NEW.impressao_digital IS DISTINCT FROM OLD.impressao_digital OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'O certificado só pode ser desativado (o conteúdo é apagado)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER esocial_certificado_regras BEFORE UPDATE ON esocial_certificado FOR EACH ROW EXECUTE FUNCTION app.regras_certificado_esocial();

-- ---------------------------------------------------------------------------
-- Auditoria: segredos, conteúdo de arquivos, XMLs grandes e o atestado da CAT não vão para o registro.
-- (Mesma função da 0002, com os campos novos.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.registrar_auditoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_antes  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_depois jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_ref    jsonb := coalesce(v_depois, v_antes);
  v_fora   text[] := ARRAY['senha_hash', 'mfa_segredo', 'token_hash', 'linhas', 'conteudo', 'pfx_cifrado', 'senha_cifrada', 'xml',
                           'xml_assinado', 'recibo_xml', 'xml_envio', 'retorno_envio', 'retorno_consulta', 'atestado'];
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

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['esocial_config','esocial_certificado','agente_nocivo','responsavel_ambiental','cat','esocial_lote','esocial_evento']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['esocial_config','agente_nocivo','responsavel_ambiental','cat','esocial_evento']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_atualizado BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.tocar_atualizado_em()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['esocial_config','esocial_certificado','agente_nocivo','responsavel_ambiental','cat','esocial_lote',
                           'esocial_evento','esocial_lote_evento']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_empresa ON %I
                    USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))
                    WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Permissões novas nos perfis padrão já existentes.
-- Mantida igual a PERFIS_PADRAO em packages/shared (um teste confere).
-- ---------------------------------------------------------------------------
INSERT INTO perfil_permissao (perfil_id, tenant_id, permissao)
SELECT p.id, p.tenant_id, n.permissao
  FROM perfil p
  JOIN (VALUES
    ('ADMIN_GERAL', 'esocial.ler'), ('ADMIN_GERAL', 'esocial.preparar'), ('ADMIN_GERAL', 'esocial.transmitir'), ('ADMIN_GERAL', 'esocial.configurar'),
    ('ADMIN_EMPRESA', 'esocial.ler'), ('ADMIN_EMPRESA', 'esocial.preparar'), ('ADMIN_EMPRESA', 'esocial.transmitir'), ('ADMIN_EMPRESA', 'esocial.configurar'),
    ('ENG_SEGURANCA', 'esocial.ler'), ('ENG_SEGURANCA', 'esocial.preparar'),
    ('TEC_SEGURANCA', 'esocial.ler'), ('TEC_SEGURANCA', 'esocial.preparar'),
    ('MEDICO', 'esocial.ler'), ('MEDICO', 'esocial.preparar'),
    ('RH', 'esocial.ler'), ('RH', 'esocial.preparar'),
    ('OPERADOR_ESOCIAL', 'esocial.ler'), ('OPERADOR_ESOCIAL', 'esocial.preparar'), ('OPERADOR_ESOCIAL', 'esocial.transmitir'),
    ('VISUALIZADOR', 'esocial.ler')
  ) AS n (codigo, permissao) ON n.codigo = p.codigo
 WHERE p.sistema
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    GRANT SELECT ON esocial_tabela TO sst_app;
    GRANT SELECT, INSERT, UPDATE ON esocial_config, esocial_certificado, cat, esocial_lote, esocial_evento TO sst_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agente_nocivo, responsavel_ambiental TO sst_app;
    GRANT SELECT, INSERT ON esocial_lote_evento TO sst_app;
    GRANT USAGE ON SEQUENCE esocial_id_seq TO sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;
