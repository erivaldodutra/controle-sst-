import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { Eu, Requer } from '../auth/decoradores';
import { Usuario } from '../comum/contexto';
import { RetencaoService } from './retencao.service';

/** Política de segurança da sessão e de retenção de dados. */
@Controller('seguranca')
export class SegurancaController {
  constructor(private readonly ret: RetencaoService) {}

  @Get('politica')
  @Requer('sistema.configurar')
  politica(@Eu() u: Usuario) {
    return this.ret.politica(u);
  }

  @Put('politica')
  @Requer('sistema.configurar')
  salvar(@Eu() u: Usuario, @Body() corpo: unknown) {
    return this.ret.salvar(u, corpo);
  }

  @Post('retencao')
  @Requer('sistema.configurar')
  executar(@Eu() u: Usuario) {
    return this.ret.executarAgora(u);
  }
}
