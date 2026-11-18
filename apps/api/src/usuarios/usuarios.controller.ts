import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { novoUsuarioSchema, senhaSchema, usuarioSchema } from '@sst/shared';
import { z } from 'zod';
import { Usuario } from '../comum/contexto';
import { uuidValido, validar } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { UsuariosService } from './usuarios.service';

@Controller()
export class UsuariosController {
  constructor(private readonly svc: UsuariosService) {}

  @Get('usuarios')
  @Requer('usuarios.gerenciar')
  listar(@Eu() u: Usuario) {
    return this.svc.listar(u);
  }

  @Get('perfis')
  perfis(@Eu() u: Usuario) {
    return this.svc.perfis(u);
  }

  @Post('usuarios')
  @Requer('usuarios.gerenciar')
  criar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criar(u, validar(novoUsuarioSchema, body));
  }

  @Put('usuarios/:id')
  @Requer('usuarios.gerenciar')
  async atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    await this.svc.atualizar(u, uuidValido(id), validar(usuarioSchema, body));
    return { ok: true };
  }

  @Post('usuarios/:id/redefinicao-senha')
  @Requer('usuarios.gerenciar')
  async redefinir(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    await this.svc.redefinirSenha(u, uuidValido(id), validar(z.object({ senhaTemporaria: senhaSchema }), body).senhaTemporaria);
    return { ok: true };
  }
}
