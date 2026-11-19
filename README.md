# Controle SST

Plataforma de gestão integrada de Saúde e Segurança do Trabalho para consultorias e departamentos de SST.
Roda **no próprio notebook (Windows), sem internet**: banco de dados, arquivos e regras ficam no computador.
O sistema fica em segundo plano (ícone perto do relógio) e é usado **pelo navegador**, em `http://localhost:8088`.
A internet só será usada, no futuro, para transmitir ao eSocial e baixar atualizações.

> Situação: **Fase 5** (eSocial S-2210, S-2220 e S-2240) sobre as Fases 1 (fundação, empresas e funcionários), 2 (ASO e treinamentos), 3 (programas legais e documentos) e 4 (planos de ação e conformidade). As próximas fases estão no plano técnico.

## O que a Fase 1 entrega

| Área | Funcionalidades |
| --- | --- |
| Acesso | Configuração inicial do computador, login com senha forte (Argon2id), bloqueio após 5 tentativas, verificação em duas etapas (aplicativo autenticador), troca obrigatória de senha temporária |
| Usuários | Oito perfis padrão (Administrador geral, Administrador da empresa, Engenheiro, Técnico, Médico, RH, Operador eSocial, Visualizador), atribuídos por empresa |
| Auditoria | Toda inclusão, alteração e exclusão é registrada automaticamente pelo banco, com antes e depois. O registro não pode ser alterado nem apagado |
| Empresas | Cadastro completo (CNPJ/CPF validado, CNAEs, grau de risco, natureza jurídica, classificação tributária, endereço, responsável legal), estabelecimentos (CNPJ, CAEPF, CNO) com uma matriz |
| Estrutura | Setores e GHE por estabelecimento; funções e cargos com CBO |
| Funcionários | Admissão, readmissão, transferência e mudança de função **sem sobrescrever o histórico**, afastamentos, desligamento, movimentação em lote (tudo ou nada), histórico de alterações por funcionário |
| Importação | Planilha Excel com modelo, prévia com erros por linha, gravação só após confirmação e em bloco único |
| Busca e filtros | Seletor de empresa no topo, busca global por nome/CPF/matrícula, filtros por situação, estabelecimento, setor, função e GHE |
| Backup | Backup completo criptografado (AES-256-GCM, senha própria): automático diário ou semanal, ao fechar o sistema e sob demanda; pasta de destino escolhida (pendrive, HD externo), com aviso quando ela não está conectada; restauração pela lista ou por arquivo, verificada antes de substituir os dados |

## O que a Fase 5 entrega

| Área | Funcionalidades |
| --- | --- |
| Eventos | S-2220 (do ASO), S-2240 (agentes nocivos do GHE da lotação atual), S-2210 (da CAT da ocorrência) e S-3000 (exclusão), no leiaute S-1.3, validados nos esquemas XSD oficiais embutidos no sistema e nas regras do leiaute. Retificação de evento processado. Pendências mostram o que ainda não virou evento, com o prazo legal |
| Aprovação humana | Gerar um evento não envia nada. Só quem tem a permissão de transmitir aprova; a aprovação assina o XML (XML-DSig, RSA-SHA256) com o certificado da empresa. O conteúdo aprovado não muda mais (garantido pelo banco); para corrigir, volta para aprovação ou gera retificação |
| Transmissão | Lotes de até 50 eventos pelo webservice SOAP do eSocial com TLS mútuo (certificado A1). Protocolo, consulta do retorno e recibo por evento. O evento só fica "processado" com o recibo devolvido pelo governo. Falha de comunicação devolve os eventos para "aprovado" |
| Ambientes | Toda empresa começa na produção restrita (testes do governo). A produção só pode ser liberada depois de um evento aceito lá, e a liberação fica registrada (garantido pelo banco) |
| Certificado digital | A1 (.pfx/.p12) guardado cifrado (AES-256-GCM, chave protegida pelo Windows) e nunca devolvido. Titular, validade e impressão digital à vista. Cadeia de autoridades opcional para a conexão |
| Agentes nocivos | Por GHE, com código da Tabela 24, avaliação quantitativa ou qualitativa, EPC, EPI com CA e requisitos das NR-06 e NR-09, e vigência. Responsáveis pelos registros ambientais com conselho e período |
| CAT | Dados do acidente na ocorrência (situação geradora, parte atingida, agente causador e local, com busca nas Tabelas 13, 14 e 15). O atestado (CID, natureza da lesão na Tabela 17, emitente) só é visto e preenchido por quem tem acesso clínico, e o XML do S-2210 também |
| Painel | Eventos aguardando aprovação, com erro, rejeitados, aprovados a enviar, processados, lotes sem retorno e prazos vencidos |

