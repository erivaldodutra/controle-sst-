import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  admissaoSchema, afastamentoSchema, desligamentoSchema, movimentacaoSchema, pessoaSchema,
} from '@sst/shared';
import { z } from 'zod';
import { Usuario } from '../comum/contexto';
import { uuidValido, validar } from '../comum/validacao';
import { Eu, Requer } from '../auth/decoradores';
import { FuncionariosService } from './funcionarios.service';

const vinculoSchema = z.object({
  matricula: z.string().trim().min(1).max(30),
  categoria: z.string().regex(/^\d{3}$/).nullable().optional().transform((v) => v ?? null),
  tipoContrato: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional().transform((v) => v ?? null),
  jornada: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
});

const opcionalUuid = (v?: string) => (v ? uuidValido(v) : undefined);

@Controller()
export class FuncionariosController {
  constructor(private readonly svc: FuncionariosService) {}

  @Get('funcionarios')
  @Requer('funcionarios.ler')
  listar(@Eu() u: Usuario, @Query() q: Record<string, string>) {
    return this.svc.listar(u, {
      empresaId: opcionalUuid(q.empresaId),
      estabelecimentoId: opcionalUuid(q.estabelecimentoId),
      setorId: opcionalUuid(q.setorId),
      funcaoId: opcionalUuid(q.funcaoId),
      gheId: opcionalUuid(q.gheId),
      situacao: ['ativo', 'afastado', 'desligado', 'admissao_futura'].includes(q.situacao) ? q.situacao : undefined,
      busca: q.busca,
      pagina: Math.max(1, Number(q.pagina) || 1),
      limite: Math.min(200, Math.max(1, Number(q.limite) || 50)),
    });
  }

  @Get('funcionarios/:id')
  @Requer('funcionarios.ler')
  obter(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.obter(u, uuidValido(id));
  }

  @Get('funcionarios/:id/historico')
  @Requer('funcionarios.ler')
  historico(@Eu() u: Usuario, @Param('id') id: string) {
    return this.svc.historico(u, uuidValido(id));
  }

  @Post('empresas/:empresaId/funcionarios')
  @Requer('funcionarios.editar')
  admitir(@Eu() u: Usuario, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    return this.svc.admitir(u, uuidValido(empresaId), validar(admissaoSchema, body));
  }

  @Put('funcionarios/:id')
  @Requer('funcionarios.editar')
  async atualizar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    await this.svc.atualizarPessoa(u, uuidValido(id), validar(pessoaSchema, body));
    return { ok: true };
  }

  @Put('vinculos/:id')
  @Requer('funcionarios.editar')
  async atualizarVinculo(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    await this.svc.atualizarVinculo(u, uuidValido(id), validar(vinculoSchema, body));
    return { ok: true };
  }

  @Post('vinculos/:id/movimentacoes')
  @Requer('funcionarios.editar')
  async movimentar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    await this.svc.movimentar(u, uuidValido(id), validar(movimentacaoSchema, body));
    return { ok: true };
  }

  @Post('vinculos/movimentacao-em-lote')
  @Requer('funcionarios.editar')
  lote(@Eu() u: Usuario, @Body() body: unknown) {
    const d = validar(movimentacaoSchema.extend({ vinculoIds: z.array(z.string().uuid()).min(1).max(1000) }), body);
    return this.svc.movimentarLote(u, [...new Set(d.vinculoIds)], d);
  }

  @Post('vinculos/:id/afastamentos')
  @Requer('funcionarios.editar')
  afastar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.afastar(u, uuidValido(id), validar(afastamentoSchema, body));
  }

  @Post('afastamentos/:id/encerramento')
  @Requer('funcionarios.editar')
  async encerrar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    const d = validar(z.object({ fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), body);
    await this.svc.encerrarAfastamento(u, uuidValido(id), d.fim);
    return { ok: true };
  }

  @Post('vinculos/:id/desligamento')
  @Requer('funcionarios.editar')
  async desligar(@Eu() u: Usuario, @Param('id') id: string, @Body() body: unknown) {
    const d = validar(desligamentoSchema, body);
    await this.svc.desligar(u, uuidValido(id), d.data, d.motivo);
    return { ok: true };
  }
}
