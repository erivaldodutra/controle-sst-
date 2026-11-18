import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { configuracaoInicialSchema, loginSchema, senhaSchema } from '@sst/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import { CONFIG, type Configuracao } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { validar } from '../comum/validacao';
import { COOKIE_SESSAO } from './auth.guard';
import { AuthService } from './auth.service';
import { Eu, Publica } from './decoradores';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly cfg: Configuracao) {}

  @Publica()
  @Get('estado')
  async estado() {
    return { configurado: await this.auth.configurado() };
  }

  @Publica()
  @Post('configuracao-inicial')
  @HttpCode(201)
  async configurar(@Body() body: unknown) {
    await this.auth.configurarSistema(validar(configuracaoInicialSchema, body));
    return { ok: true };
  }

  @Publica()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const d = validar(loginSchema, body);
    const token = await this.auth.login(d.email, d.senha, d.codigoMfa, { ip: req.ip, agente: req.get('user-agent') });
    res.cookie(COOKIE_SESSAO, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.cfg.cookieSeguro,
      path: '/',
      maxAge: this.cfg.horasSessao * 3600_000,
    });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Eu() u: Usuario, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(u);
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  }

  @Get('eu')
  eu(@Eu() u: Usuario) {
    return {
      id: u.id,
      nome: u.nome,
      email: u.email,
      deveTrocarSenha: u.deveTrocarSenha,
      empresas: u.empresas,
      permissoes: u.permissoes,
      atribuicoes: u.atribuicoes.map((a) => ({ perfil: a.perfil, empresaId: a.empresaId })),
    };
  }

  @Post('senha')
  @HttpCode(200)
  async senha(@Eu() u: Usuario, @Body() body: unknown) {
    const d = validar(z.object({ atual: z.string().min(1), nova: senhaSchema }), body);
    await this.auth.trocarSenha(u, d.atual, d.nova);
    return { ok: true };
  }

  @Post('mfa/iniciar')
  @HttpCode(200)
  iniciarMfa(@Eu() u: Usuario) {
    return this.auth.iniciarMfa(u);
  }

  @Post('mfa/confirmar')
  @HttpCode(200)
  async confirmarMfa(@Eu() u: Usuario, @Body() body: unknown) {
    await this.auth.confirmarMfa(u, validar(z.object({ codigo: z.string().min(6) }), body).codigo);
    return { ok: true };
  }

  @Post('mfa/desativar')
  @HttpCode(200)
  async desativarMfa(@Eu() u: Usuario, @Body() body: unknown) {
    await this.auth.desativarMfa(u, validar(z.object({ senha: z.string().min(1) }), body).senha);
    return { ok: true };
  }
}
