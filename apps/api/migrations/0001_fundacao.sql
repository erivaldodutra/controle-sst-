-- Fase 1: fundação, acesso, empresas, estrutura e funcionários.
-- Executada pelo papel dono do banco (sst_owner). A aplicação conecta como
-- sst_app, que não é dono das tabelas e por isso sempre passa pelo RLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- Contexto da requisição (preenchido pela API com SET LOCAL em cada transação)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tenant_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.usuario_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;

-- Empresas permitidas ao usuário: '*' = todas do tenant; senão lista de UUIDs separados por vírgula.
CREATE OR REPLACE FUNCTION app.empresa_permitida(p_empresa uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.empresas', true), '') = '*' THEN true
    WHEN coalesce(current_setting('app.empresas', true), '') = '' THEN false
    ELSE p_empresa = ANY (string_to_array(current_setting('app.empresas', true), ',')::uuid[])
  END
$$;

CREATE OR REPLACE FUNCTION app.tocar_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  NEW.atualizado_por := app.usuario_atual();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Tenant e acesso
-- ---------------------------------------------------------------------------
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  nome               text NOT NULL,
  email              text NOT NULL,
  senha_hash         text NOT NULL,
  ativo              boolean NOT NULL DEFAULT true,
  deve_trocar_senha  boolean NOT NULL DEFAULT false,
  mfa_segredo        text,               -- criptografado pela aplicação
  mfa_ativo          boolean NOT NULL DEFAULT false,
  tentativas_falhas  integer NOT NULL DEFAULT 0,
  bloqueado_ate      timestamptz,
  ultimo_acesso_em   timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  criado_por         uuid,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por     uuid,
  CONSTRAINT usuario_email_minusculo CHECK (email = lower(email))
);
CREATE UNIQUE INDEX usuario_email_uq ON usuario (email);

CREATE TABLE perfil (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  codigo     text NOT NULL,
  nome       text NOT NULL,
  sistema    boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE perfil_permissao (
  perfil_id  uuid NOT NULL REFERENCES perfil(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  permissao  text NOT NULL,
  PRIMARY KEY (perfil_id, permissao)
);

-- ---------------------------------------------------------------------------
-- Empresas e estabelecimentos
-- ---------------------------------------------------------------------------
CREATE TABLE empresa (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  tipo_inscricao            smallint NOT NULL CHECK (tipo_inscricao IN (1, 2)),
  inscricao                 text NOT NULL CHECK (inscricao ~ '^\d{11}$|^\d{14}$'),
  razao_social              text NOT NULL,
  nome_fantasia             text,
  cnae_principal            text CHECK (cnae_principal ~ '^\d{7}$'),
  cnaes_secundarios         text[] NOT NULL DEFAULT '{}',
  grau_risco                smallint CHECK (grau_risco BETWEEN 1 AND 4),
  natureza_juridica         text CHECK (natureza_juridica ~ '^\d{4}$'),
  classificacao_tributaria  text CHECK (classificacao_tributaria ~ '^\d{2}$'),
  endereco                  jsonb NOT NULL DEFAULT '{}',
  responsavel_nome          text,
  responsavel_cpf           text CHECK (responsavel_cpf ~ '^\d{11}$'),
  responsavel_email         text,
  responsavel_telefone      text,
  contato_email             text,
  contato_telefone          text,
  observacoes               text,
  ativo                     boolean NOT NULL DEFAULT true,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  criado_por                uuid,
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_por            uuid,
  UNIQUE (tenant_id, inscricao)
);

CREATE TABLE usuario_atribuicao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  usuario_id  uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  perfil_id   uuid NOT NULL REFERENCES perfil(id),
  empresa_id  uuid REFERENCES empresa(id),   -- NULL = todas as empresas do tenant
  UNIQUE NULLS NOT DISTINCT (usuario_id, perfil_id, empresa_id)
);

CREATE TABLE sessao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  usuario_id     uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em  timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  revogada_em    timestamptz,
  ip             text,
  agente         text
);

CREATE TABLE estabelecimento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  tipo_inscricao  smallint NOT NULL CHECK (tipo_inscricao IN (1, 3, 4)),
  inscricao       text NOT NULL CHECK (inscricao ~ '^\d{12,14}$'),
  nome            text NOT NULL,
  matriz          boolean NOT NULL DEFAULT false,
  cnae            text CHECK (cnae ~ '^\d{7}$'),
  grau_risco      smallint CHECK (grau_risco BETWEEN 1 AND 4),
  endereco        jsonb NOT NULL DEFAULT '{}',
  observacoes     text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  UNIQUE (empresa_id, tipo_inscricao, inscricao),
  UNIQUE (id, empresa_id)
);
CREATE UNIQUE INDEX estabelecimento_uma_matriz ON estabelecimento (empresa_id) WHERE matriz;