## O que a Fase 4 entrega

| Área | Funcionalidades |
| --- | --- |
| Planos de ação | Código sequencial (AC-AAAA-NNNN), origem (PGR, PGRTR, PCMSO, AEP, AET, PCA, PPR, CIPA, inspeção, auditoria, acidente, investigação, recomendação técnica, matriz de conformidade), perigo, medida (introduzir, aprimorar, manter), prioridade, responsável, validador, recursos e forma de acompanhamento, por empresa, estabelecimento, setor ou GHE |
| Fluxo da ação | Não iniciada, em andamento, aguardando evidência, em validação, concluída ou cancelada. Só vai para validação com evidência anexada (ou dispensa com justificativa técnica), regra garantida pelo banco. Concluir, devolver e cancelar exigem a permissão de validação; ação concluída ou cancelada não muda mais |
| Prazos | Prazo inicial preservado; reprogramação só com justificativa, registrada no histórico. Ações atrasadas e com prazo próximo destacadas |
| Evidências e histórico | Foto, documento, certificado, lista de presença ou comprovante (PDF/JPG/PNG até 50 MB). Evidências e histórico só recebem inclusões: o banco não deixa alterar nem apagar |
| Inspeções | Inspeções de rotina, CIPA, auditoria ou específicas, com itens conforme, não conforme ou não aplicável; ação gerada direto do item não conforme |
| Ocorrências | Acidente típico, de trajeto, doença ocupacional, incidente e quase acidente, com gravidade, envolvido e medidas imediatas. Encerrar exige investigação concluída. A CAT é preenchida na própria ocorrência e gera o S-2210 (Fase 5) |
| Matriz de conformidade | Requisitos legais (gerados dos tipos de documento ou cadastrados), aplicabilidade decidida pelo profissional em cada empresa ou estabelecimento, com justificativa obrigatória para "não aplicável". Critérios opcionais (grau de risco, CNAE, número de empregados) só geram uma sugestão. Requisito ligado a documento segue a situação do documento; os demais seguem a avaliação registrada. Percentual de atendimento conta só os aplicáveis avaliados |
| Visão por empresa | Todas as empresas classificadas em regulares, com pendências, com prazos próximos e com vencidos ou atrasos |
| Painel | Ações abertas, atrasadas, com prazo próximo e aguardando validação; requisitos não conformes e a avaliar |

## O que a Fase 3 entrega

| Área | Funcionalidades |
| --- | --- |
| Tipos de documento | Biblioteca sugerida (PGR, PGRTR, PCMSO, LTCAT, AEP, AET, PCA, PPR, CIPA, laudos de insalubridade e periculosidade, avaliação ambiental, plano de emergência, proteção contra incêndio) e tipos próprios. Só traz prazo quando a norma o fixa de forma expressa |
| Documentos | Por empresa ou estabelecimento, com base legal, critério de revisão e regras próprias (copiadas do tipo e ajustáveis) |
| Prazos separados | Revisão legal, vencimento expresso, acompanhamento periódico, mudança de condições e reavaliação interna, cada um com data e estado próprios |
| Situações | Regular, próximo da revisão, próximo do vencimento, vencido, pendente, em elaboração, em revisão, substituído e não aplicável, com o motivo explicado |
| Versões | Responsável técnico e registro profissional, datas de elaboração, emissão e vigência, arquivo (PDF/JPG/PNG até 50 MB). A versão anterior vira "substituída" e não pode mais ser alterada (garantido pelo banco) |
| Aplicabilidade | Avaliada pelo profissional, com fundamentação obrigatória para "não aplicável", nome e data registrados |
| Painel | Indicadores de documentos regulares, pendentes, próximos da revisão, vencidos, em elaboração e substituídos |

