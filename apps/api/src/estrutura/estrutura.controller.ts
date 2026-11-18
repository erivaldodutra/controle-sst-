import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { EstruturaService, TIPOS } from './estrutura.service';

const tipoValido = (t: string) => {
  if (!TIPOS[t]) throw new NotFoundException({ mensagem: 'Tipo de cadastro desconhecido' });
  return t;
};

/** Setores, cargos, funções e GHE: /empresas/:empresaId/estrutura/:tipo e /estrutura/:tipo/:id */
@Controller()
export class EstruturaController {
  constructor(private readonly svc: EstruturaService) {}

  @Get('empresas/:empresaId/estrutura/:tipo')
  @Requer('estrutura.ler')
  listar(
    @Eu() u: Usuario,
    @Param('empresaId') empresaId: string,
    @Param('tipo') tipo: string,
    @Query('estabelecimentoId') estabelecimentoId?: string,
    @Query('inativos') inativos?: string,
  ) {
    return this.svc.listar(u, tipoValido(tipo), uuidValido(empresaId), {
      estabelecimentoId: estabelecimentoId ? uuidValido(estabelecimentoId) : undefined,
      incluirInativos: inativos === '1',
    });
  }

  @Post('empresas/:empresaId/estrutura/:tipo')
  @Requer('estrutura.editar')
  criar(@Eu() u: Usuario, @Param('empresaId') empresaId: string, @Param('tipo') tipo: string, @Body() body: unknown) {
    return this.svc.criar(u, tipoValido(tipo), uuidValido(empresaId), body);
  }

  @Put('estrutura/:tipo/:id')
  @Requer('estrutura.editar')
  atualizar(@Eu() u: Usuario, @Param('tipo') tipo: string, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizar(u, tipoValido(tipo), uuidValido(id), body);
  }
}
