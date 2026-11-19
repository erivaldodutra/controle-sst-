import { Body, Controller, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { enviarArquivo } from '../saude/saude.controller';
import { DocumentosService } from './documentos.service';

const opcional = (v: string | undefined, rotulo: string) => (v ? uuidValido(v, rotulo) : undefined);

@Controller()
export class DocumentosController {
  constructor(private readonly svc: DocumentosService) {}

  // ---- Biblioteca de tipos ----

  @Get('documentos-tipos')
  @Requer('documentos.ler')
  tipos(@Eu() u: Usuario, @Query('inativos') inativos?: string) {
    return this.svc.listarTipos(u, inativos === '1');
  }

  @Post('documentos-tipos')
  @Requer('documentos.editar')
  criarTipo(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criarTipo(u, body);
  }

  @Post('documentos-tipos/biblioteca')
  @Requer('documentos.editar')
  biblioteca(@Eu() u: Usuario) {
    return this.svc.carregarBiblioteca(u);
  }

  @Put('documentos-tipos/:id')
  @Requer('documentos.editar')
  atualizarTipo(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarTipo(u, uuidValido(id), body);
  }

  // ---- Documentos ----

  @Get('documentos')
  @Requer('documentos.ler')
  listar(@Eu() u: Usuario, @Query('empresaId') empresaId?: string, @Query('tipoId') tipoId?: string, @Query('situacao') situacao?: string) {
    return this.svc.listar(u, { empresaId: opcional(empresaId, 'empresaId'), tipoId: opcional(tipoId, 'tipoId'), situacao });
  }

  @Post('documentos')
  @Requer('documentos.editar')
  criar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criar(u, body);
  }

  @Get('documentos/:id')
  @Requer('documentos.ler')
  obter(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obter(u, uuidValido(id));
  }

  @Put('documentos/:id')
  @Requer('documentos.editar')
  atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizar(u, uuidValido(id), body);
  }

  @Put('documentos/:id/aplicabilidade')
  @Requer('documentos.editar')
  aplicabilidade(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.aplicabilidade(u, uuidValido(id), body);
  }

  /** Corpo { data, motivo } sinaliza; corpo vazio retira a sinalização. */
  @Put('documentos/:id/mudanca-condicoes')
  @Requer('documentos.editar')
  mudanca(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.mudancaCondicoes(u, uuidValido(id), body);
  }

  @Post('documentos/:id/substituicao')
  @Requer('documentos.editar')
  substituir(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.substituir(u, uuidValido(id), body);
  }

  @Post('documentos/:id/acompanhamentos')
  @Requer('documentos.editar')
  acompanhamento(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.registrarAcompanhamento(u, uuidValido(id), body);
  }

  // ---- Versões ----

  @Post('documentos/:id/versoes')
  @Requer('documentos.editar')
  criarVersao(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.criarVersao(u, uuidValido(id), body);
  }

  @Put('documento-versoes/:id')
  @Requer('documentos.editar')
  atualizarVersao(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarVersao(u, uuidValido(id), body);
  }

  @Post('documento-versoes/:id/emissao')
  @Requer('documentos.editar')
  publicar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.publicarVersao(u, uuidValido(id));
  }

  @Post('documento-versoes/:id/cancelamento')
  @Requer('documentos.editar')
  cancelar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.cancelarVersao(u, uuidValido(id), body);
  }

  @Post('documento-versoes/:id/arquivo')
  @Requer('documentos.editar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 50 * 1024 * 1024 } }))
  anexar(@Eu() u: Usuario, @Param('id') id: string, @UploadedFile() arquivo?: { originalname: string; mimetype: string; buffer: Buffer }) {
    return this.svc.anexar(u, uuidValido(id), arquivo);
  }

  @Get('documento-versoes/:id/arquivo')
  @Requer('documentos.ler')
  async baixar(@Eu() u: Usuario, @Param('id') id: string, @Res() res: Response) {
    const a = await this.svc.arquivo(u, uuidValido(id));
    enviarArquivo(res, a.nome, a.tipoMime, a.conteudo, a.tipoMime === 'application/pdf');
  }
}
