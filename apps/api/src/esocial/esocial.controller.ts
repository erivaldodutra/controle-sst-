import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Eu, Requer } from '../auth/decoradores';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { enviarArquivo } from '../saude/saude.controller';
import { CadastrosEsocialService } from './cadastros.service';
import { EsocialService } from './esocial.service';

const opcional = (v: string | undefined, rotulo: string) => (v ? uuidValido(v, rotulo) : undefined);
const ids = (b: any): string[] => (Array.isArray(b?.ids) ? b.ids.map((x: string) => uuidValido(String(x))) : []);

@Controller('esocial')
export class EsocialController {
  constructor(private readonly svc: EsocialService, private readonly cad: CadastrosEsocialService) {}

  // ---- Configuração e certificado ----
  @Get('config/:empresaId')
  @Requer('esocial.ler')
  config(@Eu() u: Usuario, @Param('empresaId') id: string) {
    return this.svc.obterConfig(u, uuidValido(id));
  }

  @Put('config/:empresaId')
  @Requer('esocial.configurar')
  salvarConfig(@Eu() u: Usuario, @Param('empresaId') id: string, @Body() b: unknown) {
    return this.svc.salvarConfig(u, uuidValido(id), b);
  }

  @Post('config/:empresaId/liberar-producao')
  @Requer('esocial.configurar')
  liberar(@Eu() u: Usuario, @Param('empresaId') id: string) {
    return this.svc.liberarProducao(u, uuidValido(id));
  }

