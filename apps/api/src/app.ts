import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AuthController } from './auth/auth.controller';
import { BackupController, SERVICO_BACKUP, type ServicoBackup } from './backup/backup.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { BANCO, CONFIG, type Configuracao } from './comum/config';
import { FiltroErros } from './comum/erros';
import { Banco } from './db/banco';
import { EmpresasController } from './empresas/empresas.controller';
import { EmpresasService } from './empresas/empresas.service';
import { EstruturaController } from './estrutura/estrutura.controller';
import { EstruturaService } from './estrutura/estrutura.service';
import { FuncionariosController } from './funcionarios/funcionarios.controller';
import { FuncionariosService } from './funcionarios/funcionarios.service';
import { ImportacaoController } from './importacao/importacao.controller';
import { ImportacaoService } from './importacao/importacao.service';
import { PainelController } from './painel/painel.controller';
import { UsuariosController } from './usuarios/usuarios.controller';
import { UsuariosService } from './usuarios/usuarios.service';

export interface OpcoesApp {
  config: Configuracao;
  /** Pasta com a interface compilada, servida na raiz (usada pelo aplicativo de desktop). */
  pastaWeb?: string;
  log?: boolean;
  /** Presente só no aplicativo de desktop. */
  backup?: ServicoBackup;
}

export async function criarApp(op: OpcoesApp): Promise<{ app: INestApplication; banco: Banco }> {
  const banco = new Banco(op.config.urlApp);

  @Module({
    controllers: [
      AuthController, EmpresasController, EstruturaController, FuncionariosController,
      ImportacaoController, UsuariosController, PainelController,
      ...(op.backup ? [BackupController] : []),
    ],
    providers: [
      { provide: CONFIG, useValue: op.config },
      { provide: BANCO, useValue: banco },
      ...(op.backup ? [{ provide: SERVICO_BACKUP, useValue: op.backup }] : []),
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_FILTER, useClass: FiltroErros },
      AuthService, EmpresasService, EstruturaService, FuncionariosService, ImportacaoService, UsuariosService,
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: op.log === false ? false : ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.set('trust proxy', false);
  // Cabeçalhos de segurança básicos (o app roda só em 127.0.0.1, sem acesso externo).
  http.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    next();
  });
  // Proteção CSRF: mutações só com cabeçalho próprio (navegador não envia em formulário de outro site).
  http.use('/api', (req: any, res: any, next: any) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('x-sst') !== '1') {
      res.status(403).json({ mensagem: 'Requisição recusada' });
      return;
    }
    next();
  });
  if (op.pastaWeb) {
    const express = require('express');
    const path = require('node:path');
    http.use(express.static(op.pastaWeb, { index: 'index.html' }));
    http.get(/^\/(?!api\/).*/, (_req: any, res: any) => res.sendFile(path.join(op.pastaWeb, 'index.html')));
  }
  return { app, banco };
}
