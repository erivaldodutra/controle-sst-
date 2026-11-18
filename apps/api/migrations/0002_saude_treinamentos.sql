-- Fase 2: médicos, clínicas, exames, ASO, treinamentos, turmas, certificados,
-- matriz de treinamentos por função e GHE, prazos de alerta.
--
-- Dado clínico (resultado de exame complementar) fica numa tabela própria,
-- visível só para quem tem a permissão saude.clinico na empresa. A regra é do
-- banco (RLS), não só da API.

-- ---------------------------------------------------------------------------
-- Contexto: empresas em que o usuário pode ver dado clínico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.clinico_permitido(p_empresa uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.empresas_clinico', true), '') = '*' THEN true
    WHEN coalesce(current_setting('app.empresas_clinico', true), '') = '' THEN false
    ELSE p_empresa = ANY (string_to_array(current_setting('app.empresas_clinico', true), ',')::uuid[])
  END
$$;

-- ---------------------------------------------------------------------------
-- Configuração geral do tenant
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_config (
  tenant_id      uuid PRIMARY KEY REFERENCES tenant(id),
  -- Dias de antecedência para avisar vencimentos (ASO e treinamentos), do maior para o menor.
  alertas_dias   integer[] NOT NULL DEFAULT '{90,60,30,15}'
                 CHECK (cardinality(alertas_dias) BETWEEN 1 AND 6 AND 0 < ALL (alertas_dias) AND 366 > ALL (alertas_dias)),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
INSERT INTO tenant_config (tenant_id) SELECT id FROM tenant;

-- ---------------------------------------------------------------------------
-- Cadastros de saúde (valem para todas as empresas do tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE medico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  nome            text NOT NULL,
  cpf             text CHECK (cpf ~ '^\d{11}$'),
  crm             text NOT NULL CHECK (crm ~ '^\d{1,10}$'),
  uf_crm          char(2) NOT NULL CHECK (uf_crm IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
                                                     'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  email           text,
  telefone        text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  UNIQUE (tenant_id, uf_crm, crm)
);

CREATE TABLE clinica (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  razao_social    text NOT NULL,
  nome_fantasia   text,
  cnpj            text CHECK (cnpj ~ '^\d{14}$'),
  endereco        jsonb NOT NULL DEFAULT '{}',
  telefone        text,
  email           text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  UNIQUE (tenant_id, cnpj)
);

-- Tipos de exame complementar. O código do eSocial (Tabela 27) é informado pelo usuário.
CREATE TABLE exame_tipo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  nome            text NOT NULL,
  codigo_esocial  text CHECK (codigo_esocial ~ '^\d{4}$'),
  descricao       text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  UNIQUE (tenant_id, nome)
);

-- Médico responsável pelo PCMSO da empresa, com vigência (sem sobreposição).
CREATE TABLE medico_coordenador (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  medico_id       uuid NOT NULL REFERENCES medico(id),
  inicio          date NOT NULL,
  fim             date,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  CHECK (fim IS NULL OR fim >= inicio),
  EXCLUDE USING gist (empresa_id WITH =, daterange(inicio, fim, '[]') WITH &&)
);

-- ---------------------------------------------------------------------------
-- Arquivos anexados (guardados no próprio banco, entram no backup criptografado)
-- ---------------------------------------------------------------------------
CREATE TABLE arquivo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  nome            text NOT NULL,
  tipo_mime       text NOT NULL,
  tamanho         integer NOT NULL CHECK (tamanho > 0 AND tamanho <= 10485760),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  conteudo        bytea NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  UNIQUE (id, empresa_id)
);

-- ---------------------------------------------------------------------------
-- ASO
-- tipo segue o eSocial (tpExameOcup): 0 admissional, 1 periódico, 2 retorno ao
-- trabalho, 3 mudança de risco ocupacional, 4 monitoração pontual, 9 demissional.
-- resultado (resAso): 1 apto, 2 inapto.
-- ---------------------------------------------------------------------------
CREATE TABLE aso (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  empresa_id           uuid NOT NULL,
  vinculo_id           uuid NOT NULL,
  tipo                 smallint NOT NULL CHECK (tipo IN (0, 1, 2, 3, 4, 9)),
  data_exame           date NOT NULL,
  resultado            smallint NOT NULL CHECK (resultado IN (1, 2)),
  medico_id            uuid NOT NULL REFERENCES medico(id),
  clinica_id           uuid REFERENCES clinica(id),
  vencimento           date CHECK (vencimento IS NULL OR vencimento > data_exame),
  -- Perigos/fatores de risco do PGR que constam no ASO (NR-7). Digitado até o PGR entrar no sistema (Fase 3).
  riscos               text,
  observacoes          text,
  arquivo_id           uuid,
  cancelado_em         timestamptz,
  cancelado_por        uuid,
  motivo_cancelamento  text,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  criado_por           uuid,
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_por       uuid,
  FOREIGN KEY (vinculo_id, empresa_id) REFERENCES vinculo (id, empresa_id),
  FOREIGN KEY (arquivo_id, empresa_id) REFERENCES arquivo (id, empresa_id),
  CHECK ((cancelado_em IS NULL) = (motivo_cancelamento IS NULL)),
  UNIQUE (id, empresa_id)
);
CREATE INDEX aso_vinculo ON aso (vinculo_id, data_exame DESC) WHERE cancelado_em IS NULL;

-- Exames complementares do ASO. ordem (ordExame): 1 referencial, 2 sequencial.
CREATE TABLE aso_exame (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  empresa_id       uuid NOT NULL,
  aso_id           uuid NOT NULL,
  exame_tipo_id    uuid NOT NULL REFERENCES exame_tipo(id),
  data_realizacao  date NOT NULL,
  ordem            smallint CHECK (ordem IN (1, 2)),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid,
  FOREIGN KEY (aso_id, empresa_id) REFERENCES aso (id, empresa_id) ON DELETE CASCADE,
  UNIQUE (aso_id, exame_tipo_id),
  UNIQUE (id, empresa_id)
);

-- Resultado do exame: dado sensível de saúde (LGPD art. 11).
-- resultado (indResult): 1 normal, 2 alterado, 3 estável, 4 agravamento.
CREATE TABLE aso_exame_resultado (
  aso_exame_id   uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  empresa_id     uuid NOT NULL,
  resultado      smallint CHECK (resultado IN (1, 2, 3, 4)),
  observacao     text,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  FOREIGN KEY (aso_exame_id, empresa_id) REFERENCES aso_exame (id, empresa_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Treinamentos
-- ---------------------------------------------------------------------------
-- Biblioteca: cada treinamento com a norma de referência e a periodicidade de reciclagem.
CREATE TABLE treinamento (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES tenant(id),
  nome                       text NOT NULL,
  norma                      text,
  carga_horaria              numeric(5,1) NOT NULL CHECK (carga_horaria > 0),
  carga_horaria_reciclagem   numeric(5,1) CHECK (carga_horaria_reciclagem > 0),
  periodicidade_meses        smallint CHECK (periodicidade_meses BETWEEN 1 AND 120),
  conteudo_programatico      text,
  ativo                      boolean NOT NULL DEFAULT true,
  criado_em                  timestamptz NOT NULL DEFAULT now(),
  criado_por                 uuid,
  atualizado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_por             uuid,
  UNIQUE (tenant_id, nome)
);

CREATE TABLE turma (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenant(id),
  empresa_id               uuid NOT NULL REFERENCES empresa(id),
  treinamento_id           uuid NOT NULL REFERENCES treinamento(id),
  tipo                     text NOT NULL CHECK (tipo IN ('inicial', 'reciclagem', 'eventual')),
  modalidade               text NOT NULL CHECK (modalidade IN ('presencial', 'ead', 'semipresencial')),
  data_inicio              date NOT NULL,
  data_fim                 date NOT NULL,
  carga_horaria            numeric(5,1) NOT NULL CHECK (carga_horaria > 0),
  instrutor_nome           text NOT NULL,
  instrutor_qualificacao   text,
  responsavel_tecnico      text,
  local                    text,
  situacao                 text NOT NULL DEFAULT 'planejada' CHECK (situacao IN ('planejada', 'realizada', 'cancelada')),
  observacoes              text,
  realizada_em             timestamptz,
  criado_em                timestamptz NOT NULL DEFAULT now(),
  criado_por               uuid,
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_por           uuid,
  CHECK (data_fim >= data_inicio),
  UNIQUE (id, empresa_id)
);

CREATE TABLE turma_participante (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  empresa_id              uuid NOT NULL,
  turma_id                uuid NOT NULL,
  funcionario_id          uuid NOT NULL,
  presente                boolean,
  aprovado                boolean,
  nota                    numeric(5,2),
  -- Preenchidos quando a turma é concluída: a validade fica gravada, mesmo que a biblioteca mude depois.
  validade                date,
  certificado_codigo      text UNIQUE CHECK (certificado_codigo ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  criado_em               timestamptz NOT NULL DEFAULT now(),
  criado_por              uuid,
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_por          uuid,
  FOREIGN KEY (turma_id, empresa_id) REFERENCES turma (id, empresa_id),
  FOREIGN KEY (funcionario_id, empresa_id) REFERENCES funcionario (id, empresa_id),
  CHECK (aprovado IS NOT TRUE OR presente IS TRUE),
  CHECK (certificado_codigo IS NULL OR aprovado IS TRUE),
  UNIQUE (turma_id, funcionario_id)
);
CREATE INDEX turma_participante_funcionario ON turma_participante (funcionario_id);

-- Quais treinamentos cada função ou GHE exige (exatamente um dos dois por linha).
CREATE TABLE matriz_treinamento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  treinamento_id   uuid NOT NULL REFERENCES treinamento(id),
  funcao_id        uuid,
  ghe_id           uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid,
  FOREIGN KEY (funcao_id, empresa_id) REFERENCES funcao (id, empresa_id),
  FOREIGN KEY (ghe_id, empresa_id) REFERENCES ghe (id, empresa_id),
  CHECK ((funcao_id IS NULL) <> (ghe_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (empresa_id, treinamento_id, funcao_id, ghe_id)
);

-- ---------------------------------------------------------------------------
-- Auditoria: conteúdo de arquivo não vai para o registro (só nome, tamanho e hash).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.registrar_auditoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_antes  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_depois jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_ref    jsonb := coalesce(v_depois, v_antes);
BEGIN
  -- Campos secretos e conteúdo binário nunca vão para a auditoria.
  v_antes  := v_antes  - 'senha_hash' - 'mfa_segredo' - 'token_hash' - 'linhas' - 'conteudo';
  v_depois := v_depois - 'senha_hash' - 'mfa_segredo' - 'token_hash' - 'linhas' - 'conteudo';
  IF TG_OP = 'UPDATE' AND v_antes = v_depois THEN
    RETURN NULL;
  END IF;
  INSERT INTO auditoria (tenant_id, usuario_id, empresa_id, tabela, registro_id, operacao, antes, depois, contexto)
  VALUES ((v_ref->>'tenant_id')::uuid, app.usuario_atual(),
          CASE WHEN TG_TABLE_NAME = 'empresa' THEN (v_ref->>'id')::uuid ELSE (v_ref->>'empresa_id')::uuid END,
          TG_TABLE_NAME, coalesce(v_ref->>'id', v_ref->>'aso_exame_id', v_ref->>'tenant_id'), TG_OP, v_antes, v_depois,
          nullif(current_setting('app.contexto', true), ''));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_config','medico','clinica','exame_tipo','medico_coordenador','arquivo','aso',
                           'aso_exame','aso_exame_resultado','treinamento','turma','turma_participante','matriz_treinamento']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['tenant_config','medico','clinica','exame_tipo','aso','aso_exame_resultado',
                           'treinamento','turma','turma_participante']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_atualizado BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.tocar_atualizado_em()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_config','medico','clinica','exame_tipo','treinamento']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id = app.tenant_atual())
                    WITH CHECK (tenant_id = app.tenant_atual())', t, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['medico_coordenador','arquivo','aso','aso_exame','turma','turma_participante','matriz_treinamento']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_empresa ON %I
                    USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))
                    WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))', t, t);
  END LOOP;
