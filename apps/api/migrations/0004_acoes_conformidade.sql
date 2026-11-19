-- Fase 4: planos de ação, inspeções, ocorrências e matriz de conformidade.
--
-- Regras garantidas pelo banco (não só pela API):
--   * ação não vai para validação nem é concluída sem evidência, salvo dispensa justificada;
--   * ação concluída ou cancelada não muda mais;
--   * histórico da ação e evidências só recebem inclusões (nunca alteração ou exclusão).

-- ---------------------------------------------------------------------------
-- Numeração sequencial por tenant (ex.: códigos AC-2026-0001)
-- ---------------------------------------------------------------------------
CREATE TABLE contador (
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  nome       text NOT NULL,
  valor      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, nome)
);

-- ---------------------------------------------------------------------------
-- Inspeções
-- ---------------------------------------------------------------------------
CREATE TABLE inspecao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  codigo              text NOT NULL,
  estabelecimento_id  uuid NOT NULL,
  setor_id            uuid,
  data                date NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('rotina', 'cipa', 'auditoria', 'especifica', 'outra')),
  responsavel_nome    text NOT NULL,
  escopo              text,
  conclusao           text,
  situacao            text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'concluida')),
  concluida_em        date,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_por      uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  FOREIGN KEY (setor_id, empresa_id) REFERENCES setor (id, empresa_id),
  CHECK ((situacao = 'concluida') = (concluida_em IS NOT NULL)),
  UNIQUE (tenant_id, codigo),
  UNIQUE (id, empresa_id)
);

CREATE TABLE inspecao_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  empresa_id      uuid NOT NULL,
  inspecao_id     uuid NOT NULL,
  ordem           integer NOT NULL,
  descricao       text NOT NULL,
  resultado       text NOT NULL CHECK (resultado IN ('conforme', 'nao_conforme', 'nao_aplicavel')),
  observacao      text,
  setor_id        uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  FOREIGN KEY (inspecao_id, empresa_id) REFERENCES inspecao (id, empresa_id),
  FOREIGN KEY (setor_id, empresa_id) REFERENCES setor (id, empresa_id),
  UNIQUE (inspecao_id, ordem),
  UNIQUE (id, empresa_id)
);

-- ---------------------------------------------------------------------------
-- Ocorrências (acidentes, quase acidentes, doenças) e investigação
-- ---------------------------------------------------------------------------
CREATE TABLE ocorrencia (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  empresa_id                uuid NOT NULL REFERENCES empresa(id),
  codigo                    text NOT NULL,
  estabelecimento_id        uuid NOT NULL,
  setor_id                  uuid,
  funcionario_id            uuid,
  data_hora                 timestamptz NOT NULL,
  tipo                      text NOT NULL CHECK (tipo IN ('acidente_tipico', 'acidente_trajeto', 'doenca_ocupacional', 'incidente', 'quase_acidente', 'outro')),
  gravidade                 text NOT NULL CHECK (gravidade IN ('sem_lesao', 'leve', 'moderada', 'grave', 'fatal')),
  local                     text,
  descricao                 text NOT NULL,
  medidas_imediatas         text,
  houve_afastamento         boolean NOT NULL DEFAULT false,
  investigacao              text,
  investigacao_responsavel  text,
  investigacao_concluida_em date,
  situacao                  text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'em_investigacao', 'encerrada')),
  encerrada_em              date,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  criado_por                uuid,
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_por            uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  FOREIGN KEY (setor_id, empresa_id) REFERENCES setor (id, empresa_id),
  FOREIGN KEY (funcionario_id, empresa_id) REFERENCES funcionario (id, empresa_id),
  CHECK ((situacao = 'encerrada') = (encerrada_em IS NOT NULL)),
  -- Encerrar exige a investigação registrada.
  CHECK (situacao <> 'encerrada' OR (investigacao IS NOT NULL AND investigacao_concluida_em IS NOT NULL)),
  UNIQUE (tenant_id, codigo),
  UNIQUE (id, empresa_id)
);

