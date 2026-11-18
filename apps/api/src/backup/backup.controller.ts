import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { senhaSchema } from '@sst/shared';
import { z } from 'zod';
import { validar } from '../comum/validacao';
import { Requer } from '../auth/decoradores';

/** Implementado pelo aplicativo de desktop, que controla o banco embutido e os arquivos. */
export interface ServicoBackup {
  estado(): Promise<{ senhaConfigurada: boolean; pasta: string; backups: { arquivo: string; criadoEm: string; bytes: number }[] }>;
  definirSenha(senha: string): Promise<void>;
  criarAgora(): Promise<{ arquivo: string }>;
  /** Abre a janela "Salvar como" e copia o backup mais recente para o local escolhido. */
  exportar(): Promise<{ arquivo: string | null }>;
  /** Abre a janela para escolher o arquivo, restaura e reinicia o aplicativo. */
  restaurar(senha: string): Promise<{ restaurado: boolean }>;
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
    return this.svc.restaurar(validar(z.object({ senha: z.string().min(1) }), body).senha);
  }
}
