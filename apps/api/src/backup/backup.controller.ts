import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { senhaSchema } from '@sst/shared';
import { z } from 'zod';
import { validar } from '../comum/validacao';
import { Requer } from '../auth/decoradores';

const configSchema = z.object({
  /** Pasta de destino (ex.: pendrive ou HD externo). null = pasta interna, junto dos dados. */
  pasta: z.string().trim().max(500).nullable(),
  frequencia: z.enum(['desligado', 'diario', 'semanal']),
  /** Também fazer backup ao fechar o sistema. */
  aoSair: z.boolean(),
  /** Quantos backups automáticos manter em cada pasta. */
  manter: z.number().int().min(1).max(100),
});
export type ConfigBackup = z.infer<typeof configSchema>;

export interface EstadoBackup {
  senhaConfigurada: boolean;
  pastaDados: string;
  pastaPadrao: string;
  /** Pasta onde o próximo backup será gravado. */
  pasta: string;
  aviso: string | null;
  config: ConfigBackup;
  proximoAutomatico: string | null;
  backups: { arquivo: string; pasta: string; caminho: string; criadoEm: string; bytes: number }[];
  /** Teste de restauração mais recente (o backup foi aberto num banco temporário e conferido). */
  ultimaVerificacao: VerificacaoBackup | null;
}

/** Resultado do teste de restauração: o backup sobe num banco separado e os dados são contados. */
export interface VerificacaoBackup {
  arquivo: string;
  verificadoEm: string;
  ok: boolean;
  /** Última atualização do banco presente no backup. */
  versaoBanco: string | null;
  contagens: Record<string, number>;
  duracaoMs: number;
  erro: string | null;
}

/** Implementado pelo aplicativo de desktop, que controla o banco embutido e os arquivos. */
export interface ServicoBackup {
  estado(): Promise<EstadoBackup>;
  definirSenha(senha: string): Promise<void>;
  configurar(c: ConfigBackup): Promise<ConfigBackup>;
  /** Abre a janela do Windows para escolher uma pasta (não grava nada). */
  escolherPasta(): Promise<{ pasta: string | null }>;
  criarAgora(): Promise<{ arquivo: string }>;
  /** Abre a janela "Salvar como" e copia o backup mais recente para o local escolhido. */
  exportar(): Promise<{ arquivo: string | null }>;
  /** Restaura um backup da lista (caminho) ou um escolhido na janela do Windows, e reinicia o aplicativo. */
  restaurar(senha: string, caminho?: string): Promise<{ restaurado: boolean }>;
  /** Testa a restauração num banco temporário, sem tocar no banco em uso. */
  verificar(senha: string, caminho?: string): Promise<VerificacaoBackup>;
}
export const SERVICO_BACKUP = Symbol('SERVICO_BACKUP');

@Controller('backup')
export class BackupController {
  constructor(@Inject(SERVICO_BACKUP) private readonly svc: ServicoBackup) {}

  @Get()
  @Requer('backup.gerenciar')
  estado() {
    return this.svc.estado();
  }

  @Post('senha')
  @Requer('backup.gerenciar')
  async senha(@Body() body: unknown) {
    await this.svc.definirSenha(validar(z.object({ senha: senhaSchema }), body).senha);
    return { ok: true };
  }

  @Post('configuracao')
  @Requer('backup.gerenciar')
  configurar(@Body() body: unknown) {
    return this.svc.configurar(validar(configSchema, body));
  }

  @Post('escolha-de-pasta')
  @Requer('backup.gerenciar')
  escolherPasta() {
    return this.svc.escolherPasta();
  }

  @Post('agora')
  @Requer('backup.gerenciar')
  agora() {
    return this.svc.criarAgora();
  }

  @Post('exportacao')
  @Requer('backup.gerenciar')
  exportar() {
    return this.svc.exportar();
  }

  @Post('restauracao')
  @Requer('backup.gerenciar')
  restaurar(@Body() body: unknown) {
    const b = validar(z.object({ senha: z.string().min(1), caminho: z.string().min(1).max(1000).optional() }), body);
    return this.svc.restaurar(b.senha, b.caminho);
  }

  @Post('verificacao')
  @Requer('backup.gerenciar')
  verificar(@Body() body: unknown) {
    const b = validar(z.object({ senha: z.string().min(1), caminho: z.string().min(1).max(1000).optional() }), body);
    return this.svc.verificar(b.senha, b.caminho);
  }
}