END $$;

ALTER TABLE aso_exame_resultado ENABLE ROW LEVEL SECURITY;
CREATE POLICY aso_exame_resultado_clinico ON aso_exame_resultado
  USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id) AND app.clinico_permitido(empresa_id))
  WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id) AND app.clinico_permitido(empresa_id));

-- Auditoria de resultado de exame só para quem pode ver dado clínico daquela empresa.
DROP POLICY auditoria_leitura ON auditoria;
CREATE POLICY auditoria_leitura ON auditoria FOR SELECT
  USING (tenant_id = app.tenant_atual()
         AND (empresa_id IS NULL OR app.empresa_permitida(empresa_id))
         AND (tabela <> 'aso_exame_resultado' OR app.clinico_permitido(empresa_id)));

-- A configuração do tenant nasce junto com ele.
CREATE OR REPLACE FUNCTION app.criar_tenant_config() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  INSERT INTO tenant_config (tenant_id) VALUES (NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER tenant_config_inicial AFTER INSERT ON tenant FOR EACH ROW EXECUTE FUNCTION app.criar_tenant_config();

-- ---------------------------------------------------------------------------
-- Permissões novas nos perfis padrão já existentes (instalações da Fase 1).
-- Mantida igual a PERFIS_PADRAO em packages/shared (um teste confere).
-- ---------------------------------------------------------------------------
INSERT INTO perfil_permissao (perfil_id, tenant_id, permissao)
SELECT p.id, p.tenant_id, n.permissao
  FROM perfil p
  JOIN (VALUES
    ('ADMIN_GERAL', 'saude.ler'), ('ADMIN_GERAL', 'saude.editar'),
    ('ADMIN_GERAL', 'treinamentos.ler'), ('ADMIN_GERAL', 'treinamentos.editar'), ('ADMIN_GERAL', 'sistema.configurar'),
    ('ADMIN_EMPRESA', 'saude.ler'), ('ADMIN_EMPRESA', 'saude.editar'),
    ('ADMIN_EMPRESA', 'treinamentos.ler'), ('ADMIN_EMPRESA', 'treinamentos.editar'),
    ('ENG_SEGURANCA', 'saude.ler'), ('ENG_SEGURANCA', 'treinamentos.ler'), ('ENG_SEGURANCA', 'treinamentos.editar'),
    ('TEC_SEGURANCA', 'saude.ler'), ('TEC_SEGURANCA', 'treinamentos.ler'), ('TEC_SEGURANCA', 'treinamentos.editar'),
    ('MEDICO', 'saude.ler'), ('MEDICO', 'saude.editar'), ('MEDICO', 'saude.clinico'), ('MEDICO', 'treinamentos.ler'),
    ('RH', 'saude.ler'), ('RH', 'saude.editar'), ('RH', 'treinamentos.ler'), ('RH', 'treinamentos.editar'),
    ('OPERADOR_ESOCIAL', 'saude.ler'), ('OPERADOR_ESOCIAL', 'treinamentos.ler'),
    ('VISUALIZADOR', 'saude.ler'), ('VISUALIZADOR', 'treinamentos.ler')
  ) AS n (codigo, permissao) ON n.codigo = p.codigo
 WHERE p.sistema
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Permissões do papel da aplicação nas tabelas novas
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_config, medico, clinica, exame_tipo, medico_coordenador,
          aso_exame, aso_exame_resultado, treinamento, turma, turma_participante, matriz_treinamento TO sst_app;
    -- ASO não é apagado: é cancelado com motivo. Arquivo não é alterado.
    GRANT SELECT, INSERT, UPDATE ON aso TO sst_app;
    GRANT SELECT, INSERT, DELETE ON arquivo TO sst_app;
    REVOKE INSERT, DELETE ON tenant_config FROM sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;
