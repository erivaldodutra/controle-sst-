# Controle SST

Plataforma de gestão integrada de Saúde e Segurança do Trabalho para consultorias e departamentos de SST.
Roda **no próprio notebook (Windows), sem internet**: banco de dados, arquivos e regras ficam no computador.
A internet só será usada, no futuro, para transmitir ao eSocial e baixar atualizações.

> Situação: **Fase 1** (fundação, autenticação, empresas e funcionários). As próximas fases estão no plano técnico.

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
| Backup | Backup completo criptografado (AES-256-GCM, senha própria) feito ao fechar o sistema e sob demanda, cópia para pendrive, restauração verificada antes de substituir os dados |

## Segurança

- **Isolamento entre empresas no próprio banco** (Row Level Security do PostgreSQL). A aplicação conecta com um usuário sem privilégios que não consegue desligar essas regras. Um teste automático confirma que um usuário de uma empresa não lê nem grava dados de outra.
- Senhas do banco e a chave de dados são geradas na instalação e protegidas pelo Windows (DPAPI): só o usuário do Windows que instalou consegue lê-las.
- O banco só aceita conexões do próprio computador (127.0.0.1). Nenhuma porta é aberta para a rede.
- Recomenda-se manter o **BitLocker** ativo no notebook.

## Estrutura do código

```
apps/api       API (NestJS) e migrations SQL do banco
apps/web       Interface (React + Tailwind)
apps/desktop   Aplicativo Windows (Electron + PostgreSQL 16 embutido + backup)
packages/shared  Validações (CPF, CNPJ), perfis e permissões compartilhados
```

O banco é versionado por arquivos SQL em `apps/api/migrations`, aplicados em ordem na abertura do aplicativo.

## Instalador

A cada envio ao GitHub, o fluxo **CI** compila, roda os testes e gera o instalador do Windows.
Baixe em *Actions › CI › execução mais recente › Artifacts › controle-sst-instalador-windows*.
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