-- ---------------------------------------------------------------------------
-- Estrutura organizacional
-- ---------------------------------------------------------------------------
CREATE TABLE setor (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  empresa_id          uuid NOT NULL,
  estabelecimento_id  uuid NOT NULL,
  nome                text NOT NULL,
  descricao           text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_por      uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  UNIQUE (estabelecimento_id, nome),
  UNIQUE (id, empresa_id)
);

CREATE TABLE cargo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  nome            text NOT NULL,
  cbo             text CHECK (cbo ~ '^\d{6}$'),
  descricao       text,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  UNIQUE (empresa_id, nome),
  UNIQUE (id, empresa_id)
);

CREATE TABLE funcao (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  empresa_id           uuid NOT NULL REFERENCES empresa(id),
  nome                 text NOT NULL,
  cbo                  text CHECK (cbo ~ '^\d{6}$'),
  descricao_atividades text,
  ativo                boolean NOT NULL DEFAULT true,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  criado_por           uuid,
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_por       uuid,
  UNIQUE (empresa_id, nome),
  UNIQUE (id, empresa_id)
);

CREATE TABLE ghe (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  empresa_id          uuid NOT NULL,
  estabelecimento_id  uuid NOT NULL,
  codigo              text NOT NULL,
  nome                text NOT NULL,
  descricao           text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_por      uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  UNIQUE (estabelecimento_id, codigo),
  UNIQUE (id, empresa_id)
);

-- ---------------------------------------------------------------------------
-- Funcionários: pessoa (por empresa), vínculo, lotação com vigência
-- ---------------------------------------------------------------------------
CREATE TABLE funcionario (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  nome             text NOT NULL,
  cpf              text NOT NULL CHECK (cpf ~ '^\d{11}$'),
  data_nascimento  date,
  sexo             char(1) CHECK (sexo IN ('M', 'F')),
  email            text,
  telefone         text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid,
  UNIQUE (empresa_id, cpf),
  UNIQUE (id, empresa_id)
);

CREATE TABLE vinculo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  empresa_id         uuid NOT NULL,
  funcionario_id     uuid NOT NULL,
  matricula          text NOT NULL,
  data_admissao      date NOT NULL,
  data_desligamento  date,
  motivo_desligamento text,
  categoria          text CHECK (categoria ~ '^\d{3}$'),
  tipo_contrato      smallint CHECK (tipo_contrato IN (1, 2, 3)),
  jornada            text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  criado_por         uuid,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por     uuid,
  FOREIGN KEY (funcionario_id, empresa_id) REFERENCES funcionario (id, empresa_id),
  UNIQUE (empresa_id, matricula),
  UNIQUE (id, empresa_id),
  CHECK (data_desligamento IS NULL OR data_desligamento >= data_admissao)
);

-- Cada período em que o vínculo ocupou uma posição. Nunca é sobrescrito:
-- uma movimentação fecha o período atual (fim) e abre outro.
CREATE TABLE lotacao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  empresa_id          uuid NOT NULL,
  vinculo_id          uuid NOT NULL,
  estabelecimento_id  uuid NOT NULL,
  setor_id            uuid,
  cargo_id            uuid,
  funcao_id           uuid,
  ghe_id              uuid,
  inicio              date NOT NULL,
  fim                 date,
  motivo              text NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid,
  FOREIGN KEY (vinculo_id, empresa_id) REFERENCES vinculo (id, empresa_id),
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  FOREIGN KEY (setor_id, empresa_id) REFERENCES setor (id, empresa_id),
  FOREIGN KEY (cargo_id, empresa_id) REFERENCES cargo (id, empresa_id),
  FOREIGN KEY (funcao_id, empresa_id) REFERENCES funcao (id, empresa_id),
  FOREIGN KEY (ghe_id, empresa_id) REFERENCES ghe (id, empresa_id),
  CHECK (fim IS NULL OR fim >= inicio),
  EXCLUDE USING gist (vinculo_id WITH =, daterange(inicio, fim, '[]') WITH &&)
);

