import {
  ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  anonimizar, CATEGORIAS_ALERTA, descarteSugestaoSchema, iaConfigSchema, MODELOS_IA, PRIORIDADES, TIPOS_EVENTO_ESOCIAL,
} from '@sst/shared';
import { BANCO, CONFIG, type Configuracao } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { cifrar, decifrar } from '../comum/cripto';
import { validar } from '../comum/validacao';
import { Banco, type Tx } from '../db/banco';
import { CalendarioService } from '../painel/calendario.service';
import { IndicadoresService } from '../painel/indicadores.service';

const erro = (mensagem: string) => new UnprocessableEntityException({ mensagem });

const COLS = `s.id, s.empresa_id AS "empresaId", e.razao_social AS "empresaNome", s.tipo, s.evento_id AS "eventoId", ev.tipo AS "eventoTipo",
  s.titulo, s.enviado, s.texto, s.acoes_sugeridas AS "acoesSugeridas", s.modelo, s.situacao, s.decidido_por_nome AS "decididoPorNome",
  s.decidido_em AS "decididoEm", s.motivo_descarte AS "motivoDescarte", s.criado_em AS "criadoEm", uc.nome AS "criadoPor"`;
const FROM = `FROM sugestao_ia s JOIN empresa e ON e.id = s.empresa_id LEFT JOIN esocial_evento ev ON ev.id = s.evento_id
  LEFT JOIN usuario uc ON uc.id = s.criado_por`;

/** Formato da resposta pedida ao modelo (saída estruturada). */
const FORMATO = {
  type: 'object',
  additionalProperties: false,
  required: ['texto', 'acoes'],
  properties: {
    texto: { type: 'string', description: 'Explicação ou resumo em português do Brasil, em parágrafos curtos.' },
    acoes: {
      type: 'array',
      description: 'Ações sugeridas para uma pessoa avaliar. Pode ser vazia.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descricao', 'prioridade'],
        properties: {
          descricao: { type: 'string' },
          prioridade: { type: 'string', enum: Object.keys(PRIORIDADES) },
        },
      },
    },
  },
} as const;

const REGRAS = `Você auxilia a equipe de Saúde e Segurança do Trabalho de uma empresa brasileira, dentro de um sistema de gestão de SST.
Regras que você sempre segue:
- Você só explica, resume e aponta inconsistências. Quem decide é sempre uma pessoa da equipe.
- Não determine exames médicos, aptidão, nexo causal, CID nem conclusões de laudos.
- Não diga que algo foi corrigido, aprovado ou transmitido: você não grava nada e não envia nada ao eSocial.
- Os dados recebidos não têm nomes, CPF nem informações clínicas. Não peça esses dados.
- Escreva em português do Brasil, de forma direta, para técnicos e engenheiros de segurança.
- Quando não tiver certeza da causa, diga isso e indique o que conferir.
- As ações sugeridas são curtas e práticas (verbo no infinitivo), no máximo cinco.`;

type Resposta = { texto: string; acoes: { descricao: string; prioridade: string }[]; modelo: string };

/**
 * Assistente de IA (opcional, precisa de internet). Toda resposta vira uma sugestão
 * "aguardando decisão" que uma pessoa aceita ou descarta. A IA não grava dados do sistema.
 */