## O que a Fase 2 entrega

| Área | Funcionalidades |
| --- | --- |
| Cadastros de saúde | Médicos (CRM/UF), clínicas, tipos de exame com código da Tabela 27 do eSocial, médico coordenador do PCMSO por empresa com vigência |
| ASO | Tipos do eSocial (admissional, periódico, retorno, mudança de risco, monitoração pontual, demissional), apto/inapto, riscos do PGR, exames complementares, vencimento, correção, cancelamento com motivo (nunca apaga), anexo do ASO assinado (PDF/JPG/PNG conferido pelo conteúdo), PDF do ASO com os itens da NR-7 |
| Dado clínico | Resultado de exame complementar fica em tabela própria, visível só para o perfil Médico da empresa, garantido pelo banco (RLS), inclusive no registro de auditoria |
| Treinamentos | Biblioteca com norma, carga horária e periodicidade; turmas com instrutor, responsável técnico, presença, aprovação e nota; validade calculada e gravada na conclusão; certificado em PDF com código de verificação (itens da NR-1) |
| Matriz | Treinamentos exigidos por função ou GHE; situação de cada funcionário (em dia, vencendo, vencido, pendente) |
| Vencimentos | Lista única de pendências de ASO e treinamentos, com prazos de alerta configuráveis (padrão 90/60/30/15 dias), indicadores no painel e abas de ASO e treinamentos na ficha do funcionário |

## Segurança

- **Isolamento entre empresas no próprio banco** (Row Level Security do PostgreSQL). A aplicação conecta com um usuário sem privilégios que não consegue desligar essas regras. Um teste automático confirma que um usuário de uma empresa não lê nem grava dados de outra.
- Senhas do banco e a chave de dados são geradas na instalação e protegidas pelo Windows (DPAPI): só o usuário do Windows que instalou consegue lê-las.
- O banco e a interface só aceitam conexões do próprio computador (127.0.0.1). Nenhuma porta é aberta para a rede.
- A interface só responde aos endereços `localhost:8088` e `127.0.0.1:8088`, o que impede sites de fora de alcançá-la pelo navegador.
- Recomenda-se manter o **BitLocker** ativo no notebook.

## Estrutura do código

```
apps/api       API (NestJS) e migrations SQL do banco
apps/web       Interface (React + Tailwind)
apps/desktop   Aplicativo Windows em segundo plano (Electron na bandeja + PostgreSQL 16 embutido + backup)
packages/shared  Validações (CPF, CNPJ), perfis e permissões compartilhados
```

O banco é versionado por arquivos SQL em `apps/api/migrations`, aplicados em ordem na abertura do aplicativo.

## Instalador

A cada envio ao GitHub, o fluxo **CI** compila, roda os testes e gera o instalador do Windows.
Baixe em *Actions › CI › execução mais recente › Artifacts › controle-sst-instalador-windows*.
O instalador sugere a pasta `E:\Controle SST` quando o computador tem unidade E: (pode ser trocada na instalação).
Instalado fora da unidade do Windows, os dados ficam em `<unidade>:\Controle SST - Dados`, fora da pasta do programa, para não serem
apagados ao atualizar ou desinstalar. Ao instalar numa unidade diferente da anterior, os dados são copiados para a nova pasta na primeira
abertura; a pasta antiga é mantida, renomeada com o sufixo `-copiado-<data>`.

O instalador ainda não tem assinatura digital de código; o Windows pode mostrar um aviso do SmartScreen ("Mais informações › Executar assim mesmo").

## Desenvolvimento

Requisitos: Node 22, pnpm 10, PostgreSQL 16 local (para os testes da API).

```bash
pnpm install
# papéis usados pelos testes da API
psql -U postgres -c "CREATE ROLE sst_owner LOGIN PASSWORD 'dev_owner' CREATEDB"
psql -U postgres -c "CREATE ROLE sst_app LOGIN PASSWORD 'dev_app'"
pnpm build
pnpm test          # testes da API usam bancos descartáveis sst_it_*
pnpm desktop       # abre o aplicativo
```

Os testes criam bancos temporários com documentos gerados apenas para teste; nenhum dado de exemplo vai para o banco do aplicativo.