CREATE TABLE afastamento (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  empresa_id   uuid NOT NULL,
  vinculo_id   uuid NOT NULL,
  inicio       date NOT NULL,
  fim          date,
  motivo       text NOT NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  criado_por   uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  FOREIGN KEY (vinculo_id, empresa_id) REFERENCES vinculo (id, empresa_id),
  CHECK (fim IS NULL OR fim >= inicio),
  EXCLUDE USING gist (vinculo_id WITH =, daterange(inicio, fim, '[]') WITH &&)
);

CREATE TABLE importacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  tipo           text NOT NULL,
  arquivo_nome   text NOT NULL,
  situacao       text NOT NULL CHECK (situacao IN ('pre_visualizada', 'confirmada', 'descartada')),
  total_linhas   integer NOT NULL,
  linhas_validas integer NOT NULL,
  erros          jsonb NOT NULL DEFAULT '[]',
  linhas         jsonb NOT NULL DEFAULT '[]',   -- linhas válidas normalizadas, aguardando confirmação
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  confirmada_em  timestamptz
);

-- Situação do vínculo derivada das datas; nunca digitada.
CREATE VIEW vinculo_situacao WITH (security_invoker = true) AS
SELECT v.id AS vinculo_id,
       CASE
         WHEN v.data_desligamento IS NOT NULL AND v.data_desligamento < current_date THEN 'desligado'
         WHEN EXISTS (SELECT 1 FROM afastamento a
                       WHERE a.vinculo_id = v.id AND a.inicio <= current_date
                         AND (a.fim IS NULL OR a.fim >= current_date)) THEN 'afastado'
         WHEN v.data_admissao > current_date THEN 'admissao_futura'
         ELSE 'ativo'
       END AS situacao
FROM vinculo v;

-- ---------------------------------------------------------------------------
-- Auditoria: somente inserção, preenchida por gatilho em todas as tabelas
-- ---------------------------------------------------------------------------
CREATE TABLE auditoria (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid,
  usuario_id   uuid,
  empresa_id   uuid,
  tabela       text NOT NULL,
  registro_id  text,
  operacao     text NOT NULL,
  antes        jsonb,
  depois       jsonb,
  contexto     text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_tenant_data ON auditoria (tenant_id, criado_em DESC);
CREATE INDEX auditoria_registro ON auditoria (tabela, registro_id);

CREATE OR REPLACE FUNCTION app.auditoria_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O registro de auditoria não pode ser alterado nem excluído';
END $$;
CREATE TRIGGER auditoria_sem_update BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION app.auditoria_imutavel();

CREATE OR REPLACE FUNCTION app.registrar_auditoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_antes  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_depois jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_ref    jsonb := coalesce(v_depois, v_antes);
BEGIN
  -- Campos secretos nunca vão para a auditoria.
  v_antes  := v_antes  - 'senha_hash' - 'mfa_segredo' - 'token_hash' - 'linhas';
  v_depois := v_depois - 'senha_hash' - 'mfa_segredo' - 'token_hash' - 'linhas';
  IF TG_OP = 'UPDATE' AND v_antes = v_depois THEN
    RETURN NULL;
  END IF;
  INSERT INTO auditoria (tenant_id, usuario_id, empresa_id, tabela, registro_id, operacao, antes, depois, contexto)
  VALUES ((v_ref->>'tenant_id')::uuid, app.usuario_atual(),
          CASE WHEN TG_TABLE_NAME = 'empresa' THEN (v_ref->>'id')::uuid ELSE (v_ref->>'empresa_id')::uuid END,
          TG_TABLE_NAME, v_ref->>'id', TG_OP, v_antes, v_depois,
          nullif(current_setting('app.contexto', true), ''));
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuario','perfil','perfil_permissao','usuario_atribuicao','empresa','estabelecimento',
                           'setor','cargo','funcao','ghe','funcionario','vinculo','lotacao','afastamento','importacao']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['usuario','empresa','estabelecimento','setor','cargo','funcao','ghe',
                           'funcionario','vinculo','afastamento']
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
  -- Tabelas do tenant sem empresa
  FOREACH t IN ARRAY ARRAY['usuario','perfil','perfil_permissao','usuario_atribuicao','sessao']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id = app.tenant_atual())
                    WITH CHECK (tenant_id = app.tenant_atual())', t, t);
  END LOOP;

  -- Tabelas por empresa: tenant + empresa permitida ao usuário
  FOREACH t IN ARRAY ARRAY['estabelecimento','setor','cargo','funcao','ghe','funcionario','vinculo',
                           'lotacao','afastamento','importacao']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_empresa ON %I
                    USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))
                    WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))', t, t);
  END LOOP;