@Injectable()
export class IaService {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(CONFIG) private readonly cfg: Configuracao,
    private readonly indicadores: IndicadoresService,
    private readonly calendario: CalendarioService,
  ) {}

  // ---------------------------------------------------------------- configuração

  private configTx(tx: Tx) {
    return tx.one(
      `SELECT c.ativo, c.modelo, c.chave_cifrada IS NOT NULL AS "temChave", c.chave_final AS "chaveFinal", c.atualizado_em AS "atualizadoEm",
              u.nome AS "atualizadoPor"
         FROM ia_config c LEFT JOIN usuario u ON u.id = c.atualizado_por`);
  }

  async config(u: Usuario) {
    const c = await this.banco.tx(u.ctx(), (tx) => this.configTx(tx));
    return { ...(c ?? { ativo: false, modelo: 'claude-opus-5-5', temChave: false, chaveFinal: null, atualizadoEm: null, atualizadoPor: null }), modelos: MODELOS_IA };
  }

  async salvarConfig(u: Usuario, corpo: unknown) {
    const d = validar(iaConfigSchema, corpo);
    await this.banco.tx(u.ctx('config_ia'), async (tx) => {
      const atual = await tx.one('SELECT chave_cifrada FROM ia_config FOR UPDATE');
      if (d.ativo && !d.chave && !atual?.chave_cifrada) throw erro('Informe a chave da API para ativar o assistente');
      const cifrada = d.chave ? cifrar(this.cfg.chaveDados, d.chave) : null;
      const final = d.chave ? d.chave.slice(-4) : null;
      if (atual)
        await tx.query(
          `UPDATE ia_config SET ativo = $1, modelo = $2, chave_cifrada = coalesce($3, chave_cifrada), chave_final = coalesce($4, chave_final),
                  atualizado_por = app.usuario_atual()`, [d.ativo, d.modelo, cifrada, final]);
      else
        await tx.query(
          `INSERT INTO ia_config (tenant_id, ativo, modelo, chave_cifrada, chave_final, criado_por, atualizado_por)
           VALUES (app.tenant_atual(), $1, $2, $3, $4, app.usuario_atual(), app.usuario_atual())`, [d.ativo, d.modelo, cifrada, final]);
    });
    return this.config(u);
  }

  /** Apaga a chave guardada e desliga o assistente. */
  async removerChave(u: Usuario) {
    await this.banco.tx(u.ctx('config_ia'), (tx) =>
      tx.query('UPDATE ia_config SET ativo = false, chave_cifrada = NULL, chave_final = NULL, atualizado_por = app.usuario_atual()'));
    return this.config(u);
  }

  // ---------------------------------------------------------------- chamada ao modelo

  private async perguntar(u: Usuario, pedido: string, dados: object): Promise<Resposta> {
    const c = await this.banco.tx(u.ctx(), (tx) => tx.one('SELECT ativo, modelo, chave_cifrada FROM ia_config'));
    if (!c?.ativo || !c.chave_cifrada) throw erro('O assistente de IA está desligado. Um administrador pode ativá-lo em Assistente de IA.');
    const cliente = new Anthropic({
      apiKey: decifrar(this.cfg.chaveDados, c.chave_cifrada),
      ...(this.cfg.iaBaseUrlTeste ? { baseURL: this.cfg.iaBaseUrlTeste } : {}),
      timeout: 120_000,
      maxRetries: 2,
    });
    let r: Anthropic.Beta.Messages.BetaMessage;
    try {
      r = await cliente.beta.messages.create({
        model: c.modelo,
        max_tokens: 8000,
        // Se o modelo escolhido estiver indisponível ou sobrecarregado, a própria API usa um modelo reserva.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: FORMATO } },
        system: REGRAS,
        messages: [{ role: 'user', content: `${pedido}\n\nDados (JSON):\n${JSON.stringify(dados, null, 2)}` }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
        throw erro('A chave da API foi recusada pela Anthropic. Confira a chave em Assistente de IA.');
      if (e instanceof Anthropic.RateLimitError) throw new ServiceUnavailableException({ mensagem: 'Limite de uso da API atingido. Tente de novo em alguns minutos.' });
      if (e instanceof Anthropic.APIConnectionError)
        throw new ServiceUnavailableException({ mensagem: 'Sem conexão com o serviço de IA. Confira a internet do computador e tente de novo.' });
      if (e instanceof Anthropic.APIError)
        throw new ServiceUnavailableException({ mensagem: `O serviço de IA respondeu com erro (${e.status ?? 'sem código'}). Tente de novo mais tarde.` });
      throw e;
    }
    if (r.stop_reason === 'refusal') throw erro('O assistente não respondeu a este pedido.');
    if (r.stop_reason === 'max_tokens') throw erro('A resposta do assistente ficou incompleta. Tente de novo.');
    const texto = r.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    let json: { texto?: unknown; acoes?: unknown };
    try { json = JSON.parse(texto); } catch { throw erro('A resposta do assistente veio num formato inesperado. Tente de novo.'); }
    if (typeof json.texto !== 'string' || !json.texto.trim()) throw erro('A resposta do assistente veio vazia. Tente de novo.');
    const acoes = (Array.isArray(json.acoes) ? json.acoes : [])
      .filter((a: any) => a && typeof a.descricao === 'string' && a.descricao.trim())
      .slice(0, 5)
      .map((a: any) => ({ descricao: a.descricao.trim().slice(0, 1000), prioridade: a.prioridade in PRIORIDADES ? a.prioridade : 'media' }));
    return { texto: json.texto.trim().slice(0, 20000), acoes, modelo: r.model };
  }

  private async gravar(u: Usuario, s: { empresaId: string; tipo: string; eventoId: string | null; titulo: string; enviado: object }, r: Resposta) {
    return this.banco.tx(u.ctx('ia'), async (tx) => {
      const n = await tx.one(
        `INSERT INTO sugestao_ia (tenant_id, empresa_id, tipo, evento_id, titulo, enviado, texto, acoes_sugeridas, modelo, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, app.usuario_atual()) RETURNING id`,
        [s.empresaId, s.tipo, s.eventoId, s.titulo, JSON.stringify(s.enviado), r.texto, JSON.stringify(r.acoes), r.modelo]);
      return this.obterTx(tx, n!.id);
    });
  }

  // ---------------------------------------------------------------- pedidos

  /**
   * Explica os erros de validação ou a rejeição do governo de um evento do eSocial.
   * Vão só o tipo do evento e as mensagens, sem nomes, CPF, valores digitados nem dados clínicos.
   */
  async explicarRejeicao(u: Usuario, eventoId: string) {
    const ev = await this.banco.tx(u.ctx(), (tx) => tx.one(
      `SELECT e.id, e.empresa_id AS "empresaId", e.tipo, e.situacao, e.erros, e.ocorrencias, e.cd_resposta AS "cdResposta",
              f.nome AS funcionario, em.razao_social AS empresa
         FROM esocial_evento e JOIN empresa em ON em.id = e.empresa_id
         LEFT JOIN vinculo v ON v.id = e.vinculo_id LEFT JOIN funcionario f ON f.id = v.funcionario_id
        WHERE e.id = $1`, [eventoId]));
    if (!ev) throw new NotFoundException({ mensagem: 'Evento não encontrado' });
    u.exigir('esocial.ler', ev.empresaId);
    u.exigir('ia.usar', ev.empresaId);
    const erros = (ev.erros ?? []) as { mensagem?: string; campo?: string }[];
    const ocorrencias = (ev.ocorrencias ?? []) as { codigo?: string; descricao?: string; tipo?: string | number; localizacao?: string }[];
    if (!['invalido', 'rejeitado'].includes(ev.situacao) || (!erros.length && !ocorrencias.length))
      throw erro('Só há o que explicar em eventos com erros de validação ou rejeitados pelo eSocial.');
    const limpar = (t?: string | null) => (t ? semIdentificacao(t, [ev.funcionario, ev.empresa]) : null);
    const enviado = {
      evento: `${ev.tipo} (${TIPOS_EVENTO_ESOCIAL[ev.tipo as keyof typeof TIPOS_EVENTO_ESOCIAL] ?? ''})`,
      situacao: ev.situacao === 'invalido' ? 'Erros na validação feita no próprio sistema antes do envio' : 'Rejeitado pelo eSocial',
      codigoResposta: ev.cdResposta ?? null,
      errosValidacao: erros.map((x) => limpar(x.mensagem)).filter(Boolean),
      ocorrenciasGoverno: ocorrencias.map((o) => ({ codigo: o.codigo ?? null, tipo: o.tipo ?? null, descricao: limpar(o.descricao), localizacao: limpar(o.localizacao) })),
    };
    const r = await this.perguntar(u,
      'Explique, em linguagem simples, o que cada erro ou ocorrência abaixo significa no leiaute do eSocial, a causa provável e onde conferir no cadastro (empresa, trabalhador, lotação, ASO, agentes nocivos ou CAT). Se várias mensagens tiverem a mesma causa, agrupe.',
      enviado);
    return this.gravar(u, { empresaId: ev.empresaId, tipo: 'explicar_rejeicao', eventoId: ev.id, titulo: `Explicação: ${ev.tipo}`, enviado }, r);
  }

  /** Resumo das pendências de uma empresa, só com contagens (sem nomes, CPF nem dados clínicos). */
  async resumoPendencias(u: Usuario, empresaId: string) {
    u.exigir('ia.usar', empresaId);
    const existe = await this.banco.tx(u.ctx(), (tx) => tx.one('SELECT 1 FROM empresa WHERE id = $1', [empresaId]));
    if (!existe) throw new NotFoundException({ mensagem: 'Empresa não encontrada' });
    const ind: any = await this.indicadores.indicadores(u, { empresaId, meses: 6 });
    const cal = await this.calendario.itens(u, { empresaId });
    const prazos: Record<string, { atrasados: number; proximos: number }> = {};
    for (const i of cal.itens) {
      if (i.estado === 'futuro') continue;
      const k = CATEGORIAS_ALERTA[i.categoria];
      prazos[k] ??= { atrasados: 0, proximos: 0 };
      prazos[k]![i.estado === 'atrasado' ? 'atrasados' : 'proximos']++;
    }
    const enviado = {
      dataDeHoje: ind.hoje,
      janelaDeAlertaEmDias: cal.janela,
      prazosPorCategoria: prazos,
      asoETreinamentosPorSituacao: ind.saude ?? 'sem acesso',
      documentosPorSituacao: ind.documentos ?? 'sem acesso',
      planosDeAcao: ind.acoes ?? 'sem acesso',
      ocorrenciasUltimos6Meses: ind.ocorrenciasPorMes
        ? { acidentes: ind.ocorrenciasPorMes.acidentes, comAfastamento: ind.ocorrenciasPorMes.comAfastamento, graves: ind.ocorrenciasPorMes.graves,
            abertas: ind.ocorrenciasPorMes.abertas, diasSemAcidenteComAfastamento: ind.ocorrenciasPorMes.diasSemAfastamento }
        : 'sem acesso',
      eventosEsocialPorSituacao: ind.esocial?.porSituacao ?? 'sem acesso',
      conformidadeLegal: ind.conformidade?.resumo ?? 'sem acesso',
    };
    const r = await this.perguntar(u,
      'Faça um resumo executivo das pendências de SST desta empresa a partir das contagens abaixo: o que é mais urgente, o que parece inconsistente e a ordem sugerida para tratar. Situações com valor zero não precisam ser citadas.',
      enviado);
    return this.gravar(u, { empresaId, tipo: 'resumo_pendencias', eventoId: null, titulo: 'Resumo de pendências', enviado }, r);
  }

  // ---------------------------------------------------------------- sugestões

  async listar(u: Usuario, f: { empresaId?: string; situacao?: string; eventoId?: string }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (f.empresaId) { params.push(f.empresaId); cond.push(`s.empresa_id = $${params.length}`); }
    if (f.situacao) { params.push(f.situacao); cond.push(`s.situacao = $${params.length}`); }
    if (f.eventoId) { params.push(f.eventoId); cond.push(`s.evento_id = $${params.length}`); }
    const perm = u.empresasCom('ia.usar');
    if (perm !== '*') { params.push(perm); cond.push(`s.empresa_id = ANY($${params.length}::uuid[])`); }
    return this.banco.tx(u.ctx(), (tx) => tx.query(
      `SELECT ${COLS} ${FROM} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
        ORDER BY s.situacao = 'pendente' DESC, s.criado_em DESC LIMIT 200`, params));
  }

  private obterTx(tx: Tx, id: string) {
    return tx.one(`SELECT ${COLS} ${FROM} WHERE s.id = $1`, [id]);
  }

  async obter(u: Usuario, id: string) {
    const s = await this.banco.tx(u.ctx(), (tx) => this.obterTx(tx, id));
    if (!s) throw new NotFoundException({ mensagem: 'Sugestão não encontrada' });
    u.exigir('ia.usar', s.empresaId);
    return s;
  }

  async aceitar(u: Usuario, id: string) {
    return this.decidir(u, id, 'aceita', null);
  }

  async descartar(u: Usuario, id: string, corpo: unknown) {
    const d = validar(descarteSugestaoSchema, corpo);
    return this.decidir(u, id, 'descartada', d.motivo);
  }

  private async decidir(u: Usuario, id: string, situacao: 'aceita' | 'descartada', motivo: string | null) {
    return this.banco.tx(u.ctx('ia'), async (tx) => {
      const s = await tx.one('SELECT id, empresa_id, situacao FROM sugestao_ia WHERE id = $1 FOR UPDATE', [id]);
      if (!s) throw new NotFoundException({ mensagem: 'Sugestão não encontrada' });
      if (!u.pode('ia.usar', s.empresa_id)) throw new ForbiddenException({ mensagem: 'Você não tem permissão para esta ação' });
      if (s.situacao !== 'pendente') throw erro('Esta sugestão já foi decidida');
      await tx.query(
        `UPDATE sugestao_ia SET situacao = $2, decidido_por = app.usuario_atual(), decidido_por_nome = $3, decidido_em = now(),
                motivo_descarte = $4 WHERE id = $1`, [id, situacao, u.nome, motivo]);
      return this.obterTx(tx, id);
    });
  }
}

/**
 * Tira nomes conhecidos (trabalhador e empresa), valores entre aspas das mensagens do validador,
 * códigos de CID e números de documentos antes de enviar o texto ao serviço de IA.
 */
export function semIdentificacao(texto: string, nomes: (string | null | undefined)[]): string {
  let t = texto;
  for (const n of nomes) {
    if (!n || n.trim().length < 3) continue;
    t = t.replace(new RegExp(n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[nome]');
  }
  t = t.replace(/'[^']*'/g, "'[valor]'").replace(/"[^"]*"/g, '"[valor]"');
  t = t.replace(/\b[A-TV-Z]\d{2}(\.\d{1,2})?\b/g, '[código]');
  return anonimizar(t).slice(0, 2000);
}