-- ---------------------------------------------------------------------------
-- Matriz de conformidade
-- ---------------------------------------------------------------------------
-- Requisito legal (biblioteca do tenant). Os critérios de sugestão só ajudam a
-- triagem: a aplicabilidade é sempre decidida pelo profissional responsável.
CREATE TABLE requisito (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant(id),
  titulo                    text NOT NULL,
  fundamentacao             text,
  descricao                 text,
  -- Atendido por um documento deste tipo (situação vem do documento).
  documento_tipo_id         uuid REFERENCES documento_tipo(id),
  sugestao_graus_risco      smallint[] NOT NULL DEFAULT '{}' CHECK (sugestao_graus_risco <@ ARRAY[1,2,3,4]::smallint[]),
  sugestao_cnae_prefixos    text[] NOT NULL DEFAULT '{}',
  sugestao_min_empregados   integer CHECK (sugestao_min_empregados > 0),
  ativo                     boolean NOT NULL DEFAULT true,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  criado_por                uuid,
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_por            uuid,
  UNIQUE (tenant_id, titulo)
);

-- Avaliação de um requisito numa empresa (ou num estabelecimento).
CREATE TABLE conformidade (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid NOT NULL REFERENCES tenant(id),
  empresa_id                    uuid NOT NULL REFERENCES empresa(id),
  estabelecimento_id            uuid,
  requisito_id                  uuid NOT NULL REFERENCES requisito(id),
  aplicabilidade                text NOT NULL DEFAULT 'a_avaliar' CHECK (aplicabilidade IN ('a_avaliar', 'aplicavel', 'nao_aplicavel')),
  aplicabilidade_justificativa  text,
  aplicabilidade_em             timestamptz,
  aplicabilidade_por            uuid,
  -- Para requisitos sem documento vinculado, a situação é avaliada pelo profissional.
  avaliacao                     text NOT NULL DEFAULT 'nao_avaliado' CHECK (avaliacao IN ('nao_avaliado', 'conforme', 'parcial', 'nao_conforme')),
  avaliacao_em                  date,
  avaliado_por                  uuid,
  responsavel_nome              text,
  pendencias                    text,
  prazo                         date,
  observacoes                   text,
  criado_em                     timestamptz NOT NULL DEFAULT now(),
  criado_por                    uuid,
  atualizado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_por                uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  CHECK (aplicabilidade <> 'nao_aplicavel' OR aplicabilidade_justificativa IS NOT NULL),
  CHECK ((avaliacao = 'nao_avaliado') = (avaliacao_em IS NULL)),
  UNIQUE NULLS NOT DISTINCT (empresa_id, estabelecimento_id, requisito_id),
  UNIQUE (id, empresa_id)
);

