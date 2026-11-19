import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CATEGORIAS_LEGAIS, politicaSchema } from '@sst/shared';
import { BANCO } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { Banco } from '../db/banco';

/** Data mais antiga e quantidade por categoria de registro com valor legal (nunca apagados). */
const CONTAGENS: Record<string, string> = {
  aso: 'SELECT count(*)::int AS n, min(data_exame)::text AS desde FROM aso',
  documento: 'SELECT count(*)::int AS n, min(coalesce(data_emissao, data_elaboracao, criado_em::date))::text AS desde FROM documento_versao',
  treinamento: 'SELECT count(*)::int AS n, min(criado_em)::date::text AS desde FROM turma_participante',
  ocorrencia: 'SELECT count(*)::int AS n, min(data_hora)::date::text AS desde FROM ocorrencia',
  acao: 'SELECT count(*)::int AS n, min(data_abertura)::text AS desde FROM acao',
  esocial: 'SELECT count(*)::int AS n, min(criado_em)::date::text AS desde FROM esocial_evento',
  auditoria: 'SELECT count(*)::int AS n, min(criado_em)::date::text AS desde FROM auditoria',
};

const HORAS_ENTRE_TENTATIVAS = 6;

/**
 * Política de retenção: só apaga dados temporários (avisos já lidos e sessões encerradas),
 * no prazo configurado. Roda ao abrir o programa e a cada 6 horas (no máximo uma vez por dia).
 */
@Injectable()
export class RetencaoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Retencao');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  onApplicationBootstrap() {
    void this.executarTodos();
    this.timer = setInterval(() => void this.executarTodos(), HORAS_ENTRE_TENTATIVAS * 3600_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async executarTodos() {
    try {
      await this.banco.semContexto((tx) => tx.one('SELECT app.aplicar_retencao_todos() AS n'));
    } catch (e) {
      this.log.warn(`Falha ao aplicar a retenção: ${(e as Error).message}`);
    }
  }

  async politica(u: Usuario) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const c = (await tx.one(
        `SELECT inatividade_minutos AS "inatividadeMinutos", retencao_avisos_dias AS "retencaoAvisosDias",
                retencao_sessoes_dias AS "retencaoSessoesDias" FROM tenant_config`,
      ))!;
      const categorias = [];
      for (const cat of CATEGORIAS_LEGAIS) {
        const r = (await tx.one(CONTAGENS[cat.chave]))!;
        categorias.push({ ...cat, registros: r.n, desde: r.desde });
      }
      const execucoes = await tx.query(
        `SELECT executada_em AS "executadaEm", avisos_removidos AS "avisosRemovidos", sessoes_removidas AS "sessoesRemovidas"
           FROM retencao_execucao ORDER BY executada_em DESC LIMIT 10`,
      );
      return { ...c, categorias, execucoes };
    });
  }

  async salvar(u: Usuario, corpo: unknown) {
    const d = validar(politicaSchema, corpo);
    await this.banco.tx(u.ctx('politica_seguranca'), (tx) =>
      tx.query(
        'UPDATE tenant_config SET inatividade_minutos = $1, retencao_avisos_dias = $2, retencao_sessoes_dias = $3',
        [d.inatividadeMinutos, d.retencaoAvisosDias, d.retencaoSessoesDias],
      ),
    );
    return this.politica(u);
  }

  /** Executa a limpeza agora (mesmo que já tenha rodado hoje) e devolve o que foi removido. */
  async executarAgora(u: Usuario) {
    return this.banco.tx(u.ctx('retencao_manual'), async (tx) => {
      const r = await tx.one('SELECT avisos, sessoes FROM app.aplicar_retencao(app.tenant_atual(), true)');
      return { avisosRemovidos: r?.avisos ?? 0, sessoesRemovidas: r?.sessoes ?? 0 };
    });
  }
}
