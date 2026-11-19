import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Eu, Requer } from '../auth/decoradores';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { IaService } from './ia.service';

const opcional = (v: string | undefined, rotulo: string) => (v ? uuidValido(v, rotulo) : undefined);

/** Assistente de IA: só sugere. Aceitar ou descartar é sempre decisão de uma pessoa. */
@Controller('ia')
export class IaController {
  constructor(private readonly svc: IaService) {}

  @Get('config')
  @Requer('empresas.ler')
  config(@Eu() u: Usuario) {
    return this.svc.config(u);
  }

  @Put('config')
  @Requer('sistema.configurar')
  salvarConfig(@Eu() u: Usuario, @Body() b: unknown) {
    return this.svc.salvarConfig(u, b);
  }

  @Delete('config/chave')
  @Requer('sistema.configurar')
  removerChave(@Eu() u: Usuario) {
    return this.svc.removerChave(u);
  }

  @Post('eventos/:id/explicacao')
  @Requer('ia.usar')
  explicar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.explicarRejeicao(u, uuidValido(id));
  }

  @Post('empresas/:id/resumo')
  @Requer('ia.usar')
  resumo(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.resumoPendencias(u, uuidValido(id));
  }

  @Get('sugestoes')
  @Requer('ia.usar')
  listar(@Eu() u: Usuario, @Query() q: Record<string, string>) {
    const situacao = ['pendente', 'aceita', 'descartada'].includes(q.situacao ?? '') ? q.situacao : undefined;
    return this.svc.listar(u, { empresaId: opcional(q.empresaId, 'empresaId'), eventoId: opcional(q.eventoId, 'eventoId'), situacao });
  }

  @Get('sugestoes/:id')
  @Requer('ia.usar')
  obter(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obter(u, uuidValido(id));
  }

  @Post('sugestoes/:id/aceite')
  @Requer('ia.usar')
  aceitar(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.aceitar(u, uuidValido(id));
  }

  @Post('sugestoes/:id/descarte')
  @Requer('ia.usar')
  descartar(@Eu() u: Usuario, @Param('id') id: string, @Body() b: unknown) {
    return this.svc.descartar(u, uuidValido(id), b);
  }
}
