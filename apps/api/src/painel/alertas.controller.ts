import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RELATORIOS, type TipoRelatorio } from '@sst/shared';
import { Eu, Requer } from '../auth/decoradores';
import { Usuario } from '../comum/contexto';
import { uuidValido } from '../comum/validacao';
import { enviarArquivo } from '../saude/saude.controller';
import { CalendarioService } from './calendario.service';
import { IndicadoresService } from './indicadores.service';
import { RelatoriosService } from './relatorios.service';

const opcional = (v: string | undefined, rotulo: string) => (v ? uuidValido(v, rotulo) : undefined);
const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Calendário de obrigações, notificações, indicadores do painel e central de relatórios. */
@Controller()
export class AlertasController {
  constructor(
    private readonly calendario: CalendarioService,
    private readonly ind: IndicadoresService,
    private readonly rel: RelatoriosService,
  ) {}

  @Get('calendario')
  @Requer('empresas.ler')
  itens(@Eu() u: Usuario, @Query() q: Record<string, string>) {
    return this.calendario.itens(u, { empresaId: opcional(q.empresaId, 'empresaId'), ate: data(q.ate) });
  }

  @Get('notificacoes')
  @Requer('empresas.ler')
  notificacoes(@Eu() u: Usuario, @Query('todas') todas?: string) {
    return this.calendario.notificacoes(u, { todas: todas === '1' });
  }

  @Get('notificacoes/preferencias')
  @Requer('empresas.ler')
  preferencias(@Eu() u: Usuario) {
    return this.calendario.preferencias(u);
  }

  @Put('notificacoes/preferencias')
  @Requer('empresas.ler')
  salvarPreferencias(@Eu() u: Usuario, @Body() b: unknown) {
    return this.calendario.salvarPreferencias(u, b);
  }

  @Post('notificacoes/lidas')
  @Requer('empresas.ler')
  todasLidas(@Eu() u: Usuario) {
    return this.calendario.marcarLida(u, 'todas');
  }

  @Post('notificacoes/:id/lida')
  @Requer('empresas.ler')
  lida(@Eu() u: Usuario, @Param('id') id: string) {
    return this.calendario.marcarLida(u, uuidValido(id));
  }

  @Get('indicadores')
  @Requer('empresas.ler')
  indicadores(@Eu() u: Usuario, @Query() q: Record<string, string>) {
    const meses = [6, 12, 24].includes(Number(q.meses)) ? Number(q.meses) : 12;
    return this.ind.indicadores(u, { empresaId: opcional(q.empresaId, 'empresaId'), meses });
  }

  @Get('relatorios')
  @Requer('empresas.ler')
  catalogo(@Eu() u: Usuario) {
    return this.rel.catalogo(u);
  }

  @Get('relatorios/:tipo')
  @Requer('empresas.ler')
  async relatorio(@Eu() u: Usuario, @Param('tipo') tipo: string, @Query() q: Record<string, string>, @Res() res: Response) {
    if (!(tipo in RELATORIOS)) throw new NotFoundException({ mensagem: 'Relatório não encontrado' });
    const f = { formato: q.formato, empresaId: q.empresaId || undefined, de: q.de || undefined, ate: q.ate || undefined };
    const r = await this.rel.gerar(u, tipo as TipoRelatorio, f);
    enviarArquivo(res, r.nome, r.mime, r.conteudo);
  }
}
