import {
  BadRequestException, Controller, Delete, Get, Param, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { ImportacaoService } from './importacao.service';

@Controller()
export class ImportacaoController {
  constructor(private readonly svc: ImportacaoService) {}

  @Get('importacoes/funcionarios/modelo')
  @Requer('funcionarios.importar')
  async modelo(@Res() res: Response) {
    const buf = await this.svc.modelo();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-funcionarios.xlsx"');
    res.send(buf);
  }

  @Get('empresas/:empresaId/importacoes')
  @Requer('funcionarios.importar')
  listar(@Eu() u: Usuario, @Param('empresaId') empresaId: string) {
    return this.svc.listar(u, uuidValido(empresaId));
  }

  @Post('empresas/:empresaId/importacoes/funcionarios')
  @Requer('funcionarios.importar')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  previa(@Eu() u: Usuario, @Param('empresaId') empresaId: string, @UploadedFile() arquivo?: { originalname: string; buffer: Buffer }) {
    if (!arquivo) throw new BadRequestException({ mensagem: 'Envie a planilha no campo "arquivo"' });
    return this.svc.previa(u, uuidValido(empresaId), arquivo.originalname, arquivo.buffer);
  }

  @Post('importacoes/:id/confirmacao')
  @Requer('funcionarios.importar')
  confirmar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.confirmar(u, uuidValido(id));
  }

  @Delete('importacoes/:id')
  @Requer('funcionarios.importar')
  async descartar(@Eu() u: Usuario, @Param('id') id: string) {
    await this.svc.descartar(u, uuidValido(id));
    return { ok: true };
  }
}
