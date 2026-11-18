-- Fase 3: programas legais e documentos (PGR, PCMSO, LTCAT, laudos etc.).
--
-- Cada documento controla cinco prazos diferentes, sem validade universal:
--   1. revisão legal (data_revisao da versão vigente);
--   2. vencimento expresso, quando existe (data_vencimento);
--   3. acompanhamento periódico (monitoramento_meses + último acompanhamento);
--   4. atualização por mudança de condições (sinalizada no documento);
--   5. reavaliação interna (data_reavaliacao).
-- Os meses padrão vêm do tipo e podem ser trocados em cada documento.
-- Versões nunca são apagadas: a vigente vira "substituida" quando outra é emitida.

-- ---------------------------------------------------------------------------
-- Biblioteca de tipos (vale para todas as empresas do tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE documento_tipo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  sigla                 text CHECK (length(sigla) <= 20),
  nome                  text NOT NULL,
  base_legal            text,
  descricao             text,
  -- Prazos padrão em meses (nulo = não se aplica / definir em cada documento).
  prazo_revisao_meses   smallint CHECK (prazo_revisao_meses BETWEEN 1 AND 120),
  vencimento_meses      smallint CHECK (vencimento_meses BETWEEN 1 AND 120),
  monitoramento_meses   smallint CHECK (monitoramento_meses BETWEEN 1 AND 120),
  reavaliacao_meses     smallint CHECK (reavaliacao_meses BETWEEN 1 AND 120),
  criterio_revisao      text,
  -- Veio da biblioteca sugerida pelo sistema (pode ser editado como qualquer outro).
  da_biblioteca         boolean NOT NULL DEFAULT false,
  ativo                 boolean NOT NULL DEFAULT true,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  criado_por            uuid,
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_por        uuid,
  UNIQUE (tenant_id, nome)
);

-- ---------------------------------------------------------------------------
-- Documento de uma empresa (ou de um estabelecimento)
-- ---------------------------------------------------------------------------
CREATE TABLE documento (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenant(id),
  empresa_id                  uuid NOT NULL REFERENCES empresa(id),
  estabelecimento_id          uuid,
  tipo_id                     uuid NOT NULL REFERENCES documento_tipo(id),
  identificacao               text NOT NULL,
  base_legal                  text,
  -- Aplicabilidade é decisão do profissional responsável, nunca presumida.
  aplicabilidade              text NOT NULL DEFAULT 'a_avaliar' CHECK (aplicabilidade IN ('a_avaliar', 'aplicavel', 'nao_aplicavel')),
  aplicabilidade_justificativa text,
  aplicabilidade_em           timestamptz,
  aplicabilidade_por          uuid,
  -- Regras deste documento (copiadas do tipo na criação, editáveis).
  prazo_revisao_meses         smallint CHECK (prazo_revisao_meses BETWEEN 1 AND 120),
  vencimento_meses            smallint CHECK (vencimento_meses BETWEEN 1 AND 120),
  monitoramento_meses         smallint CHECK (monitoramento_meses BETWEEN 1 AND 120),
  reavaliacao_meses           smallint CHECK (reavaliacao_meses BETWEEN 1 AND 120),
  criterio_revisao            text,
  -- Mudança de condições que exige atualização (ex.: novo processo, nova máquina, acidente).
  mudanca_condicoes_em        date,
  mudanca_condicoes_motivo    text,
  -- Documento encerrado e substituído por outro (ex.: laudo refeito por outro profissional).
  substituido_em              date,
  substituido_por_id          uuid,
  substituicao_motivo         text,
  observacoes                 text,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  criado_por                  uuid,
  atualizado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_por              uuid,
  FOREIGN KEY (estabelecimento_id, empresa_id) REFERENCES estabelecimento (id, empresa_id),
  FOREIGN KEY (substituido_por_id, empresa_id) REFERENCES documento (id, empresa_id),
  CHECK (aplicabilidade <> 'nao_aplicavel' OR aplicabilidade_justificativa IS NOT NULL),
  CHECK ((mudanca_condicoes_em IS NULL) = (mudanca_condicoes_motivo IS NULL)),
  CHECK ((substituido_em IS NULL) = (substituicao_motivo IS NULL)),
  CHECK (substituido_por_id IS NULL OR substituido_por_id <> id),
  UNIQUE (id, empresa_id)
);
CREATE INDEX documento_empresa ON documento (empresa_id, tipo_id);