-- ---------------------------------------------------------------------------
-- Ações
-- ---------------------------------------------------------------------------
CREATE TABLE acao (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  empresa_id              uuid NOT NULL REFERENCES empresa(id),
  codigo                  text NOT NULL,
  estabelecimento_id      uuid,
  setor_id                uuid,
  ghe_id                  uuid,
  origem                  text NOT NULL CHECK (origem IN ('pgr', 'pgrtr', 'pcmso', 'aep', 'aet', 'pca', 'ppr', 'cipa', 'inspecao', 'auditoria',
                                                          'acidente', 'investigacao', 'recomendacao', 'conformidade', 'outra')),
  documento_id            uuid,
  inspecao_item_id        uuid,
  ocorrencia_id           uuid,
  conformidade_id         uuid,
  perigo                  text,
  descricao               text NOT NULL,
  justificativa           text,
  tipo                    text NOT NULL CHECK (tipo IN ('introduzir', 'aprimorar', 'manter')),
  prioridade              text NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta', 'urgente')),
  responsavel_nome        text NOT NULL,
  validador_nome          text,
  data_abertura           date NOT NULL,
  prazo_inicial           date NOT NULL,
  prazo                   date NOT NULL,
  recursos                text,
  forma_acompanhamento    text,
  -- Regra de conclusão: com evidência, ou dispensa com justificativa técnica.
  exige_evidencia         boolean NOT NULL DEFAULT true,
  dispensa_justificativa  text,
  situacao                text NOT NULL DEFAULT 'nao_iniciada'
                          CHECK (situacao IN ('nao_iniciada', 'em_andamento', 'aguardando_evidencia', 'em_validacao', 'concluida', 'cancelada')),
  concluida_em            date,
  validada_por            uuid,
  validada_por_nome       text,
  cancelada_em            date,
  cancelamento_motivo     text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  criado_por              uuid,
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_por          uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  FOREIGN KEY (setor_id, empresa_id) REFERENCES setor (id, empresa_id),
  FOREIGN KEY (ghe_id, empresa_id) REFERENCES ghe (id, empresa_id),
  FOREIGN KEY (documento_id, empresa_id) REFERENCES documento (id, empresa_id),
  FOREIGN KEY (inspecao_item_id, empresa_id) REFERENCES inspecao_item (id, empresa_id),
  FOREIGN KEY (ocorrencia_id, empresa_id) REFERENCES ocorrencia (id, empresa_id),
  FOREIGN KEY (conformidade_id, empresa_id) REFERENCES conformidade (id, empresa_id),
  CHECK (prazo_inicial >= data_abertura AND prazo >= data_abertura),
  CHECK (exige_evidencia OR dispensa_justificativa IS NOT NULL),
  CHECK ((situacao = 'concluida') = (concluida_em IS NOT NULL)),
  CHECK (situacao <> 'concluida' OR validada_por_nome IS NOT NULL),
  CHECK ((situacao = 'cancelada') = (cancelamento_motivo IS NOT NULL AND cancelada_em IS NOT NULL)),
  UNIQUE (tenant_id, codigo),
  UNIQUE (id, empresa_id)
);
CREATE INDEX acao_empresa ON acao (empresa_id, situacao, prazo);

CREATE TABLE acao_evidencia (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  empresa_id  uuid NOT NULL,
  acao_id     uuid NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('foto', 'documento', 'certificado', 'lista_presenca', 'comprovante', 'outro')),
  descricao   text NOT NULL,
  data        date NOT NULL,
  arquivo_id  uuid NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid,
  FOREIGN KEY (acao_id, empresa_id) REFERENCES acao (id, empresa_id),
  FOREIGN KEY (arquivo_id, empresa_id) REFERENCES arquivo (id, empresa_id)
);
CREATE INDEX acao_evidencia_acao ON acao_evidencia (acao_id);

-- Histórico da ação: abertura, mudanças de situação, reprogramações (com justificativa), evidências, comentários.
CREATE TABLE acao_historico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  empresa_id  uuid NOT NULL,
  acao_id     uuid NOT NULL,
  evento      text NOT NULL CHECK (evento IN ('aberta', 'editada', 'situacao', 'reprogramada', 'evidencia', 'dispensa', 'devolvida',
                                              'concluida', 'cancelada', 'comentario')),
  descricao   text NOT NULL,
  dados       jsonb NOT NULL DEFAULT '{}',
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid,
  FOREIGN KEY (acao_id, empresa_id) REFERENCES acao (id, empresa_id)
);
CREATE INDEX acao_historico_acao ON acao_historico (acao_id, criado_em);

-- Regras da ação no banco.
CREATE OR REPLACE FUNCTION app.regras_acao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.situacao IN ('concluida', 'cancelada') THEN
    RAISE EXCEPTION 'Ação % já está %; não pode ser alterada', OLD.codigo,
      CASE OLD.situacao WHEN 'concluida' THEN 'concluída' ELSE 'cancelada' END USING ERRCODE = 'P0001';
  END IF;
  IF NEW.situacao IN ('em_validacao', 'concluida') AND NEW.situacao IS DISTINCT FROM OLD.situacao
     AND NEW.exige_evidencia
     AND NOT EXISTS (SELECT 1 FROM acao_evidencia e WHERE e.acao_id = NEW.id) THEN
    RAISE EXCEPTION 'A ação % precisa de pelo menos uma evidência (ou dispensa justificada) para ser validada ou concluída', NEW.codigo
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER acao_regras BEFORE UPDATE ON acao FOR EACH ROW EXECUTE FUNCTION app.regras_acao();

