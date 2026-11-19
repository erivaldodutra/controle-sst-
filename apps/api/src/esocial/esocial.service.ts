import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  configEsocialSchema, ENDERECOS_ESOCIAL, idEvento, inscricaoEmpregador, MAX_EVENTOS_LOTE, preparoS2240Schema, prazoEvento,
  problemasAgente, problemasCat, problemasConjuntoAgentes, TIPO_ACIDENTE_OCORRENCIA, type TipoEventoEsocial,
} from '@sst/shared';
import { erro, naoEncontrado } from '../acoes/comum';
import { BANCO, CONFIG, type Configuracao } from '../comum/config';
import { Usuario } from '../comum/contexto';
import { cifrar, decifrar } from '../comum/cripto';
import { validar } from '../comum/validacao';
import { Banco, Tx } from '../db/banco';
import { abrirPfx, assinar, type CertificadoAberto } from './certificado';
import { Esquemas, type ErroValidacao } from './esquemas';
import { chamarWebservice, FalhaComunicacao } from './transmissao';
import {
  lerRetornoConsulta, lerRetornoEnvio, xmlConsulta, xmlLote, xmlS2210, xmlS2220, xmlS2240, xmlS3000, XSD_EVENTO,
  type IdeEmpregador, type IdeEvento,
} from './xml';

const VER_PROC = 'ControleSST 1.5';
/** Procedimentos da Tabela 27 que exigem observação (obsProc). */
const EXIGE_OBS_PROC = ['0583', '0998', '0999', '1128', '1230', '1992', '1993', '1994', '1995', '1996', '1997', '1998', '1999', '9999'];
/** Avaliação clínica ocupacional: todo ASO pressupõe o exame clínico na data do ASO (NR-7). */
const EXAME_CLINICO = '0295';
const ATIVOS = `('invalido', 'pendente', 'aprovado', 'enviado', 'processado')`;

type Problema = { linha?: number | null; mensagem: string };

interface Empregador {
  empresaId: string;
  razaoSocial: string;
  tipoInscricao: 1 | 2;
  inscricao: string;
  ide: IdeEmpregador;
  ambiente: 1 | 2;
  inicioObrigatoriedade: string | null;
  transmissor: { tpInsc: number; nrInsc: string };
  producaoLiberada: boolean;
  cadeiaCa: string | null;
}

interface Gerado {
  tipo: TipoEventoEsocial;
  referencia: string;
  resumo: string;
  problemas: Problema[];
  /** Monta o XML com o Id definitivo (só quando não há problemas de cadastro). */
  montar: ((id: string, ide: IdeEvento) => string) | null;
  vinculoId?: string | null;
  asoId?: string | null;
  lotacaoId?: string | null;
  catId?: string | null;
  /** S-3000: evento excluído. */
  origemId?: string | null;
}

const COLS_EVENTO = `e.id, e.empresa_id AS "empresaId", em.razao_social AS "empresaNome", e.tipo, e.id_evento AS "idEvento", e.ambiente,
  e.ind_retif AS "indRetif", e.evento_origem_id AS "eventoOrigemId", e.vinculo_id AS "vinculoId", e.aso_id AS "asoId",
  e.lotacao_id AS "lotacaoId", e.cat_id AS "catId", e.referencia, e.resumo, e.erros, e.situacao, e.aprovado_em AS "aprovadoEm",
  e.aprovado_por_nome AS "aprovadoPorNome", e.lote_id AS "loteId", e.nr_recibo AS "nrRecibo", e.cd_resposta AS "cdResposta",
  e.ocorrencias, e.processado_em AS "processadoEm", e.cancelado_em AS "canceladoEm", e.motivo_cancelamento AS "motivoCancelamento",
  e.criado_em AS "criadoEm", f.nome AS "funcionarioNome", f.cpf AS "funcionarioCpf", v.matricula,
  o.nr_recibo AS "origemRecibo", o.tipo AS "origemTipo", o.id_evento AS "origemIdEvento"`;
const FROM_EVENTO = `FROM esocial_evento e
  JOIN empresa em ON em.id = e.empresa_id
  LEFT JOIN vinculo v ON v.id = e.vinculo_id
  LEFT JOIN funcionario f ON f.id = v.funcionario_id
  LEFT JOIN esocial_evento o ON o.id = e.evento_origem_id`;

const COLS_LOTE = `l.id, l.empresa_id AS "empresaId", em.razao_social AS "empresaNome", l.ambiente, l.grupo, l.situacao, l.protocolo,
  l.cd_resposta AS "cdResposta", l.desc_resposta AS "descResposta", l.ocorrencias, l.enviado_em AS "enviadoEm",
  l.enviado_por_nome AS "enviadoPorNome", l.consultas, l.consultado_em AS "consultadoEm", l.processado_em AS "processadoEm",
  (SELECT count(*) FROM esocial_lote_evento le WHERE le.lote_id = l.id)::int AS eventos`;

@Injectable()
export class EsocialService {
  private readonly esquemas: Esquemas;

  constructor(@Inject(BANCO) private readonly banco: Banco, @Inject(CONFIG) private readonly cfg: Configuracao) {
    this.esquemas = new Esquemas(cfg.pastaEsocial);
  }

  private enderecos(ambiente: 1 | 2) {
    return (this.cfg.enderecosEsocialTeste ?? ENDERECOS_ESOCIAL)[ambiente];
  }

  // ====================================================================== configuração

  private async empregador(tx: Tx, empresaId: string): Promise<Empregador> {
    const e = await tx.one(
      `SELECT e.id, e.razao_social, e.tipo_inscricao, e.inscricao, e.natureza_juridica,
              c.ambiente, c.inicio_obrigatoriedade, c.transmissor_tipo, c.transmissor_inscricao, c.producao_liberada_em, c.cadeia_ca
         FROM empresa e LEFT JOIN esocial_config c ON c.empresa_id = e.id WHERE e.id = $1`, [empresaId]);
    if (!e) throw naoEncontrado('Empresa');
    const tipo = Number(e.tipo_inscricao) as 1 | 2;
    return {
      empresaId: e.id,
      razaoSocial: e.razao_social,
      tipoInscricao: tipo,
      inscricao: e.inscricao,
      ide: { tpInsc: tipo, nrInsc: inscricaoEmpregador(tipo, e.inscricao, e.natureza_juridica) },
      ambiente: (e.ambiente ?? 2) as 1 | 2,
      inicioObrigatoriedade: e.inicio_obrigatoriedade,
      transmissor: e.transmissor_inscricao
        ? { tpInsc: Number(e.transmissor_tipo), nrInsc: e.transmissor_inscricao }
        : { tpInsc: tipo, nrInsc: e.inscricao },
      producaoLiberada: !!e.producao_liberada_em,
      cadeiaCa: e.cadeia_ca,
    };
  }

