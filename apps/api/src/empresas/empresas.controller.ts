import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { empresaSchema, estabelecimentoSchema } from '@sst/shared';
import { z } from 'zod';
import { Usuario } from '../comum/contexto';
import { uuidValido, validar } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { EmpresasService } from './empresas.service';

@Controller()
export class EmpresasController {
  constructor(private readonly svc: EmpresasService) {}

  @Get('empresas')
  @Requer('empresas.ler')
  listar(@Eu() u: Usuario, @Query('busca') busca?: string, @Query('inativas') inativas?: string) {
    return this.svc.listar(u, { busca, incluirInativas: inativas === '1' });
  }

  @Get('empresas/:id')
  @Requer('empresas.ler')
  obter(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obter(u, uuidValido(id));
  }

  @Post('empresas')
  @Requer('empresas.editar')
  criar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criar(u, validar(empresaSchema, body));
  }

  @Put('empresas/:id')
  @Requer('empresas.editar')
  atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizar(u, uuidValido(id), validar(empresaSchema, body));
  }

  @Patch('empresas/:id/ativo')
  @Requer('empresas.editar')
  async ativo(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    await this.svc.definirAtiva(u, uuidValido(id), validar(z.object({ ativo: z.boolean() }), body).ativo);
    return { ok: true };
  }

  @Get('empresas/:id/estabelecimentos')
  @Requer('empresas.ler')
  estabelecimentos(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.listarEstabelecimentos(u, uuidValido(id));
  }

  @Post('empresas/:id/estabelecimentos')
  @Requer('empresas.editar')
  criarEstab(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.criarEstabelecimento(u, uuidValido(id), validar(estabelecimentoSchema, body));
  }

  @Put('estabelecimentos/:id')
  @Requer('empresas.editar')
  atualizarEstab(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    const d = validar(estabelecimentoSchema, body);
    const ativo = validar(z.object({ ativo: z.boolean().optional() }), body).ativo;
    return this.svc.atualizarEstabelecimento(u, uuidValido(id), { ...d, ativo });
  }
}