-- Concluída direto na inclusão também não pode (sempre passa pelo fluxo).
CREATE OR REPLACE FUNCTION app.acao_nasce_aberta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.situacao NOT IN ('nao_iniciada', 'em_andamento') THEN
    RAISE EXCEPTION 'Ação nova começa como não iniciada ou em andamento' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER acao_inclusao BEFORE INSERT ON acao FOR EACH ROW EXECUTE FUNCTION app.acao_nasce_aberta();

-- ---------------------------------------------------------------------------
-- Auditoria, atualizado_em e RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inspecao','inspecao_item','ocorrencia','requisito','conformidade','acao','acao_evidencia','acao_historico']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['inspecao','inspecao_item','ocorrencia','requisito','conformidade','acao']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_atualizado BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.tocar_atualizado_em()', t, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['contador','requisito']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I USING (tenant_id = app.tenant_atual())
                    WITH CHECK (tenant_id = app.tenant_atual())', t, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inspecao','inspecao_item','ocorrencia','conformidade','acao','acao_evidencia','acao_historico']
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
    ('ADMIN_GERAL', 'acoes.ler'), ('ADMIN_GERAL', 'acoes.editar'), ('ADMIN_GERAL', 'acoes.validar'),
    ('ADMIN_GERAL', 'inspecoes.ler'), ('ADMIN_GERAL', 'inspecoes.editar'),
    ('ADMIN_GERAL', 'conformidade.ler'), ('ADMIN_GERAL', 'conformidade.editar'),
    ('ADMIN_EMPRESA', 'acoes.ler'), ('ADMIN_EMPRESA', 'acoes.editar'), ('ADMIN_EMPRESA', 'acoes.validar'),
    ('ADMIN_EMPRESA', 'inspecoes.ler'), ('ADMIN_EMPRESA', 'inspecoes.editar'),
    ('ADMIN_EMPRESA', 'conformidade.ler'), ('ADMIN_EMPRESA', 'conformidade.editar'),
    ('ENG_SEGURANCA', 'acoes.ler'), ('ENG_SEGURANCA', 'acoes.editar'), ('ENG_SEGURANCA', 'acoes.validar'),
    ('ENG_SEGURANCA', 'inspecoes.ler'), ('ENG_SEGURANCA', 'inspecoes.editar'),
    ('ENG_SEGURANCA', 'conformidade.ler'), ('ENG_SEGURANCA', 'conformidade.editar'),
    ('TEC_SEGURANCA', 'acoes.ler'), ('TEC_SEGURANCA', 'acoes.editar'),
    ('TEC_SEGURANCA', 'inspecoes.ler'), ('TEC_SEGURANCA', 'inspecoes.editar'),
    ('TEC_SEGURANCA', 'conformidade.ler'), ('TEC_SEGURANCA', 'conformidade.editar'),
    ('MEDICO', 'acoes.ler'), ('MEDICO', 'acoes.editar'), ('MEDICO', 'inspecoes.ler'), ('MEDICO', 'conformidade.ler'),
    ('RH', 'acoes.ler'), ('RH', 'inspecoes.ler'), ('RH', 'inspecoes.editar'), ('RH', 'conformidade.ler'),
    ('OPERADOR_ESOCIAL', 'acoes.ler'), ('OPERADOR_ESOCIAL', 'inspecoes.ler'), ('OPERADOR_ESOCIAL', 'conformidade.ler'),
    ('VISUALIZADOR', 'acoes.ler'), ('VISUALIZADOR', 'inspecoes.ler'), ('VISUALIZADOR', 'conformidade.ler')
  ) AS n (codigo, permissao) ON n.codigo = p.codigo
 WHERE p.sistema
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    GRANT SELECT, INSERT, UPDATE ON contador, inspecao, ocorrencia, requisito, conformidade, acao TO sst_app;
    -- Itens de inspeção ainda aberta podem ser removidos; o resto nunca é apagado.
    GRANT SELECT, INSERT, UPDATE, DELETE ON inspecao_item TO sst_app;
    -- Evidências e histórico: só inclusão.
    GRANT SELECT, INSERT ON acao_evidencia, acao_historico TO sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;
