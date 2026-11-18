import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { pdfCertificado } from '../pdf/pdf';
import { enviarArquivo } from '../saude/saude.controller';
import { TreinamentosService } from './treinamentos.service';

const SITUACOES = ['planejada', 'realizada', 'cancelada'];

@Controller()
export class TreinamentosController {
  constructor(private readonly svc: TreinamentosService) {}

  @Get('treinamentos')
  @Requer('treinamentos.ler')
  biblioteca(@Eu() u: Usuario, @Query('inativos') inativos?: string) {
    return this.svc.listarBiblioteca(u, inativos === '1');
  }

  @Post('treinamentos')
  @Requer('treinamentos.editar')
  criar(@Eu() u: Usuario, @Body() body: unknown) {
    return this.svc.criarTreinamento(u, body);
  }

  @Put('treinamentos/:id')
  @Requer('treinamentos.editar')
  atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarTreinamento(u, uuidValido(id), body);
  }

  @Get('turmas')
  @Requer('treinamentos.ler')
  turmas(
    @Eu() u: Usuario,
    @Query('empresaId') empresaId?: string,
    @Query('situacao') situacao?: string,
    @Query('treinamentoId') treinamentoId?: string,
  ) {
    return this.svc.listarTurmas(u, {
      empresaId: empresaId ? uuidValido(empresaId) : undefined,
      situacao: situacao && SITUACOES.includes(situacao) ? situacao : undefined,
      treinamentoId: treinamentoId ? uuidValido(treinamentoId) : undefined,
    });
  }

  @Get('turmas/:id')
  @Requer('treinamentos.ler')
  turma(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obterTurma(u, uuidValido(id));
  }

  @Post('empresas/:empresaId/turmas')
  @Requer('treinamentos.editar')
  criarTurma(@Eu() u: Usuario, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    return this.svc.criarTurma(u, uuidValido(empresaId), body);
  }

  @Put('turmas/:id')
  @Requer('treinamentos.editar')
  atualizarTurma(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarTurma(u, uuidValido(id), body);
  }

  @Post('turmas/:id/cancelamento')
  @Requer('treinamentos.editar')
  cancelarTurma(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.cancelarTurma(u, uuidValido(id), body);
  }

  @Post('turmas/:id/participantes')
  @Requer('treinamentos.editar')
  adicionar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.adicionarParticipantes(u, uuidValido(id), body);
  }

  @Delete('turmas/:id/participantes/:participanteId')
  @Requer('treinamentos.editar')
  remover(@Eu() u: Usuario, @Param('id') id: string, @Param('participanteId') participanteId: string) {
    return this.svc.removerParticipante(u, uuidValido(id), uuidValido(participanteId));
  }

  @Post('turmas/:id/conclusao')
  @Requer('treinamentos.editar')
  concluir(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.concluirTurma(u, uuidValido(id), body);
  }

  @Get('participantes/:id/certificado')
  @Requer('treinamentos.ler')
  async certificado(@Eu() u: Usuario, @Param('id') id: string, @Res() res: Response) {
    const c = await this.svc.dadosCertificado(u, uuidValido(id));
    enviarArquivo(res, `Certificado ${c.treinamentoNome} ${c.funcionarioNome}.pdf`, 'application/pdf', await pdfCertificado(c));
  }

  @Get('empresas/:empresaId/matriz-treinamentos')
  @Requer('treinamentos.ler')
  matriz(@Eu() u: Usuario, @Param('empresaId') empresaId: string) {
    return this.svc.listarMatriz(u, uuidValido(empresaId));
  }

  @Post('empresas/:empresaId/matriz-treinamentos')
  @Requer('treinamentos.editar')
  adicionarMatriz(@Eu() u: Usuario, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    return this.svc.adicionarMatriz(u, uuidValido(empresaId), body);
  }

  @Delete('matriz-treinamentos/:id')
  @Requer('treinamentos.editar')
  removerMatriz(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.removerMatriz(u, uuidValido(id));
  }

  @Get('funcionarios/:id/treinamentos')
  @Requer('treinamentos.ler')
  doFuncionario(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.doFuncionario(u, uuidValido(id));
  }
}
