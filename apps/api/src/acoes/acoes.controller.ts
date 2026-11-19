import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Eu, Requer } from '../auth/decoradores';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { enviarArquivo } from '../saude/saude.controller';
import { AcoesService } from './acoes.service';
import type { ArquivoEnviado } from './comum';
import { ConformidadeService } from './conformidade.service';
import { InspecoesService } from './inspecoes.service';

const opcional = (v: string | undefined, rotulo: string) => (v ? uuidValido(v, rotulo) : undefined);

@Controller()
export class AcoesController {
  constructor(private readonly svc: AcoesService) {}

  @Get('acoes')
  @Requer('acoes.ler')
  listar(@Eu() u: Usuario, @Query() q: Record<string, string | undefined>) {
    return this.svc.listar(u, {
      empresaId: opcional(q.empresaId, 'empresaId'), situacao: q.situacao, origem: q.origem, prioridade: q.prioridade,
      documentoId: opcional(q.documentoId, 'documentoId'), inspecaoId: opcional(q.inspecaoId, 'inspecaoId'),
      ocorrenciaId: opcional(q.ocorrenciaId, 'ocorrenciaId'), conformidadeId: opcional(q.conformidadeId, 'conformidadeId'),
      busca: q.busca?.trim().slice(0, 100) || undefined,
    });
  }

  @Post('acoes')
  @Requer('acoes.editar')
  criar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criar(u, body);
  }

  @Get('acoes/:id')
  @Requer('acoes.ler')
  obter(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obter(u, uuidValido(id));
  }

  @Put('acoes/:id')
  @Requer('acoes.editar')
  atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizar(u, uuidValido(id), body);
  }

  @Post('acoes/:id/situacao')
  @Requer('acoes.editar')
  situacao(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.mudarSituacao(u, uuidValido(id), body);
  }

  @Post('acoes/:id/reprogramacao')
  @Requer('acoes.editar')
  reprogramar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.reprogramar(u, uuidValido(id), body);
  }

  @Put('acoes/:id/dispensa-evidencia')
  @Requer('acoes.editar')
  dispensa(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.dispensa(u, uuidValido(id), body);
  }

  @Post('acoes/:id/evidencias')
  @Requer('acoes.editar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 50 * 1024 * 1024 } }))
  evidencia(@Eu() u: Usuario, @Param('id') id: string, @Body() body: Record<string, string>, @UploadedFile() arquivo?: ArquivoEnviado) {
    return this.svc.adicionarEvidencia(u, uuidValido(id), body, arquivo);
  }

  @Get('acao-evidencias/:id/arquivo')
  @Requer('acoes.ler')
  async baixarEvidencia(@Eu() u: Usuario, @Param('id') id: string, @Res() res: Response) {
    const a = await this.svc.arquivoEvidencia(u, uuidValido(id));
    enviarArquivo(res, a.nome, a.tipoMime, a.conteudo, true);
  }

  @Post('acoes/:id/validacao')
  @Requer('acoes.validar')
  validar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.validar(u, uuidValido(id), body);
  }

  @Post('acoes/:id/devolucao')
  @Requer('acoes.validar')
  devolver(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.devolver(u, uuidValido(id), body);
  }

  @Post('acoes/:id/cancelamento')
  @Requer('acoes.validar')
  cancelar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.cancelar(u, uuidValido(id), body);
  }

  /** Quem edita ou valida a ação pode comentar (conferido por empresa no serviço). */
  @Post('acoes/:id/comentarios')
  @Requer('acoes.ler')
  comentar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.comentar(u, uuidValido(id), body);
  }
}

@Controller()
export class InspecoesController {
  constructor(private readonly svc: InspecoesService) {}

  @Get('inspecoes')
  @Requer('inspecoes.ler')
  listar(@Eu() u: Usuario, @Query('empresaId') empresaId?: string, @Query('situacao') situacao?: string) {
    return this.svc.listarInspecoes(u, { empresaId: opcional(empresaId, 'empresaId'), situacao });
  }

  @Post('inspecoes')
  @Requer('inspecoes.editar')
  criar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criarInspecao(u, body);
  }

  @Get('inspecoes/:id')
  @Requer('inspecoes.ler')
  obter(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obterInspecao(u, uuidValido(id));
  }

  @Put('inspecoes/:id')
  @Requer('inspecoes.editar')
  atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarInspecao(u, uuidValido(id), body);
  }

  @Post('inspecoes/:id/itens')
  @Requer('inspecoes.editar')
  item(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.adicionarItem(u, uuidValido(id), body);
  }

  @Put('inspecao-itens/:id')
  @Requer('inspecoes.editar')
  atualizarItem(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarItem(u, uuidValido(id), body);
  }

  @Delete('inspecao-itens/:id')
  @Requer('inspecoes.editar')
  removerItem(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.removerItem(u, uuidValido(id));
  }

  @Post('inspecoes/:id/conclusao')
  @Requer('inspecoes.editar')
  concluir(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.concluirInspecao(u, uuidValido(id), body);
  }

  @Get('ocorrencias')
  @Requer('inspecoes.ler')
  ocorrencias(@Eu() u: Usuario, @Query('empresaId') empresaId?: string, @Query('situacao') situacao?: string) {
    return this.svc.listarOcorrencias(u, { empresaId: opcional(empresaId, 'empresaId'), situacao });
  }

  @Post('ocorrencias')
  @Requer('inspecoes.editar')
  criarOcorrencia(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criarOcorrencia(u, body);
  }

  @Get('ocorrencias/:id')
  @Requer('inspecoes.ler')
  ocorrencia(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obterOcorrencia(u, uuidValido(id));
  }

  @Put('ocorrencias/:id')
  @Requer('inspecoes.editar')
  atualizarOcorrencia(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarOcorrencia(u, uuidValido(id), body);
  }

  @Put('ocorrencias/:id/investigacao')
  @Requer('inspecoes.editar')
  investigacao(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.investigacao(u, uuidValido(id), body);
  }

  @Post('ocorrencias/:id/encerramento')
  @Requer('inspecoes.editar')
  encerrar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.encerrarOcorrencia(u, uuidValido(id), body);
  }
}

@Controller()
export class ConformidadeController {
  constructor(private readonly svc: ConformidadeService) {}

  @Get('requisitos')
  @Requer('conformidade.ler')
  requisitos(@Eu() u: Usuario, @Query('inativos') inativos?: string) {
    return this.svc.listarRequisitos(u, inativos === '1');
  }

  @Post('requisitos')
  @Requer('conformidade.editar')
  criarRequisito(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criarRequisito(u, body);
  }

  @Post('requisitos/dos-tipos-de-documento')
  @Requer('conformidade.editar')
  gerar(@Eu() u: Usuario) {
    return this.svc.gerarDosTipos(u);
  }

  @Put('requisitos/:id')
  @Requer('conformidade.editar')
  atualizarRequisito(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarRequisito(u, uuidValido(id), body);
  }

  @Get('conformidade')
  @Requer('conformidade.ler')
  matriz(@Eu() u: Usuario, @Query('empresaId') empresaId?: string, @Query('estabelecimentoId') estabelecimentoId?: string) {
    return this.svc.matriz(u, uuidValido(empresaId ?? '', 'empresaId'), opcional(estabelecimentoId, 'estabelecimentoId') ?? null);
  }

  @Put('conformidade')
  @Requer('conformidade.editar')
  salvar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.salvar(u, body);
  }

  @Get('conformidade/empresas')
  @Requer('conformidade.ler')
  empresas(@Eu() u: Usuario) {
    return this.svc.visaoEmpresas(u);
  }
}