-- ---------------------------------------------------------------------------
-- Versões do documento
-- ---------------------------------------------------------------------------
CREATE TABLE documento_versao (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  empresa_id              uuid NOT NULL,
  documento_id            uuid NOT NULL,
  numero                  integer NOT NULL CHECK (numero > 0),
  situacao                text NOT NULL CHECK (situacao IN ('em_elaboracao', 'em_revisao', 'vigente', 'substituida', 'cancelada')),
  responsavel_nome        text,
  responsavel_registro    text,
  responsavel_formacao    text,
  data_elaboracao         date,
  data_emissao            date,
  inicio_vigencia         date,
  data_revisao            date,
  data_vencimento         date,
  data_reavaliacao        date,
  descricao_alteracoes    text,
  observacoes             text,
  arquivo_id              uuid,
  publicada_em            timestamptz,
  publicada_por           uuid,
  substituida_em          date,
  substituida_por_id      uuid,
  motivo_cancelamento     text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  criado_por              uuid,
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_por          uuid,
  FOREIGN KEY (documento_id, empresa_id) REFERENCES documento (id, empresa_id),
  FOREIGN KEY (arquivo_id, empresa_id) REFERENCES arquivo (id, empresa_id),
  FOREIGN KEY (substituida_por_id) REFERENCES documento_versao (id),
  -- Versão emitida tem responsável técnico e data de emissão.
  CHECK (situacao NOT IN ('vigente', 'substituida') OR (responsavel_nome IS NOT NULL AND data_emissao IS NOT NULL)),
  CHECK (situacao <> 'substituida' OR substituida_em IS NOT NULL),
  CHECK (situacao <> 'cancelada' OR motivo_cancelamento IS NOT NULL),
  CHECK (data_revisao IS NULL OR data_emissao IS NULL OR data_revisao > data_emissao),
  CHECK (data_vencimento IS NULL OR data_emissao IS NULL OR data_vencimento > data_emissao),
  CHECK (data_reavaliacao IS NULL OR data_emissao IS NULL OR data_reavaliacao > data_emissao),
  CHECK (data_elaboracao IS NULL OR data_emissao IS NULL OR data_elaboracao <= data_emissao),
  UNIQUE (documento_id, numero),
  UNIQUE (id, empresa_id)
);
-- No máximo uma versão vigente e um rascunho por documento.
CREATE UNIQUE INDEX documento_versao_uma_vigente ON documento_versao (documento_id) WHERE situacao = 'vigente';
CREATE UNIQUE INDEX documento_versao_um_rascunho ON documento_versao (documento_id) WHERE situacao IN ('em_elaboracao', 'em_revisao');

-- ---------------------------------------------------------------------------
-- Acompanhamentos periódicos (ex.: relatório analítico, monitoramento do plano)
-- ---------------------------------------------------------------------------
CREATE TABLE documento_acompanhamento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  empresa_id        uuid NOT NULL,
  documento_id      uuid NOT NULL,
  data              date NOT NULL,
  responsavel_nome  text NOT NULL,
  descricao         text NOT NULL,
  arquivo_id        uuid,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por        uuid,
  FOREIGN KEY (documento_id, empresa_id) REFERENCES documento (id, empresa_id),
  FOREIGN KEY (arquivo_id, empresa_id) REFERENCES arquivo (id, empresa_id)
);
CREATE INDEX documento_acompanhamento_doc ON documento_acompanhamento (documento_id, data DESC);

-- Programas (PGR, LTCAT...) costumam ser PDFs grandes: até 50 MB por arquivo.
ALTER TABLE arquivo DROP CONSTRAINT arquivo_tamanho_check;
ALTER TABLE arquivo ADD CONSTRAINT arquivo_tamanho_check CHECK (tamanho > 0 AND tamanho <= 52428800);

-- ---------------------------------------------------------------------------
-- Auditoria, atualizado_em e RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documento_tipo','documento','documento_versao','documento_acompanhamento']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.registrar_auditoria()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['documento_tipo','documento','documento_versao']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_atualizado BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION app.tocar_atualizado_em()', t, t);
  END LOOP;

  ALTER TABLE documento_tipo ENABLE ROW LEVEL SECURITY;
  CREATE POLICY documento_tipo_tenant ON documento_tipo USING (tenant_id = app.tenant_atual())
    WITH CHECK (tenant_id = app.tenant_atual());

  FOREACH t IN ARRAY ARRAY['documento','documento_versao','documento_acompanhamento']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_empresa ON %I
                    USING (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))
                    WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_permitida(empresa_id))', t, t);
  END LOOP;
END $$;

-- Versão substituída ou cancelada não muda mais (o histórico é preservado pelo banco).
CREATE OR REPLACE FUNCTION app.versao_documento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.situacao IN ('substituida', 'cancelada') THEN
    RAISE EXCEPTION 'Versão % do documento já foi %; não pode ser alterada', OLD.numero,
      CASE OLD.situacao WHEN 'substituida' THEN 'substituída' ELSE 'cancelada' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documento_versao_imutavel BEFORE UPDATE ON documento_versao
  FOR EACH ROW EXECUTE FUNCTION app.versao_documento_imutavel();

-- ---------------------------------------------------------------------------
-- Permissões novas nos perfis padrão já existentes.
-- Mantida igual a PERFIS_PADRAO em packages/shared (um teste confere).
-- ---------------------------------------------------------------------------
INSERT INTO perfil_permissao (perfil_id, tenant_id, permissao)
SELECT p.id, p.tenant_id, n.permissao
  FROM perfil p
  JOIN (VALUES
    ('ADMIN_GERAL', 'documentos.ler'), ('ADMIN_GERAL', 'documentos.editar'),
    ('ADMIN_EMPRESA', 'documentos.ler'), ('ADMIN_EMPRESA', 'documentos.editar'),
    ('ENG_SEGURANCA', 'documentos.ler'), ('ENG_SEGURANCA', 'documentos.editar'),
    ('TEC_SEGURANCA', 'documentos.ler'), ('TEC_SEGURANCA', 'documentos.editar'),
    ('MEDICO', 'documentos.ler'), ('MEDICO', 'documentos.editar'),
    ('RH', 'documentos.ler'),
    ('OPERADOR_ESOCIAL', 'documentos.ler'),
    ('VISUALIZADOR', 'documentos.ler')
  ) AS n (codigo, permissao) ON n.codigo = p.codigo
 WHERE p.sistema
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sst_app') THEN
    -- Nada aqui é apagado: tipo é desativado, versão é cancelada ou substituída.
    GRANT SELECT, INSERT, UPDATE ON documento_tipo, documento, documento_versao TO sst_app;
    GRANT SELECT, INSERT ON documento_acompanhamento TO sst_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO sst_app;
  END IF;
END $$;