  obterConfig(u: Usuario, empresaId: string) {
    u.exigir('esocial.ler', empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      const emp = await this.empregador(tx, empresaId);
      const c = await tx.one(
        `SELECT producao_liberada_em AS "producaoLiberadaEm", (cadeia_ca IS NOT NULL) AS "temCadeia",
                (SELECT count(*) FROM regexp_matches(coalesce(cadeia_ca, ''), 'BEGIN CERTIFICATE', 'g'))::int AS "certificadosCadeia"
           FROM esocial_config WHERE empresa_id = $1`, [empresaId]);
      const cert = await tx.one(
        `SELECT id, titular, documento, emissor, numero_serie AS "numeroSerie", impressao_digital AS "impressaoDigital",
                valido_de AS "validoDe", valido_ate AS "validoAte", criado_em AS "criadoEm"
           FROM esocial_certificado WHERE empresa_id = $1 AND ativo`, [empresaId]);
      const aceitos = await tx.one(
        `SELECT count(*)::int AS n FROM esocial_evento WHERE empresa_id = $1 AND ambiente = 2 AND nr_recibo IS NOT NULL`, [empresaId]);
      return {
        empresaId,
        ambiente: emp.ambiente,
        inicioObrigatoriedade: emp.inicioObrigatoriedade,
        transmissorTipo: emp.transmissor.tpInsc,
        transmissorInscricao: emp.transmissor.nrInsc,
        empregadorInscricao: emp.ide.nrInsc,
        producaoLiberadaEm: c?.producaoLiberadaEm ?? null,
        temCadeia: !!c?.temCadeia,
        certificadosCadeia: c?.certificadosCadeia ?? 0,
        aceitosProducaoRestrita: aceitos!.n,
        certificado: cert,
        enderecos: ENDERECOS_ESOCIAL[emp.ambiente],
      };
    });
  }

  salvarConfig(u: Usuario, empresaId: string, body: unknown) {
    u.exigir('esocial.configurar', empresaId);
    const d = validar(configEsocialSchema, body);
    if (d.transmissorTipo === 1 && d.transmissorInscricao.length !== 14) throw erro('Transmissor CNPJ deve ter 14 dígitos');
    if (d.transmissorTipo === 2 && d.transmissorInscricao.length !== 11) throw erro('Transmissor CPF deve ter 11 dígitos');
    return this.banco.tx(u.ctx(), async (tx) => {
      const atual = await tx.one('SELECT producao_liberada_em FROM esocial_config WHERE empresa_id = $1', [empresaId]);
      if (d.ambiente === 1 && !atual?.producao_liberada_em)
        throw erro('A produção ainda não foi liberada. Envie e tenha eventos aceitos na produção restrita e libere a produção antes.');
      await tx.query(
        `INSERT INTO esocial_config (empresa_id, tenant_id, ambiente, inicio_obrigatoriedade, transmissor_tipo, transmissor_inscricao, criado_por)
         VALUES ($1, app.tenant_atual(), $2, $3, $4, $5, app.usuario_atual())
         ON CONFLICT (empresa_id) DO UPDATE SET ambiente = $2, inicio_obrigatoriedade = $3, transmissor_tipo = $4,
                transmissor_inscricao = $5, atualizado_por = app.usuario_atual()`,
        [empresaId, d.ambiente, d.inicioObrigatoriedade, d.transmissorTipo, d.transmissorInscricao]);
      return { ok: true };
    }).then(() => this.obterConfig(u, empresaId));
  }

  /** Libera a produção: o banco confere se já há evento aceito (com recibo) na produção restrita. */
  liberarProducao(u: Usuario, empresaId: string) {
    u.exigir('esocial.configurar', empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      await tx.query(
        `INSERT INTO esocial_config (empresa_id, tenant_id, producao_liberada_em, producao_liberada_por, criado_por)
         VALUES ($1, app.tenant_atual(), now(), app.usuario_atual(), app.usuario_atual())
         ON CONFLICT (empresa_id) DO UPDATE SET producao_liberada_em = coalesce(esocial_config.producao_liberada_em, now()),
                producao_liberada_por = coalesce(esocial_config.producao_liberada_por, app.usuario_atual()),
                atualizado_por = app.usuario_atual()`, [empresaId]);
    }).then(() => this.obterConfig(u, empresaId));
  }

  /** Cadeia de certificados (PEM) das autoridades a confiar na conexão com o eSocial. */
  salvarCadeia(u: Usuario, empresaId: string, arquivo?: { buffer: Buffer }) {
    u.exigir('esocial.configurar', empresaId);
    let pem: string | null = null;
    if (arquivo?.buffer?.length) {
      const texto = arquivo.buffer.toString('utf8');
      const blocos = texto.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
      if (blocos?.length) pem = blocos.join('\n');
      else {
        // .cer/.crt em DER: converte para PEM.
        const b64 = arquivo.buffer.toString('base64').match(/.{1,64}/g)!.join('\n');
        pem = `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
        try {
          new (require('node:crypto').X509Certificate)(arquivo.buffer);
        } catch {
          throw new BadRequestException({ mensagem: 'Envie certificados de autoridade em .pem, .cer ou .crt' });
        }
      }
    }
    return this.banco.tx(u.ctx(), async (tx) => {
      const antiga = (await tx.one('SELECT cadeia_ca FROM esocial_config WHERE empresa_id = $1', [empresaId]))?.cadeia_ca as string | undefined;
      const nova = pem ? [antiga, pem].filter(Boolean).join('\n') : null;
      await tx.query(
        `INSERT INTO esocial_config (empresa_id, tenant_id, cadeia_ca, criado_por) VALUES ($1, app.tenant_atual(), $2, app.usuario_atual())
         ON CONFLICT (empresa_id) DO UPDATE SET cadeia_ca = $2, atualizado_por = app.usuario_atual()`, [empresaId, nova]);
    }).then(() => this.obterConfig(u, empresaId));
  }

  // ====================================================================== certificado A1

  enviarCertificado(u: Usuario, empresaId: string, senha: string | undefined, arquivo?: { buffer: Buffer; originalname: string }) {
    u.exigir('esocial.configurar', empresaId);
    if (!arquivo?.buffer?.length) throw new BadRequestException({ mensagem: 'Envie o arquivo do certificado (.pfx ou .p12)' });
    if (!senha) throw new BadRequestException({ mensagem: 'Informe a senha do certificado' });
    if (arquivo.buffer.length > 100 * 1024) throw new BadRequestException({ mensagem: 'Arquivo grande demais para um certificado A1' });
    let c: CertificadoAberto;
    try {
      c = abrirPfx(arquivo.buffer, senha);
    } catch (e: any) {
      throw new BadRequestException({ mensagem: e.message });
    }
    const agora = new Date();
    if (c.validoAte < agora) throw erro(`Certificado vencido em ${c.validoAte.toLocaleDateString('pt-BR')}`);
    if (c.validoDe > agora) throw erro('Certificado ainda não está válido');
    return this.banco.tx(u.ctx(), async (tx) => {
      await tx.query(
        `UPDATE esocial_certificado SET ativo = false, pfx_cifrado = NULL, senha_cifrada = NULL, desativado_em = now(),
                desativado_por = app.usuario_atual() WHERE empresa_id = $1 AND ativo`, [empresaId]);
      await tx.query(
        `INSERT INTO esocial_certificado (tenant_id, empresa_id, titular, documento, emissor, numero_serie, impressao_digital, valido_de, valido_ate,
                                          pfx_cifrado, senha_cifrada, criado_por)
         VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, app.usuario_atual())`,
        [empresaId, c.titular, c.documento, c.emissor, c.numeroSerie, c.impressaoDigital, c.validoDe, c.validoAte,
          cifrar(this.cfg.chaveDados, arquivo.buffer.toString('base64')), cifrar(this.cfg.chaveDados, senha)]);
    }).then(() => this.obterConfig(u, empresaId));
  }

  removerCertificado(u: Usuario, empresaId: string) {
    u.exigir('esocial.configurar', empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      await tx.query(
        `UPDATE esocial_certificado SET ativo = false, pfx_cifrado = NULL, senha_cifrada = NULL, desativado_em = now(),
                desativado_por = app.usuario_atual() WHERE empresa_id = $1 AND ativo`, [empresaId]);
    }).then(() => this.obterConfig(u, empresaId));
  }

  private async certificado(tx: Tx, empresaId: string) {
    const r = await tx.one('SELECT pfx_cifrado, senha_cifrada, valido_ate FROM esocial_certificado WHERE empresa_id = $1 AND ativo', [empresaId]);
    if (!r) throw erro('Nenhum certificado digital A1 cadastrado para a empresa (eSocial > Configuração e certificados)');
    if (new Date(r.valido_ate) < new Date()) throw erro('O certificado digital da empresa está vencido. Envie um novo certificado.');
    const pfx = Buffer.from(decifrar(this.cfg.chaveDados, r.pfx_cifrado), 'base64');
    const senha = decifrar(this.cfg.chaveDados, r.senha_cifrada);
    return { pfx, senha, aberto: abrirPfx(pfx, senha) };
  }

  // ====================================================================== geração dos eventos

  /**
   * Antes da aprovação o XML ainda não tem assinatura (ela só é feita quando uma pessoa aprova):
   * nessa etapa, a única falta aceita é a do elemento Signature.
   */
  private async validarXml(tipo: string, xml: string, assinado = true): Promise<ErroValidacao[]> {
    const erros = await this.esquemas.validarEvento(xml, XSD_EVENTO[tipo]!);
    return assinado ? erros : erros.filter((e) => !/xmldsig#\}Signature/.test(e.mensagem));
  }

  private async proximoId(tx: Tx, emp: Empregador) {
    const seq = Number((await tx.one(`SELECT nextval('esocial_id_seq') AS n`))!.n);
    return idEvento(emp.ide.tpInsc, emp.ide.nrInsc, new Date(), seq);
  }

  private async hoje(tx: Tx) {
    return (await tx.one('SELECT current_date::text AS d'))!.d as string;
  }

  /**
   * Grava o evento gerado. Se já existe um evento ainda não aprovado para a mesma origem, ele é
   * refeito no lugar (mesmo Id). Problemas de cadastro e erros do XSD deixam o evento "com erros",
   * e ele não pode ser aprovado.
   */
  private async gravar(tx: Tx, u: Usuario, emp: Empregador, gerado: Gerado, existente: { id: string; id_evento: string } | null,
    retifica?: { id: string; nrRecibo: string }) {
    const idEvt = existente?.id_evento ?? (await this.proximoId(tx, emp));
    const ide: IdeEvento = { indRetif: retifica ? 2 : 1, nrRecibo: retifica?.nrRecibo ?? null, tpAmb: emp.ambiente, verProc: VER_PROC };
    let xml = '';
    let erros: Problema[] = [...gerado.problemas];
    if (gerado.montar) {
      xml = gerado.montar(idEvt, ide);
      if (!erros.length) erros = (await this.validarXml(gerado.tipo, xml, false)).map((x) => ({ linha: x.linha, mensagem: `XSD: ${x.mensagem}` }));
    }
    const situacao = erros.length ? 'invalido' : 'pendente';
    if (existente) {
      await tx.query(
        `UPDATE esocial_evento SET xml = $2, erros = $3, situacao = $4, resumo = $5, referencia = $6, gerado_em = now(), atualizado_por = app.usuario_atual()
          WHERE id = $1`, [existente.id, xml, JSON.stringify(erros), situacao, gerado.resumo, gerado.referencia]);
      return existente.id;
    }
    const r = await tx.one(
      `INSERT INTO esocial_evento (tenant_id, empresa_id, tipo, id_evento, ambiente, ind_retif, evento_origem_id, vinculo_id, aso_id, lotacao_id,
                                   cat_id, referencia, resumo, xml, erros, situacao, criado_por)
       VALUES (app.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, app.usuario_atual()) RETURNING id`,
      [emp.empresaId, gerado.tipo, idEvt, emp.ambiente, ide.indRetif, retifica?.id ?? gerado.origemId ?? null, gerado.vinculoId ?? null, gerado.asoId ?? null,
        gerado.lotacaoId ?? null, gerado.catId ?? null, gerado.referencia, gerado.resumo, xml, JSON.stringify(erros), situacao]);
    return r!.id as string;
  }

  /** Evento em aberto para a mesma origem (refeito no lugar) ou já aprovado/enviado (bloqueia). */
  private async eventoDaOrigem(tx: Tx, tipo: string, cond: string, params: unknown[], retificacao: boolean) {
    const r = await tx.query(
      `SELECT id, id_evento, situacao, ind_retif FROM esocial_evento
        WHERE tipo = $1 AND ${cond} AND situacao IN ${ATIVOS} ${retificacao ? 'AND ind_retif = 2' : ''} FOR UPDATE`, [tipo, ...params]);
    const aberto = r.find((e) => ['invalido', 'pendente'].includes(e.situacao));
    const travado = r.find((e) => !['invalido', 'pendente'].includes(e.situacao) && (retificacao || e.ind_retif === 1));
    return { aberto: aberto ?? null, travado: travado ?? null };
  }

  private mensagemTravado(sit: string) {
    return sit === 'processado'
      ? 'Este evento já foi aceito pelo eSocial. Para corrigir, use "Retificar" no evento.'
      : 'Já existe um evento aprovado ou enviado para este registro. Desfaça a aprovação ou aguarde o retorno.';
  }

  // ---------------------------------------------------------------------- S-2220

  private async gerarS2220(tx: Tx, emp: Empregador, asoId: string): Promise<Gerado> {
    const a = await tx.one(
      `SELECT a.id, a.tipo, a.data_exame::text AS data, a.resultado, a.cancelado_em, a.vinculo_id, v.matricula, v.data_admissao::text AS admissao,
              f.cpf, f.nome AS funcionario, m.nome AS medico, m.crm, m.uf_crm
         FROM aso a JOIN vinculo v ON v.id = a.vinculo_id JOIN funcionario f ON f.id = v.funcionario_id JOIN medico m ON m.id = a.medico_id
        WHERE a.id = $1 AND a.empresa_id = $2`, [asoId, emp.empresaId]);
    if (!a) throw naoEncontrado('ASO');
    if (a.cancelado_em) throw erro('ASO cancelado não gera evento');
    const exames = await tx.query(
      `SELECT x.data_realizacao::text AS data, x.ordem, t.nome, t.codigo_esocial AS codigo,
              EXISTS (SELECT 1 FROM esocial_tabela tb WHERE tb.tabela = 27 AND tb.codigo = t.codigo_esocial AND tb.fim IS NULL) AS existe
         FROM aso_exame x JOIN exame_tipo t ON t.id = x.exame_tipo_id WHERE x.aso_id = $1 ORDER BY x.data_realizacao, t.nome`, [asoId]);
    const coord = await tx.one(
      `SELECT m.nome, m.cpf, m.crm, m.uf_crm FROM medico_coordenador c JOIN medico m ON m.id = c.medico_id
        WHERE c.empresa_id = $1 AND c.inicio <= $2 AND (c.fim IS NULL OR c.fim >= $2)`, [emp.empresaId, a.data]);
    const problemas: Problema[] = [];
    const hoje = await this.hoje(tx);
    if (a.data > hoje) problemas.push({ mensagem: 'A data do ASO não pode ser futura.' });
    if (emp.inicioObrigatoriedade && a.data < emp.inicioObrigatoriedade)
      problemas.push({ mensagem: `ASO anterior ao início da obrigatoriedade do S-2220 para a empresa (${emp.inicioObrigatoriedade}): não deve ser enviado.` });
    if (a.tipo !== 0 && a.data < a.admissao) problemas.push({ mensagem: 'ASO não admissional com data anterior à admissão.' });
    for (const x of exames) {
      if (!x.codigo) problemas.push({ mensagem: `O exame "${x.nome}" não tem o código do eSocial (Tabela 27). Informe no cadastro de tipos de exame.` });
      else if (!x.existe) problemas.push({ mensagem: `O código ${x.codigo} do exame "${x.nome}" não existe na Tabela 27.` });
      if (x.codigo === '0281' && !x.ordem) problemas.push({ mensagem: `Audiometria (${x.nome}): informe no ASO se é referencial ou sequencial.` });
      if (x.data > a.data) problemas.push({ mensagem: `O exame "${x.nome}" foi feito depois da data do ASO.` });
    }
    const lista = exames.filter((x) => x.codigo).map((x) => ({
      dtExm: x.data, procRealizado: x.codigo, obsProc: EXIGE_OBS_PROC.includes(x.codigo) ? x.nome : null, ordExame: x.ordem,
    }));
    if (!lista.some((x) => x.procRealizado === EXAME_CLINICO)) lista.unshift({ dtExm: a.data, procRealizado: EXAME_CLINICO, obsProc: null, ordExame: null });
    return {
      tipo: 'S-2220', referencia: a.data, asoId, vinculoId: a.vinculo_id,
      resumo: `ASO de ${a.funcionario} em ${a.data.split('-').reverse().join('/')}`,
      problemas,
      montar: (id, ide) => xmlS2220({
        id, ide, empregador: emp.ide, vinculo: { cpfTrab: a.cpf, matricula: a.matricula },
        tpExameOcup: a.tipo, dtAso: a.data, resAso: a.resultado, exames: lista,
        medico: { nome: a.medico, crm: a.crm, uf: a.uf_crm },
        respMonit: coord ? { cpf: coord.cpf, nome: coord.nome, crm: coord.crm, uf: coord.uf_crm } : null,
      }),
    };
  }

  // ---------------------------------------------------------------------- S-2240

  private async gerarS2240(tx: Tx, emp: Empregador, vinculoId: string, dtInformada: string | null, obs: string | null): Promise<Gerado> {
    const hoje = await this.hoje(tx);
    const v = await tx.one(
      `SELECT v.id, v.matricula, v.data_admissao::text AS admissao, v.data_desligamento::text AS desligamento, f.cpf, f.nome
         FROM vinculo v JOIN funcionario f ON f.id = v.funcionario_id WHERE v.id = $1 AND v.empresa_id = $2`, [vinculoId, emp.empresaId]);
    if (!v) throw naoEncontrado('Vínculo');
    const ref = dtInformada ?? hoje;
    const l = await tx.one(
      `SELECT l.id, l.inicio::text AS inicio, l.ghe_id, es.tipo_inscricao, es.inscricao, s.nome AS setor, g.codigo AS ghe_codigo, g.nome AS ghe_nome,
              g.descricao AS ghe_descricao, fu.descricao_atividades AS atividades, fu.nome AS funcao
         FROM lotacao l JOIN estabelecimento es ON es.id = l.estabelecimento_id
         LEFT JOIN setor s ON s.id = l.setor_id LEFT JOIN ghe g ON g.id = l.ghe_id LEFT JOIN funcao fu ON fu.id = l.funcao_id
        WHERE l.vinculo_id = $1 AND l.inicio <= $2 AND (l.fim IS NULL OR l.fim >= $2)`, [vinculoId, ref]);
    if (!l) throw erro('O trabalhador não tem lotação vigente nesta data');
    const dtIni = dtInformada
      ?? [l.inicio, v.admissao, emp.inicioObrigatoriedade].filter(Boolean).sort().pop()!;
    const problemas: Problema[] = [];
    if (dtIni < v.admissao) problemas.push({ mensagem: 'A data de início das condições é anterior à admissão.' });
    if (emp.inicioObrigatoriedade && dtIni < emp.inicioObrigatoriedade)
      problemas.push({ mensagem: `A data de início das condições é anterior ao início da obrigatoriedade (${emp.inicioObrigatoriedade}).` });
    const limite = new Date(`${hoje}T12:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + 30);
    if (dtIni > limite.toISOString().slice(0, 10)) problemas.push({ mensagem: 'A data de início das condições não pode passar de 30 dias a partir de hoje.' });
    if (v.desligamento && v.desligamento < dtIni) problemas.push({ mensagem: 'O vínculo já estava desligado nesta data.' });
    if (!l.ghe_id) problemas.push({ mensagem: 'A lotação do trabalhador não tem GHE. Informe o GHE na movimentação do funcionário.' });
    if (!l.setor) problemas.push({ mensagem: 'A lotação do trabalhador não tem setor (dscSetor é obrigatório).' });
    const atividades = l.atividades ?? l.ghe_descricao;
    if (!atividades) problemas.push({ mensagem: 'Descreva as atividades na função (descrição das atividades) ou no GHE.' });
    if (l.tipo_inscricao === 1 && l.inscricao.length !== 14) problemas.push({ mensagem: 'O estabelecimento precisa de CNPJ completo.' });
    const agentes = l.ghe_id ? await tx.query(
      `SELECT a.codigo, a.descricao, a.tp_aval AS "tpAval", a.int_conc::float8 AS "intConc", a.lim_tol::float8 AS "limTol", a.un_med AS "unMed",
              a.tec_medicao AS "tecMedicao", a.nr_proc_jud AS "nrProcJud", a.utiliz_epc AS "utilizEpc", a.efic_epc AS "eficEpc",
              a.utiliz_epi AS "utilizEpi", a.efic_epi AS "eficEpi", a.epis, a.epi_compl AS "epiCompl", a.inicio::text AS inicio, a.fim::text AS fim,
              EXISTS (SELECT 1 FROM esocial_tabela t WHERE t.tabela = 24 AND t.codigo = a.codigo AND t.fim IS NULL) AS existe
         FROM agente_nocivo a WHERE a.ghe_id = $1 AND a.inicio <= $2 AND (a.fim IS NULL OR a.fim >= $2) ORDER BY a.codigo`,
      [l.ghe_id, dtIni]) : [];
    if (l.ghe_id) {
      const conj = problemasConjuntoAgentes(agentes.map((a) => a.codigo));
      if (conj) problemas.push({ mensagem: `GHE ${l.ghe_codigo}: ${conj}` });
    }
    for (const a of agentes) {
      if (!a.existe) problemas.push({ mensagem: `Agente ${a.codigo} não existe na Tabela 24.` });
      for (const p of problemasAgente(a, dtIni)) problemas.push({ mensagem: `Agente ${a.codigo}: ${p.mensagem}` });
    }
    const resp = await tx.query(
      `SELECT cpf, ide_oc, dsc_oc, nr_oc, uf_oc FROM responsavel_ambiental
        WHERE empresa_id = $1 AND inicio <= $2 AND (fim IS NULL OR fim >= $2) ORDER BY nome LIMIT 99`, [emp.empresaId, dtIni]);
    if (!resp.length) problemas.push({ mensagem: 'Cadastre o responsável pelos registros ambientais vigente na data (eSocial > Configuração).' });
    return {
      tipo: 'S-2240', referencia: dtIni, vinculoId, lotacaoId: l.id,
      resumo: `Condições ambientais de ${v.nome} desde ${dtIni.split('-').reverse().join('/')}${l.ghe_codigo ? ` (GHE ${l.ghe_codigo})` : ''}`,
      problemas,
      montar: (id, ide) => xmlS2240({
        id, ide, empregador: emp.ide, vinculo: { cpfTrab: v.cpf, matricula: v.matricula }, dtIniCondicao: dtIni,
        ambientes: [{ localAmb: 1, dscSetor: l.setor ?? '', tpInsc: l.tipo_inscricao, nrInsc: l.inscricao }],
        dscAtivDes: atividades ?? '', agentes,
        responsaveis: resp.map((r) => ({ cpf: r.cpf, ideOc: r.ide_oc, dscOc: r.dsc_oc, nrOc: r.nr_oc, ufOc: r.uf_oc })),
        obsCompl: obs,
      }),
    };
  }

  // ---------------------------------------------------------------------- S-2210

  private async gerarS2210(tx: Tx, emp: Empregador, catId: string): Promise<Gerado> {
    const c = await tx.one(
      `SELECT c.id, c.tp_cat, c.dados, c.atestado, c.vinculo_id, v.matricula, v.data_admissao::text AS admissao, f.cpf, f.nome,
              o.tipo, o.codigo, o.houve_afastamento, to_char(o.data_hora, 'YYYY-MM-DD') AS data, to_char(o.data_hora, 'HH24MI') AS hora
         FROM cat c JOIN ocorrencia o ON o.id = c.ocorrencia_id JOIN vinculo v ON v.id = c.vinculo_id JOIN funcionario f ON f.id = v.funcionario_id
        WHERE c.id = $1 AND c.empresa_id = $2`, [catId, emp.empresaId]);
    if (!c) throw naoEncontrado('CAT');
    const tpAcid = TIPO_ACIDENTE_OCORRENCIA[c.tipo];
    if (!tpAcid) throw erro('A ocorrência não é acidente nem doença ocupacional');
    const hoje = await this.hoje(tx);
    const dados = { ...c.dados, tpCat: c.tp_cat, houveAfast: c.data >= '2023-01-16' ? (c.houve_afastamento ? 'S' : 'N') : null };
    const problemas: Problema[] = problemasCat({ ...dados, vinculoId: c.vinculo_id }, c.atestado, { dtAcid: c.data, tpAcid, hoje, dataAdmissao: c.admissao })
      .map((m) => ({ mensagem: m }));
    if (emp.inicioObrigatoriedade && c.data < emp.inicioObrigatoriedade)
      problemas.push({ mensagem: `Acidente anterior ao início da obrigatoriedade (${emp.inicioObrigatoriedade}): a CAT não vai pelo eSocial.` });
    if (c.data >= '2024-01-22' && tpAcid !== 2) {
      const t14 = await tx.one('SELECT 1 FROM esocial_tabela WHERE tabela = 14 AND codigo = $1', [c.dados.codAgntCausador]);
      if (!t14) problemas.push({ mensagem: 'Para acidente típico ou de trajeto a partir de 22/01/2024, o agente causador deve ser da Tabela 14.' });
    }
    return {
      tipo: 'S-2210', referencia: c.data, vinculoId: c.vinculo_id, catId,
      resumo: `CAT ${c.tp_cat === 1 ? 'inicial' : c.tp_cat === 2 ? 'de reabertura' : 'de óbito'} de ${c.nome} (${c.codigo})`,
      problemas,
      montar: c.atestado ? (id, ide) => xmlS2210({
        id, ide, empregador: emp.ide, vinculo: { cpfTrab: c.cpf, matricula: c.matricula }, dtAcid: c.data, tpAcid,
        hrAcid: tpAcid === 1 || (tpAcid === 3 && c.data >= '2022-01-26') ? c.hora : null,
        cat: dados, atestado: c.atestado,
      }) : null,
    };
  }

  // ---------------------------------------------------------------------- preparo (API)

  private async preparar(u: Usuario, empresaId: string, fn: (tx: Tx, emp: Empregador) => Promise<string>) {
    u.exigir('esocial.preparar', empresaId);
    const id = await this.banco.tx(u.ctx(), async (tx) => fn(tx, await this.empregador(tx, empresaId)));
    return this.obter(u, id);
  }

  private async empresaDe(u: Usuario, sql: string, id: string, o: string) {
    const r = await this.banco.tx(u.ctx(), (tx) => tx.one(sql, [id]));
    if (!r) throw naoEncontrado(o);
    return r.empresa_id as string;
  }

  async prepararS2220(u: Usuario, asoId: string) {
    const empresaId = await this.empresaDe(u, 'SELECT empresa_id FROM aso WHERE id = $1', asoId, 'ASO');
    return this.preparar(u, empresaId, async (tx, emp) => {
      const { aberto, travado } = await this.eventoDaOrigem(tx, 'S-2220', 'aso_id = $2', [asoId], false);
      if (travado) throw erro(this.mensagemTravado(travado.situacao));
      return this.gravar(tx, u, emp, await this.gerarS2220(tx, emp, asoId), aberto);
    });
  }

  async prepararS2240(u: Usuario, body: unknown) {
    const d = validar(preparoS2240Schema, body);
    const empresaId = await this.empresaDe(u, 'SELECT empresa_id FROM vinculo WHERE id = $1', d.vinculoId, 'Vínculo');
    return this.preparar(u, empresaId, async (tx, emp) => {
      const gerado = await this.gerarS2240(tx, emp, d.vinculoId, d.dtIniCondicao, d.observacao);
      const { aberto, travado } = await this.eventoDaOrigem(tx, 'S-2240', 'vinculo_id = $2 AND referencia = $3', [d.vinculoId, gerado.referencia], false);
      if (travado) throw erro(this.mensagemTravado(travado.situacao));
      return this.gravar(tx, u, emp, gerado, aberto);
    });
  }

  async prepararS2210(u: Usuario, catId: string) {
    const empresaId = await this.empresaDe(u, 'SELECT empresa_id FROM cat WHERE id = $1', catId, 'CAT');
    return this.preparar(u, empresaId, async (tx, emp) => {
      const { aberto, travado } = await this.eventoDaOrigem(tx, 'S-2210', 'cat_id = $2', [catId], false);
      if (travado) throw erro(this.mensagemTravado(travado.situacao));
      return this.gravar(tx, u, emp, await this.gerarS2210(tx, emp, catId), aberto);
    });
  }

  /** Gera de novo um evento com erros ou aguardando aprovação, com os dados atuais dos cadastros. */
  async refazer(u: Usuario, id: string) {
    const ev = await this.banco.tx(u.ctx(), (tx) => tx.one(
      `SELECT e.*, o.nr_recibo AS origem_recibo FROM esocial_evento e LEFT JOIN esocial_evento o ON o.id = e.evento_origem_id WHERE e.id = $1`, [id]));
    if (!ev) throw naoEncontrado('Evento');
    if (!['invalido', 'pendente'].includes(ev.situacao)) throw erro('Só é possível refazer evento com erros ou aguardando aprovação');
    if (ev.tipo === 'S-3000') throw erro('Exclusão não precisa ser refeita');
    return this.preparar(u, ev.empresa_id, async (tx, emp) => {
      if (emp.ambiente !== ev.ambiente) throw erro('O ambiente do eSocial mudou desde que o evento foi gerado. Descarte-o e gere de novo.');
      const g = ev.tipo === 'S-2220' ? await this.gerarS2220(tx, emp, ev.aso_id)
        : ev.tipo === 'S-2240' ? await this.gerarS2240(tx, emp, ev.vinculo_id, ev.referencia, null)
          : await this.gerarS2210(tx, emp, ev.cat_id);
      if (ev.tipo === 'S-2240' && ev.xml) {
        const obs = /<obsCompl>([^<]*)<\/obsCompl>/.exec(ev.xml)?.[1];
        if (obs) {
          const original = g.montar!;
          g.montar = (i, ide) => original(i, ide).replace('</infoExpRisco>', `<obs><obsCompl>${obs}</obsCompl></obs></infoExpRisco>`);
        }
      }
      return this.gravar(tx, u, emp, g, { id: ev.id, id_evento: ev.id_evento },
        ev.ind_retif === 2 ? { id: ev.evento_origem_id, nrRecibo: ev.origem_recibo } : undefined);
    });
  }

  /** Retificação de evento processado: gera o mesmo evento com indRetif = 2 e o recibo do original. */
  async retificar(u: Usuario, id: string) {
    const ev = await this.banco.tx(u.ctx(), (tx) => tx.one('SELECT * FROM esocial_evento WHERE id = $1', [id]));
    if (!ev) throw naoEncontrado('Evento');
    u.exigir('esocial.transmitir', ev.empresa_id);
    if (ev.situacao !== 'processado' || !ev.nr_recibo) throw erro('Só é possível retificar evento processado (com recibo)');
    if (ev.tipo === 'S-3000') throw erro('Exclusão não é retificada');
    return this.preparar(u, ev.empresa_id, async (tx, emp) => {
      if (emp.ambiente !== ev.ambiente) throw erro('O evento original é de outro ambiente do eSocial');
      const { aberto, travado } = await this.eventoDaOrigem(tx, ev.tipo, 'evento_origem_id = $2', [id], true);
      if (travado) throw erro('Já existe uma retificação aprovada ou enviada para este evento');
      const g = ev.tipo === 'S-2220' ? await this.gerarS2220(tx, emp, ev.aso_id)
        : ev.tipo === 'S-2240' ? await this.gerarS2240(tx, emp, ev.vinculo_id, ev.referencia, null)
          : await this.gerarS2210(tx, emp, ev.cat_id);
      g.resumo = `Retificação: ${g.resumo}`;
      return this.gravar(tx, u, emp, g, aberto, { id: ev.id, nrRecibo: ev.nr_recibo });
    });
  }

  /** Exclusão (S-3000) de evento processado. */
  async excluir(u: Usuario, id: string) {
    const ev = await this.banco.tx(u.ctx(), (tx) => tx.one(
      `SELECT e.*, f.cpf FROM esocial_evento e LEFT JOIN vinculo v ON v.id = e.vinculo_id LEFT JOIN funcionario f ON f.id = v.funcionario_id
        WHERE e.id = $1`, [id]));
    if (!ev) throw naoEncontrado('Evento');
    u.exigir('esocial.transmitir', ev.empresa_id);
    if (ev.situacao !== 'processado' || !ev.nr_recibo) throw erro('Só é possível excluir evento processado (com recibo)');
    if (ev.tipo === 'S-3000') throw erro('Uma exclusão não pode ser excluída');
    return this.preparar(u, ev.empresa_id, async (tx, emp) => {
      if (emp.ambiente !== ev.ambiente) throw erro('O evento original é de outro ambiente do eSocial');
      const ja = await tx.one(`SELECT id FROM esocial_evento WHERE tipo = 'S-3000' AND evento_origem_id = $1 AND situacao IN ${ATIVOS}`, [id]);
      if (ja) throw erro('Já existe uma exclusão para este evento');
      const hoje = await this.hoje(tx);
      const g: Gerado = {
        tipo: 'S-3000', referencia: hoje, vinculoId: ev.vinculo_id, origemId: id, resumo: `Exclusão do ${ev.tipo}: ${ev.resumo}`, problemas: [],
        montar: (i, ide) => xmlS3000({ id: i, tpAmb: ide.tpAmb, verProc: VER_PROC, empregador: emp.ide, tpEvento: ev.tipo, nrRecEvt: ev.nr_recibo, cpfTrab: ev.cpf }),
      };
      return this.gravar(tx, u, emp, g, null);
    });
  }

  // ====================================================================== aprovação humana

  /**
   * Aprovação: uma pessoa com permissão confere o evento, e só então ele é assinado com o
   * certificado da empresa. Nada é aprovado automaticamente.
   */
  async aprovar(u: Usuario, ids: string[]) {
    if (!ids.length || ids.length > MAX_EVENTOS_LOTE * 4) throw erro('Selecione os eventos a aprovar');
    return this.banco.tx(u.ctx(), async (tx) => {
      const eventos = await tx.query('SELECT id, empresa_id, tipo, situacao, xml, erros, ambiente, id_evento FROM esocial_evento WHERE id = ANY($1::uuid[]) FOR UPDATE', [ids]);
      if (eventos.length !== ids.length) throw naoEncontrado('Evento');
      const empresas = [...new Set(eventos.map((e) => e.empresa_id as string))];
      const certs = new Map<string, CertificadoAberto>();
      for (const emp of empresas) {
        u.exigir('esocial.transmitir', emp);
        const empregador = await this.empregador(tx, emp);
        if (eventos.some((e) => e.empresa_id === emp && e.ambiente !== empregador.ambiente))
          throw erro('Há evento gerado para outro ambiente do eSocial. Descarte-o e gere de novo.');
        certs.set(emp, (await this.certificado(tx, emp)).aberto);
      }
      for (const e of eventos) {
        if (e.situacao !== 'pendente' || (e.erros as unknown[]).length) throw erro(`O evento ${e.tipo} ${e.id_evento} não está pronto para aprovação`);
        if (e.tipo === 'S-2210' && !u.pode('saude.clinico', e.empresa_id))
          throw new ForbiddenException({ mensagem: 'A CAT contém dados clínicos (CID): a aprovação exige acesso a dados clínicos' });
        const assinado = assinar(e.xml, certs.get(e.empresa_id)!);
        const erros = await this.validarXml(e.tipo, assinado);
        if (erros.length) throw erro(`A assinatura do evento ${e.id_evento} não passou no XSD: ${erros[0]!.mensagem}`);
        await tx.query(
          `UPDATE esocial_evento SET situacao = 'aprovado', xml_assinado = $2, aprovado_em = now(), aprovado_por = app.usuario_atual(),
                  aprovado_por_nome = $3, atualizado_por = app.usuario_atual() WHERE id = $1`, [e.id, assinado, u.nome]);
      }
      return { aprovados: eventos.length };
    });
  }

  async desaprovar(u: Usuario, id: string) {
    await this.banco.tx(u.ctx(), async (tx) => {
      const e = await tx.one('SELECT empresa_id, situacao FROM esocial_evento WHERE id = $1 FOR UPDATE', [id]);
      if (!e) throw naoEncontrado('Evento');
      u.exigir('esocial.transmitir', e.empresa_id);
      if (e.situacao !== 'aprovado') throw erro('Só evento aprovado e ainda não enviado pode voltar para aprovação');
      await tx.query(
        `UPDATE esocial_evento SET situacao = 'pendente', xml_assinado = NULL, aprovado_em = NULL, aprovado_por = NULL, aprovado_por_nome = NULL,
                atualizado_por = app.usuario_atual() WHERE id = $1`, [id]);
    });
    return this.obter(u, id);
  }

  async descartar(u: Usuario, id: string, motivo: string | undefined) {
    const m = motivo?.trim();
    if (!m) throw new BadRequestException({ mensagem: 'Informe o motivo' });
    await this.banco.tx(u.ctx(), async (tx) => {
      const e = await tx.one('SELECT empresa_id, situacao FROM esocial_evento WHERE id = $1 FOR UPDATE', [id]);
      if (!e) throw naoEncontrado('Evento');
      u.exigir(e.situacao === 'aprovado' ? 'esocial.transmitir' : 'esocial.preparar', e.empresa_id);
      if (!['invalido', 'pendente', 'aprovado', 'rejeitado'].includes(e.situacao)) throw erro('Este evento não pode ser descartado');
      await tx.query(
        `UPDATE esocial_evento SET situacao = 'cancelado', cancelado_em = now(), cancelado_por = app.usuario_atual(), motivo_cancelamento = $2,
                atualizado_por = app.usuario_atual() WHERE id = $1`, [id, m.slice(0, 500)]);
    });
    return this.obter(u, id);
  }

  // ====================================================================== transmissão

  /**
   * Envia os eventos aprovados da empresa (até 50 por lote) ao ambiente configurado.
   * O lote é gravado antes da chamada ("envio em andamento"); o resultado vem só da resposta
   * do eSocial. Sem resposta, o lote fica como falha de comunicação e os eventos voltam a
   * "aprovado" para novo envio.
   */
  async enviar(u: Usuario, empresaId: string, ids?: string[]) {
    u.exigir('esocial.transmitir', empresaId);
    const p = await this.banco.tx(u.ctx(), async (tx) => {
      const emp = await this.empregador(tx, empresaId);
      if (emp.ambiente === 1 && !emp.producaoLiberada) throw erro('A produção do eSocial ainda não está liberada para esta empresa');
      const params: unknown[] = [empresaId, emp.ambiente];
      let filtro = '';
      if (ids?.length) { params.push(ids); filtro = 'AND id = ANY($3::uuid[])'; }
      const eventos = await tx.query(
        `SELECT id, id_evento, xml_assinado FROM esocial_evento
          WHERE empresa_id = $1 AND ambiente = $2 AND situacao = 'aprovado' ${filtro}
          ORDER BY CASE tipo WHEN 'S-3000' THEN 2 ELSE 1 END, criado_em LIMIT ${MAX_EVENTOS_LOTE} FOR UPDATE`, params);
      if (!eventos.length) throw erro('Nenhum evento aprovado para enviar');
      const cert = await this.certificado(tx, empresaId);
      const lote = xmlLote(emp.ide, emp.transmissor, eventos.map((e) => ({ id: e.id_evento, xml: e.xml_assinado })));
      const errosLote = await this.esquemas.validarLote(lote);
      if (errosLote.length) throw erro(`O lote não passou no XSD de envio: ${errosLote[0]!.mensagem}`);
      const l = await tx.one(
        `INSERT INTO esocial_lote (tenant_id, empresa_id, ambiente, situacao, xml_envio, enviado_por, enviado_por_nome)
         VALUES (app.tenant_atual(), $1, $2, 'enviando', $3, app.usuario_atual(), $4) RETURNING id`, [empresaId, emp.ambiente, lote, u.nome]);
      const evIds = eventos.map((e) => e.id);
      await tx.query(
        `INSERT INTO esocial_lote_evento (lote_id, evento_id, tenant_id, empresa_id)
         SELECT $1, x, app.tenant_atual(), $2 FROM unnest($3::uuid[]) x`, [l!.id, empresaId, evIds]);
      await tx.query(`UPDATE esocial_evento SET situacao = 'enviado', lote_id = $1, atualizado_por = app.usuario_atual() WHERE id = ANY($2::uuid[])`,
        [l!.id, evIds]);
      return { loteId: l!.id as string, ambiente: emp.ambiente, cadeia: emp.cadeiaCa, cert, lote, evIds };
    });

    let resposta: string | null = null;
    let falha: string | null = null;
    try {
      resposta = await chamarWebservice(this.enderecos(p.ambiente).envio, 'envio', p.lote,
        { pfx: p.cert.pfx, senha: p.cert.senha, ca: p.cadeia ? [p.cadeia] : [] });
    } catch (e: any) {
      falha = e instanceof FalhaComunicacao ? e.message : `Falha inesperada no envio: ${e?.message ?? e}`;
    }

    await this.banco.tx(u.ctx(), async (tx) => {
      const voltar = async (situacaoLote: string, cd: number | null, desc: string, ocorr: unknown[], retorno: string | null) => {
        await tx.query(
          `UPDATE esocial_lote SET situacao = $2, cd_resposta = $3, desc_resposta = $4, ocorrencias = $5, retorno_envio = $6 WHERE id = $1`,
          [p.loteId, situacaoLote, cd, desc, JSON.stringify(ocorr), retorno]);
      };
      if (falha || !resposta) {
        await tx.query(`UPDATE esocial_evento SET situacao = 'aprovado', lote_id = NULL WHERE id = ANY($1::uuid[])`, [p.evIds]);
        await voltar('falha_comunicacao', null, falha ?? 'Sem resposta', [], null);
        return;
      }
      let r;
      try {
        r = lerRetornoEnvio(resposta);
      } catch (e: any) {
        await tx.query(`UPDATE esocial_evento SET situacao = 'aprovado', lote_id = NULL WHERE id = ANY($1::uuid[])`, [p.evIds]);
        await voltar('falha_comunicacao', null, e.message, [], resposta);
        return;
      }
      if ((r.cdResposta === 201 || r.cdResposta === 202 || r.cdResposta === 203) && r.protocolo) {
        await tx.query(
          `UPDATE esocial_lote SET situacao = 'aguardando', protocolo = $2, cd_resposta = $3, desc_resposta = $4, ocorrencias = $5, retorno_envio = $6
            WHERE id = $1`, [p.loteId, r.protocolo, r.cdResposta, r.descResposta, JSON.stringify(r.ocorrencias), resposta]);
      } else if (r.cdResposta === 301) {
        // Erro do servidor do eSocial: nada foi recebido; os eventos podem ser reenviados.
        await tx.query(`UPDATE esocial_evento SET situacao = 'aprovado', lote_id = NULL WHERE id = ANY($1::uuid[])`, [p.evIds]);
        await voltar('falha_comunicacao', r.cdResposta, r.descResposta, r.ocorrencias, resposta);
      } else {
        await tx.query(`UPDATE esocial_evento SET situacao = 'rejeitado', ocorrencias = $2, cd_resposta = $3 WHERE id = ANY($1::uuid[])`,
          [p.evIds, JSON.stringify(r.ocorrencias), r.cdResposta]);
        await voltar('recusado', r.cdResposta, r.descResposta, r.ocorrencias, resposta);
      }
    });
    return this.obterLote(u, p.loteId);
  }

  /** Consulta o resultado do processamento do lote. Evento só fica processado com recibo devolvido. */
  async consultar(u: Usuario, loteId: string) {
    const l = await this.banco.tx(u.ctx(), (tx) => tx.one('SELECT empresa_id, ambiente, situacao, protocolo FROM esocial_lote WHERE id = $1', [loteId]));
    if (!l) throw naoEncontrado('Lote');
    u.exigir('esocial.transmitir', l.empresa_id);
    if (l.situacao !== 'aguardando') throw erro('Só lote aguardando retorno pode ser consultado');
    const cred = await this.banco.tx(u.ctx(), async (tx) => ({
      cert: await this.certificado(tx, l.empresa_id),
      cadeia: (await tx.one('SELECT cadeia_ca FROM esocial_config WHERE empresa_id = $1', [l.empresa_id]))?.cadeia_ca as string | null,
    }));
    let resposta: string;
    try {
      resposta = await chamarWebservice(this.enderecos(l.ambiente).consulta, 'consulta', xmlConsulta(l.protocolo),
        { pfx: cred.cert.pfx, senha: cred.cert.senha, ca: cred.cadeia ? [cred.cadeia] : [] });
    } catch (e: any) {
      await this.banco.tx(u.ctx(), (tx) => tx.query(
        `UPDATE esocial_lote SET consultas = consultas + 1, consultado_em = now(), desc_resposta = $2 WHERE id = $1`,
        [loteId, `Consulta sem resposta: ${e?.message ?? e}`]));
      throw erro(e instanceof FalhaComunicacao ? e.message : `Falha na consulta: ${e?.message ?? e}`);
    }
    const r = lerRetornoConsulta(resposta);
    await this.banco.tx(u.ctx(), async (tx) => {
      const base = [loteId, r.cdResposta, r.descResposta, JSON.stringify(r.ocorrencias), resposta];
      if (r.cdResposta === 101 || r.cdResposta === 301) {
        await tx.query(
          `UPDATE esocial_lote SET consultas = consultas + 1, consultado_em = now(), cd_resposta = $2, desc_resposta = $3, ocorrencias = $4,
                  retorno_consulta = $5 WHERE id = $1`, base);
        return;
      }
      const eventos = await tx.query(`SELECT id, id_evento, tipo, evento_origem_id FROM esocial_evento WHERE lote_id = $1 AND situacao = 'enviado' FOR UPDATE`, [loteId]);
      if (r.cdResposta === 201 || r.cdResposta === 202) {
        for (const e of eventos) {
          const ret = r.eventos.find((x) => x.id === e.id_evento);
          if (!ret) continue;
          if (ret.nrRecibo) {
            await tx.query(
              `UPDATE esocial_evento SET situacao = 'processado', nr_recibo = $2, recibo_xml = $3, cd_resposta = $4, ocorrencias = $5,
                      processado_em = now() WHERE id = $1`, [e.id, ret.nrRecibo, ret.xml, ret.cdResposta, JSON.stringify(ret.ocorrencias)]);
            if (e.tipo === 'S-3000' && e.evento_origem_id)
              await tx.query(`UPDATE esocial_evento SET situacao = 'excluido' WHERE id = $1 AND situacao = 'processado'`, [e.evento_origem_id]);
          } else {
            await tx.query(`UPDATE esocial_evento SET situacao = 'rejeitado', recibo_xml = $2, cd_resposta = $3, ocorrencias = $4 WHERE id = $1`,
              [e.id, ret.xml, ret.cdResposta, JSON.stringify(ret.ocorrencias)]);
          }
        }
        await tx.query(
          `UPDATE esocial_lote SET situacao = 'processado', processado_em = now(), consultas = consultas + 1, consultado_em = now(),
                  cd_resposta = $2, desc_resposta = $3, ocorrencias = $4, retorno_consulta = $5 WHERE id = $1`, base);
      } else {
        await tx.query(`UPDATE esocial_evento SET situacao = 'rejeitado', cd_resposta = $2, ocorrencias = $3 WHERE id = ANY($1::uuid[])`,
          [eventos.map((e) => e.id), r.cdResposta, JSON.stringify(r.ocorrencias)]);
        await tx.query(
          `UPDATE esocial_lote SET situacao = 'rejeitado', consultas = consultas + 1, consultado_em = now(), cd_resposta = $2, desc_resposta = $3,
                  ocorrencias = $4, retorno_consulta = $5 WHERE id = $1`, base);
      }
    });
    return this.obterLote(u, loteId);
  }

  // ====================================================================== consultas

  listar(u: Usuario, f: { empresaId?: string; situacao?: string; tipo?: string; busca?: string }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (f.empresaId) { params.push(f.empresaId); cond.push(`e.empresa_id = $${params.length}`); }
    if (f.situacao) { params.push(f.situacao.split(',')); cond.push(`e.situacao = ANY($${params.length}::text[])`); }
    if (f.tipo) { params.push(f.tipo); cond.push(`e.tipo = $${params.length}`); }
    if (f.busca) {
      params.push(`%${f.busca.toLowerCase()}%`);
      cond.push(`(lower(f.nome) LIKE $${params.length} OR f.cpf LIKE $${params.length} OR e.id_evento LIKE $${params.length} OR e.nr_recibo LIKE $${params.length})`);
    }
    const perm = u.empresasCom('esocial.ler');
    if (perm !== '*') { params.push(perm); cond.push(`e.empresa_id = ANY($${params.length}::uuid[])`); }
    return this.banco.tx(u.ctx(), async (tx) => {
      const itens = await tx.query(
        `SELECT ${COLS_EVENTO} ${FROM_EVENTO} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY e.criado_em DESC LIMIT 500`, params);
      return itens.map((e) => ({ ...e, prazo: prazoEvento(e.tipo, e.referencia) }));
    });
  }

  obter(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const e = await tx.one(`SELECT ${COLS_EVENTO}, e.xml, e.xml_assinado IS NOT NULL AS assinado ${FROM_EVENTO} WHERE e.id = $1`, [id]);
      if (!e) throw naoEncontrado('Evento');
      u.exigir('esocial.ler', e.empresaId);
      // A CAT tem CID e diagnóstico: o XML só aparece para quem tem acesso clínico.
      if (e.tipo === 'S-2210' && !u.pode('saude.clinico', e.empresaId)) e.xml = null;
      const derivados = await tx.query(
        `SELECT id, tipo, situacao, id_evento AS "idEvento", nr_recibo AS "nrRecibo", criado_em AS "criadoEm"
           FROM esocial_evento WHERE evento_origem_id = $1 ORDER BY criado_em`, [id]);
      const lotes = await tx.query(
        `SELECT l.id, l.situacao, l.protocolo, l.enviado_em AS "enviadoEm" FROM esocial_lote_evento le JOIN esocial_lote l ON l.id = le.lote_id
          WHERE le.evento_id = $1 ORDER BY l.enviado_em`, [id]);
      return { ...e, prazo: prazoEvento(e.tipo, e.referencia), derivados, lotes };
    });
  }

  /** XML do evento (assinado, se já aprovado) e do recibo, para guardar. */
  async xml(u: Usuario, id: string, qual: 'evento' | 'recibo') {
    return this.banco.tx(u.ctx(), async (tx) => {
      const e = await tx.one('SELECT empresa_id, tipo, id_evento, xml, xml_assinado, recibo_xml FROM esocial_evento WHERE id = $1', [id]);
      if (!e) throw naoEncontrado('Evento');
      u.exigir('esocial.ler', e.empresa_id);
      if (e.tipo === 'S-2210' && !u.pode('saude.clinico', e.empresa_id))
        throw new ForbiddenException({ mensagem: 'O XML da CAT contém dados clínicos' });
      const conteudo = qual === 'recibo' ? e.recibo_xml : (e.xml_assinado ?? e.xml);
      if (!conteudo) throw naoEncontrado(qual === 'recibo' ? 'Recibo' : 'XML');
      return { nome: `${e.tipo} ${e.id_evento}${qual === 'recibo' ? ' recibo' : ''}.xml`, conteudo: Buffer.from(conteudo, 'utf8') };
    });
  }

  listarLotes(u: Usuario, f: { empresaId?: string }) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (f.empresaId) { params.push(f.empresaId); cond.push(`l.empresa_id = $${params.length}`); }
    const perm = u.empresasCom('esocial.ler');
    if (perm !== '*') { params.push(perm); cond.push(`l.empresa_id = ANY($${params.length}::uuid[])`); }
    return this.banco.tx(u.ctx(), (tx) => tx.query(
      `SELECT ${COLS_LOTE} FROM esocial_lote l JOIN empresa em ON em.id = l.empresa_id
        ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY l.enviado_em DESC LIMIT 300`, params));
  }

  obterLote(u: Usuario, id: string) {
    return this.banco.tx(u.ctx(), async (tx) => {
      const l = await tx.one(`SELECT ${COLS_LOTE} FROM esocial_lote l JOIN empresa em ON em.id = l.empresa_id WHERE l.id = $1`, [id]);
      if (!l) throw naoEncontrado('Lote');
      u.exigir('esocial.ler', l.empresaId);
      const eventos = await tx.query(
        `SELECT ${COLS_EVENTO} ${FROM_EVENTO} JOIN esocial_lote_evento le ON le.evento_id = e.id AND le.lote_id = $1 ORDER BY e.criado_em`, [id]);
      return { ...l, eventosLista: eventos };
    });
  }

  // ====================================================================== pendências e painel

  /** O que ainda precisa virar evento: ASOs sem S-2220, trabalhadores sem S-2240 atual, CATs sem S-2210. */
  pendencias(u: Usuario, empresaId: string) {
    u.exigir('esocial.ler', empresaId);
    return this.banco.tx(u.ctx(), async (tx) => {
      const emp = await this.empregador(tx, empresaId);
      const desde = emp.inicioObrigatoriedade ?? '1900-01-01';
      const asos = await tx.query(
        `SELECT a.id, a.tipo, a.data_exame AS data, f.nome AS "funcionarioNome", v.matricula
           FROM aso a JOIN vinculo v ON v.id = a.vinculo_id JOIN funcionario f ON f.id = v.funcionario_id
          WHERE a.empresa_id = $1 AND a.cancelado_em IS NULL AND a.data_exame >= $2
            AND NOT EXISTS (SELECT 1 FROM esocial_evento e WHERE e.aso_id = a.id AND e.tipo = 'S-2220' AND e.situacao IN ${ATIVOS})
          ORDER BY a.data_exame LIMIT 500`, [empresaId, desde]);
      const trabalhadores = await tx.query(
        `SELECT v.id AS "vinculoId", f.nome AS "funcionarioNome", v.matricula, l.id AS "lotacaoId", l.inicio, g.codigo AS "gheCodigo",
                l.ghe_id IS NOT NULL AS "temGhe",
                ult.gerado_em AS "ultimoEvento", ult.referencia AS "ultimaReferencia",
                (SELECT max(greatest(an.criado_em, an.atualizado_em)) FROM agente_nocivo an WHERE an.ghe_id = l.ghe_id) AS "agentesAlterados"
           FROM vinculo v JOIN funcionario f ON f.id = v.funcionario_id
           JOIN lotacao l ON l.vinculo_id = v.id AND l.fim IS NULL
           LEFT JOIN ghe g ON g.id = l.ghe_id
           LEFT JOIN LATERAL (SELECT e.gerado_em, e.referencia, e.lotacao_id FROM esocial_evento e
                               WHERE e.vinculo_id = v.id AND e.tipo = 'S-2240' AND e.situacao IN ${ATIVOS}
                               ORDER BY e.referencia DESC, e.gerado_em DESC LIMIT 1) ult ON true
          WHERE v.empresa_id = $1 AND v.data_desligamento IS NULL
            AND (ult.gerado_em IS NULL OR ult.lotacao_id IS DISTINCT FROM l.id
                 OR ult.gerado_em < (SELECT max(greatest(an.criado_em, an.atualizado_em)) FROM agente_nocivo an WHERE an.ghe_id = l.ghe_id))
          ORDER BY f.nome LIMIT 500`, [empresaId]);
      const cats = await tx.query(
        `SELECT o.id AS "ocorrenciaId", o.codigo, o.tipo, to_char(o.data_hora, 'YYYY-MM-DD') AS data, f.nome AS "funcionarioNome",
                c.id AS "catId", c.tp_cat AS "tpCat", c.atestado IS NOT NULL AS "temAtestado", o.gravidade = 'fatal' AS obito
           FROM ocorrencia o LEFT JOIN funcionario f ON f.id = o.funcionario_id
           LEFT JOIN cat c ON c.ocorrencia_id = o.id
          WHERE o.empresa_id = $1 AND o.tipo IN ('acidente_tipico', 'acidente_trajeto', 'doenca_ocupacional') AND o.data_hora::date >= $2
            AND (c.id IS NULL OR NOT EXISTS (SELECT 1 FROM esocial_evento e WHERE e.cat_id = c.id AND e.situacao IN ${ATIVOS}))
          ORDER BY o.data_hora LIMIT 500`, [empresaId, desde]);
      return {
        s2220: asos.map((a) => ({ ...a, prazo: prazoEvento('S-2220', a.data) })),
        s2240: trabalhadores.map((t) => ({
          ...t,
          motivo: !t.ultimoEvento ? 'Sem S-2240 enviado' : t.agentesAlterados && t.ultimoEvento < t.agentesAlterados
            ? 'Agentes do GHE alterados depois do último S-2240' : 'Lotação mudou depois do último S-2240',
          prazo: prazoEvento('S-2240', t.inicio),
        })),
        s2210: cats.map((c) => ({ ...c, prazo: prazoEvento('S-2210', c.data, c.obito) })),
      };
    });
  }

  /** Números do painel: eventos por situação, prazos vencidos e lotes aguardando retorno. */
  painel(u: Usuario, empresaId?: string) {
    const params: unknown[] = [];
    const cond: string[] = [];
    if (empresaId) { params.push(empresaId); cond.push(`empresa_id = $${params.length}`); }
    const perm = u.empresasCom('esocial.ler');
    if (perm !== '*') { params.push(perm); cond.push(`empresa_id = ANY($${params.length}::uuid[])`); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    return this.banco.tx(u.ctx(), async (tx) => {
      const sit = await tx.query(`SELECT situacao, count(*)::int AS n FROM esocial_evento ${where} GROUP BY situacao`, params);
      const lotes = await tx.one(`SELECT count(*)::int AS n FROM esocial_lote ${where ? `${where} AND` : 'WHERE'} situacao IN ('aguardando', 'enviando')`, params);
      const abertos = await tx.query(
        `SELECT tipo, referencia::text AS referencia FROM esocial_evento ${where ? `${where} AND` : 'WHERE'} situacao IN ('invalido', 'pendente', 'aprovado', 'rejeitado')`, params);
      const hoje = (await tx.one('SELECT current_date::text AS d'))!.d;
      const porSituacao = Object.fromEntries(sit.map((s) => [s.situacao, s.n]));
      return {
        porSituacao,
        lotesAguardando: lotes!.n,
        prazoVencido: abertos.filter((e) => (prazoEvento(e.tipo, e.referencia) ?? '9999') < hoje).length,
      };
    });
  }
}