END $$;

ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY empresa_acesso ON empresa
  USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(id))
  -- Criar empresa exige acesso a todas ('*'); a API também confere a permissão.
  WITH CHECK (tenant_id = app.tenant_atual()
              AND (app.empresa_permitida(id) OR current_setting('app.empresas', true) = '*'));

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_proprio ON tenant USING (id = app.tenant_atual());

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY auditoria_leitura ON auditoria FOR SELECT
  USING (tenant_id = app.tenant_atual() AND (empresa_id IS NULL OR app.empresa_permitida(empresa_id)));

-- ---------------------------------------------------------------------------
-- Funções de autenticação (rodam antes de existir contexto de tenant)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.login_buscar(p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, nome text, senha_hash text, ativo boolean,
               mfa_ativo boolean, mfa_segredo text, tentativas_falhas integer, bloqueado_ate timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  SELECT id, tenant_id, nome, senha_hash, ativo, mfa_ativo, mfa_segredo, tentativas_falhas, bloqueado_ate
  FROM usuario WHERE email = lower(p_email)
$$;

CREATE OR REPLACE FUNCTION app.login_registrar_falha(p_usuario uuid, p_max integer, p_bloqueio interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  UPDATE usuario
     SET tentativas_falhas = tentativas_falhas + 1,
         bloqueado_ate = CASE WHEN tentativas_falhas + 1 >= p_max THEN now() + p_bloqueio ELSE bloqueado_ate END
   WHERE id = p_usuario;
END $$;

CREATE OR REPLACE FUNCTION app.sessao_buscar(p_token_hash text)
RETURNS TABLE (sessao_id uuid, usuario_id uuid, tenant_id uuid, expira_em timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  SELECT s.id, s.usuario_id, s.tenant_id, s.expira_em
    FROM sessao s JOIN usuario u ON u.id = s.usuario_id
   WHERE s.token_hash = p_token_hash AND s.revogada_em IS NULL AND s.expira_em > now() AND u.ativo
$$;

CREATE OR REPLACE FUNCTION app.sistema_configurado() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$ SELECT EXISTS (SELECT 1 FROM tenant) $$;

-- ---------------------------------------------------------------------------
-- Permissões do papel da aplicação
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    GRANT USAGE ON SCHEMA public, app TO sst_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sst_app;
    REVOKE UPDATE, DELETE ON auditoria FROM sst_app;
    REVOKE INSERT ON auditoria FROM sst_app;
    REVOKE UPDATE, DELETE ON lotacao FROM sst_app;
    GRANT UPDATE (fim) ON lotacao TO sst_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Configuração inicial: só funciona enquanto não existir nenhum tenant.
-- Cria a organização, os perfis padrão e o primeiro administrador geral.
-- p_perfis: [{"codigo": "...", "nome": "...", "permissoes": ["..."]}, ...]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.configurar_sistema(p_organizacao text, p_nome text, p_email text,
                                                  p_senha_hash text, p_perfis jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  v_tenant uuid;
  v_usuario uuid;
  v_perfil uuid;
  v_admin uuid;
  p jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(424242);
  IF EXISTS (SELECT 1 FROM tenant) THEN
    RAISE EXCEPTION 'O sistema já foi configurado' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO tenant (nome) VALUES (p_organizacao) RETURNING id INTO v_tenant;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  INSERT INTO usuario (tenant_id, nome, email, senha_hash)
  VALUES (v_tenant, p_nome, lower(p_email), p_senha_hash) RETURNING id INTO v_usuario;
  PERFORM set_config('app.usuario_id', v_usuario::text, true);
  PERFORM set_config('app.contexto', 'configuracao_inicial', true);
  FOR p IN SELECT * FROM jsonb_array_elements(p_perfis) LOOP
    INSERT INTO perfil (tenant_id, codigo, nome, sistema)
    VALUES (v_tenant, p->>'codigo', p->>'nome', true) RETURNING id INTO v_perfil;
    INSERT INTO perfil_permissao (perfil_id, tenant_id, permissao)
    SELECT v_perfil, v_tenant, jsonb_array_elements_text(p->'permissoes');
    IF p->>'codigo' = 'ADMIN_GERAL' THEN v_admin := v_perfil; END IF;
  END LOOP;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Perfil ADMIN_GERAL ausente'; END IF;
  INSERT INTO usuario_atribuicao (tenant_id, usuario_id, perfil_id, empresa_id)
  VALUES (v_tenant, v_usuario, v_admin, NULL);
  RETURN v_usuario;
END $$;
GRANT EXECUTE ON FUNCTION app.configurar_sistema(text, text, text, text, jsonb) TO sst_app;