  @Post('config/:empresaId/cadeia')
  @Requer('esocial.configurar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 512 * 1024 } }))
  cadeia(@Eu() u: Usuario, @Param('empresaId') id: string, @UploadedFile() arquivo?: { buffer: Buffer }) {
    return this.svc.salvarCadeia(u, uuidValido(id), arquivo);
  }

  @Post('config/:empresaId/certificado')
  @Requer('esocial.configurar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 512 * 1024 } }))
  certificado(@Eu() u: Usuario, @Param('empresaId') id: string, @Body() b: Record<string, string>,
    @UploadedFile() arquivo?: { buffer: Buffer; originalname: string }) {
    return this.svc.enviarCertificado(u, uuidValido(id), b?.senha, arquivo);
  }

  @Delete('config/:empresaId/certificado')
  @Requer('esocial.configurar')
  removerCertificado(@Eu() u: Usuario, @Param('empresaId') id: string) {
    return this.svc.removerCertificado(u, uuidValido(id));
  }

  // ---- Tabelas oficiais ----
  @Get('tabelas/:n')
  @Requer('esocial.ler')
  tabela(@Eu() u: Usuario, @Param('n') n: string, @Query('busca') busca?: string, @Query('codigos') codigos?: string) {
    return this.cad.tabela(u, Number(n), busca?.trim().slice(0, 100) || undefined, codigos ? codigos.split(',').slice(0, 100) : undefined);
  }

  // ---- Agentes nocivos e responsáveis ambientais ----
  @Get('agentes')
  @Requer('esocial.ler')
  agentes(@Eu() u: Usuario, @Query('empresaId') e?: string, @Query('gheId') g?: string) {
    return this.cad.listarAgentes(u, { empresaId: opcional(e, 'empresaId'), gheId: opcional(g, 'gheId') });
  }

  @Post('agentes')
  @Requer('esocial.preparar')
  criarAgente(@Eu() u: Usuario, @Body() b: unknown) {
    return this.cad.criarAgente(u, b);
  }

  @Put('agentes/:id')
  @Requer('esocial.preparar')
  atualizarAgente(@Eu() u: Usuario, @Param('id') id: string, @Body() b: unknown) {
    return this.cad.atualizarAgente(u, uuidValido(id), b);
  }

  @Delete('agentes/:id')
  @Requer('esocial.preparar')
  removerAgente(@Eu() u: Usuario, @Param('id') id: string) {
    return this.cad.removerAgente(u, uuidValido(id));
  }

  @Get('responsaveis')
  @Requer('esocial.ler')
  responsaveis(@Eu() u: Usuario, @Query('empresaId') e: string) {
    return this.cad.listarResponsaveis(u, uuidValido(e ?? '', 'empresaId'));
  }

  @Post('responsaveis')
  @Requer('esocial.preparar')
  criarResponsavel(@Eu() u: Usuario, @Body() b: unknown) {
    return this.cad.criarResponsavel(u, b);
  }

  @Put('responsaveis/:id')
  @Requer('esocial.preparar')
  atualizarResponsavel(@Eu() u: Usuario, @Param('id') id: string, @Body() b: unknown) {
    return this.cad.atualizarResponsavel(u, uuidValido(id), b);
  }

  // ---- CAT ----
  @Get('ocorrencias/:id/cats')
  @Requer('esocial.ler')
  cats(@Eu() u: Usuario, @Param('id') id: string) {
    return this.cad.listarCats(u, uuidValido(id));
  }

  @Post('ocorrencias/:id/cats')
  @Requer('esocial.preparar')
  criarCat(@Eu() u: Usuario, @Param('id') id: string, @Body() b: unknown) {
    return this.cad.criarCat(u, uuidValido(id), b);
  }

  @Put('cats/:id')
  @Requer('esocial.preparar')
  atualizarCat(@Eu() u: Usuario, @Param('id') id: string, @Body() b: unknown) {
    return this.cad.atualizarCat(u, uuidValido(id), b);
  }

  @Put('cats/:id/atestado')
  @Requer('saude.clinico')
  atestado(@Eu() u: Usuario, @Param('id') id: string, @Body() b: unknown) {
    return this.cad.gravarAtestado(u, uuidValido(id), b);
  }

  // ---- Eventos ----
  @Get('pendencias/:empresaId')
  @Requer('esocial.ler')
  pendencias(@Eu() u: Usuario, @Param('empresaId') id: string) {
    return this.svc.pendencias(u, uuidValido(id));
  }

  @Get('painel')
  @Requer('esocial.ler')
  painel(@Eu() u: Usuario, @Query('empresaId') e?: string) {
    return this.svc.painel(u, opcional(e, 'empresaId'));
  }

  @Get('eventos')
  @Requer('esocial.ler')
  eventos(@Eu() u: Usuario, @Query() q: Record<string, string | undefined>) {
    return this.svc.listar(u, { empresaId: opcional(q.empresaId, 'empresaId'), situacao: q.situacao, tipo: q.tipo, busca: q.busca?.trim().slice(0, 100) || undefined });
  }

  @Get('eventos/:id')
  @Requer('esocial.ler')
  evento(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obter(u, uuidValido(id));
  }

  @Get('eventos/:id/xml')
  @Requer('esocial.ler')
  async baixarXml(@Eu() u: Usuario, @Param('id') id: string, @Query('qual') qual: string, @Res() res: Response) {
    const x = await this.svc.xml(u, uuidValido(id), qual === 'recibo' ? 'recibo' : 'evento');
    enviarArquivo(res, x.nome, 'application/xml', x.conteudo);
  }

  @Post('preparar/s2220/:asoId')
  @Requer('esocial.preparar')
  s2220(@Eu() u: Usuario, @Param('asoId') id: string) {
    return this.svc.prepararS2220(u, uuidValido(id));
  }

  @Post('preparar/s2240')
  @Requer('esocial.preparar')
  s2240(@Eu() u: Usuario, @Body() b: unknown) {
    return this.svc.prepararS2240(u, b);
  }

  @Post('preparar/s2210/:catId')
  @Requer('esocial.preparar')
  s2210(@Eu() u: Usuario, @Param('catId') id: string) {
    return this.svc.prepararS2210(u, uuidValido(id));
  }

  @Post('eventos/:id/refazer')
  @Requer('esocial.preparar')
  refazer(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.refazer(u, uuidValido(id));
  }

  @Post('eventos/:id/retificar')
  @Requer('esocial.transmitir')
  retificar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.retificar(u, uuidValido(id));
  }

  @Post('eventos/:id/excluir')
  @Requer('esocial.transmitir')
  excluir(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.excluir(u, uuidValido(id));
  }

  @Post('eventos/:id/descartar')
  @Requer('esocial.preparar')
  descartar(@Eu() u: Usuario, @Param('id') id: string, @Body() b: { motivo?: string }) {
    return this.svc.descartar(u, uuidValido(id), b?.motivo);
  }

  @Post('eventos/:id/desaprovar')
  @Requer('esocial.transmitir')
  desaprovar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.desaprovar(u, uuidValido(id));
  }

  @Post('aprovacao')
  @Requer('esocial.transmitir')
  aprovar(@Eu() u: Usuario, @Body() b: unknown) {
    return this.svc.aprovar(u, ids(b));
  }

  // ---- Lotes ----
  @Post('envio/:empresaId')
  @Requer('esocial.transmitir')
  enviar(@Eu() u: Usuario, @Param('empresaId') id: string, @Body() b: unknown) {
    const lista = ids(b);
    return this.svc.enviar(u, uuidValido(id), lista.length ? lista : undefined);
  }

  @Get('lotes')
  @Requer('esocial.ler')
  lotes(@Eu() u: Usuario, @Query('empresaId') e?: string) {
    return this.svc.listarLotes(u, { empresaId: opcional(e, 'empresaId') });
  }

  @Get('lotes/:id')
  @Requer('esocial.ler')
  lote(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obterLote(u, uuidValido(id));
  }

  @Post('lotes/:id/consulta')
  @Requer('esocial.transmitir')
  consultar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.consultar(u, uuidValido(id));
  }
}
