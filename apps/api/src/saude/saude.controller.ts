import { Body, Controller, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { pdfAso } from '../pdf/pdf';
import { AsoService } from './aso.service';
import { cadastro, CadastrosSaudeService } from './cadastros.service';
import { VencimentosService } from './vencimentos.service';

const inteiro = (v: string | undefined, padrao: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : padrao;
};

/** Nome de arquivo seguro para o cabeçalho de download. */
export function enviarArquivo(res: Response, nome: string, tipo: string, conteudo: Buffer, inline = false) {
  const ascii = nome.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.send(conteudo);
}

@Controller()
export class SaudeController {
  constructor(
    private readonly cadastros: CadastrosSaudeService,
    private readonly asos: AsoService,
    private readonly vencimentos: VencimentosService,
  ) {}

  // ---- Médicos, clínicas e tipos de exame ----

  @Get('saude/:tipo')
  @Requer('saude.ler')
  listarCadastro(@Eu() u: Usuario, @Param('tipo') tipo: string, @Query('inativos') inativos?: string) {
    cadastro(tipo);
    return this.cadastros.listar(u, tipo, inativos === '1');
  }

  @Post('saude/:tipo')
  @Requer('saude.editar')
  criarCadastro(@Eu() u: Usuario, @Param('tipo') tipo: string, @Body() body: unknown) {
    return this.cadastros.criar(u, tipo, body);
  }

  @Put('saude/:tipo/:id')
  @Requer('saude.editar')
  atualizarCadastro(@Eu() u: Usuario, @Param('tipo') tipo: string, @Param('id') id: string, @Body() body: unknown) {
    return this.cadastros.atualizar(u, tipo, uuidValido(id), body);
  }

  @Get('empresas/:empresaId/medico-coordenador')
  @Requer('saude.ler')
  coordenadores(@Eu() u: Usuario, @Param('empresaId') empresaId: string) {
    return this.cadastros.coordenadores(u, uuidValido(empresaId));
  }

  @Post('empresas/:empresaId/medico-coordenador')
  @Requer('saude.editar')
  definirCoordenador(@Eu() u: Usuario, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    return this.cadastros.definirCoordenador(u, uuidValido(empresaId), body);
  }

  // ---- ASO ----

  @Get('asos')
  @Requer('saude.ler')
  listarAsos(
    @Eu() u: Usuario,
    @Query('empresaId') empresaId?: string,
    @Query('funcionarioId') funcionarioId?: string,
    @Query('tipo') tipo?: string,
    @Query('situacao') situacao?: string,
    @Query('pagina') pagina?: string,
    @Query('limite') limite?: string,
  ) {
    return this.asos.listar(u, {
      empresaId: empresaId ? uuidValido(empresaId) : undefined,
      funcionarioId: funcionarioId ? uuidValido(funcionarioId) : undefined,
      tipo: tipo !== undefined && tipo !== '' && /^\d$/.test(tipo) ? Number(tipo) : undefined,
      situacao: situacao || undefined,
      pagina: inteiro(pagina, 1, 100000),
      limite: inteiro(limite, 50, 200),
    });
  }

  @Get('asos/:id')
  @Requer('saude.ler')
  obterAso(@Eu() u: Usuario, @Param('id') id: string) {
    return this.asos.obter(u, uuidValido(id));
  }

  @Post('asos')
  @Requer('saude.editar')
  criarAso(@Eu() u: Usuario, @Body() body: unknown) {
    return this.asos.criar(u, body);
  }

  @Put('asos/:id')
  @Requer('saude.editar')
  atualizarAso(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.asos.atualizar(u, uuidValido(id), body);
  }

  @Post('asos/:id/cancelamento')
  @Requer('saude.editar')
  cancelarAso(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.asos.cancelar(u, uuidValido(id), body);
  }

  @Put('aso-exames/:id/resultado')
  @Requer('saude.clinico')
  resultado(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.asos.registrarResultado(u, uuidValido(id), body);
  }

  @Post('asos/:id/arquivo')
  @Requer('saude.editar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  anexar(@Eu() u: Usuario, @Param('id') id: string, @UploadedFile() arquivo?: { originalname: string; mimetype: string; buffer: Buffer }) {
    return this.asos.anexar(u, uuidValido(id), arquivo);
  }

  @Get('asos/:id/arquivo')
  @Requer('saude.ler')
  async baixarArquivo(@Eu() u: Usuario, @Param('id') id: string, @Res() res: Response) {
    const a = await this.asos.arquivo(u, uuidValido(id));
    enviarArquivo(res, a.nome, a.tipoMime, a.conteudo);
  }

  @Get('asos/:id/pdf')
  @Requer('saude.ler')
  async pdf(@Eu() u: Usuario, @Param('id') id: string, @Res() res: Response) {
    const dados = await this.asos.dadosPdf(u, uuidValido(id));
    enviarArquivo(res, `ASO ${dados.funcionarioNome} ${dados.dataExame}.pdf`, 'application/pdf', await pdfAso(dados));
  }

  // ---- Vencimentos e prazos de alerta ----

  @Get('vencimentos')
  @Requer('empresas.ler')
  listarVencimentos(
    @Eu() u: Usuario,
    @Query('empresaId') empresaId?: string,
    @Query('tipo') tipo?: string,
    @Query('todos') todos?: string,
    @Query('resumo') soResumo?: string,
  ) {
    // Com dezenas de milhares de funcionários a tela recebe só as 2.000 pendências mais urgentes; o resumo conta todas.
    return this.vencimentos.listar(u, {
      empresaId: empresaId ? uuidValido(empresaId) : undefined,
      tipo: tipo === 'aso' || tipo === 'treinamento' ? tipo : undefined,
      incluirEmDia: todos === '1',
      max: soResumo === '1' ? 0 : 2000,
    });
  }

  @Get('configuracoes/alertas')
  @Requer('empresas.ler')
  config(@Eu() u: Usuario) {
    return this.vencimentos.config(u);
  }

  @Put('configuracoes/alertas')
  @Requer('sistema.configurar')
  salvarConfig(@Eu() u: Usuario, @Body() body: unknown) {
    return this.vencimentos.salvarConfig(u, body);
  }
}
