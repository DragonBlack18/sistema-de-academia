# Vitality Gym

Repositório: [DragonBlack18/sistema-de-academia](https://github.com/DragonBlack18/sistema-de-academia).

**Versão 1.1.0 — revisão de backend, com frontend congelado.** As evidências da versão estão em [docs/VALIDACAO-EXECUTADA.md](docs/VALIDACAO-EXECUTADA.md), e os requisitos operacionais em [docs/PRODUCAO.md](docs/PRODUCAO.md).

Sistema web de gestão de academia, com interface em português, autenticação própria, permissões por função e armazenamento persistente. Os módulos compartilham alunos, matrículas, financeiro e frequência; a personalização visual também é salva no servidor.

O projeto foi reconstruído como uma aplicação única e modular. A base atual usa **React + TypeScript, Vinext/Vite, Cloudflare Workers, D1/SQLite e R2**. Essa escolha permite executar o backend e o banco localmente e usar a mesma aplicação no ambiente hospedado. O PostgreSQL/FastAPI da proposta inicial não faz parte desta nova implementação. Não há importação automática dos dados do projeto anterior.

## Começar no Windows

Instale:

- [Node.js](https://nodejs.org/en/download) 22.13 ou superior; o fluxo de CI usa Node 24.
- [Git](https://git-scm.com/downloads/win), se for usar o repositório.
- Um navegador atual. Docker não é necessário para a execução local.

Clone `https://github.com/DragonBlack18/sistema-de-academia.git` ou extraia o ZIP da entrega. Abra o PowerShell **na pasta que contém este README e `package.json`** e execute:

```powershell
npm ci
npm run setup:local
npm start
```

Acesse **http://127.0.0.1:8787**. O primeiro setup compila a aplicação, aplica as migrações locais e prepara as variáveis de desenvolvimento. O primeiro acesso à API inicializa o administrador; dados demonstrativos dependem da variável `ENABLE_DEMO_DATA`.

### Acesso inicial sem senha publicada

Em uma **instalação nova**, o setup gera uma senha aleatória no arquivo local `.dev.vars`, que fica fora do Git. Abra esse arquivo localmente e consulte `ADMIN_LOGIN` e `ADMIN_PASSWORD`. As credenciais não são exibidas nos logs. Entre e altere a senha pela área **Segurança**.

O login predefinido da interface foi preservado como solicitado, sem acrescentar `.com`; ele é um identificador, não um endereço de envio. A conta e a senha de um ambiente que já existe **não são redefinidas** por setup, atualização ou mudança de variável. Não publique `.dev.vars`, dumps, cookies ou backups no repositório público.

Para escolher outra porta:

```powershell
npm start -- --port 8790
```

Para desenvolvimento com atualização automática da interface, depois do setup:

```powershell
npm run dev
```

Use a URL informada no terminal. Encerre a instância anterior antes de iniciar outra que use o mesmo banco.

## Variáveis de ambiente

`npm run setup:local` cria `.dev.vars` a partir do exemplo, se o arquivo ainda não existir. O arquivo fica fora do Git.

| Variável | Função |
| --- | --- |
| `APP_ENV` | `development`, `test` ou `production`. Produção exige configuração segura e seed desativado. |
| `ADMIN_LOGIN` | Identificador da conta inicial. |
| `ADMIN_PASSWORD` | Senha usada somente para criar a conta inicial. Mudar esta variável não redefine a senha de uma conta já existente. |
| `ENABLE_DEMO_DATA` | `true` inclui dados sintéticos; `false` começa sem os cadastros de demonstração. Mudar para `false` não apaga registros já criados. |
| `TOTP_ENCRYPTION_KEY` | Chave de 32 bytes, em 64 caracteres hexadecimais, para cifrar segredos de MFA. O setup a gera uma vez e preserva a existente. |

As credenciais e a chave não devem ser adicionadas ao frontend, a URLs ou ao repositório. O helper local cria uma configuração ignorada em `.sites-runtime/local/`, mantendo os segredos fora de `dist/` e dos arquivos de publicação. No ambiente hospedado, configure essas variáveis como segredos do servidor.

## Módulos e fluxo de trabalho

| Área | Recursos |
| --- | --- |
| Visão geral | Indicadores, gráficos por período e visão operacional baseada nos registros do banco. |
| Alunos | Cadastro, edição, pesquisa, histórico, vínculo de profissional e desativação. |
| Equipe | Cadastro dos colaboradores e vínculo opcional com uma conta de acesso. |
| Planos | Preços, duração, modalidades e disponibilidade; valores monetários em centavos. |
| Matrículas | Contratação, cobrança inicial, renovação, suspensão e cancelamento com histórico. |
| Financeiro | Cobranças, pagamento manual, estorno, despesas e contas em aberto. |
| Frequência | Check-in/check-out, validação de matrícula e atraso, histórico de entradas e recusas. |
| Exercícios | Catálogo próprio com grupo muscular, equipamentos e instruções. |
| Treinos | Prescrição por aluno, dias, séries, repetições, cargas, descanso, ativação e histórico. |
| Avaliações | Registro das medidas e evolução; sem diagnóstico ou prescrição automática. |
| Aulas | Agenda, profissional, capacidade e reservas com controle de vagas. |
| Estoque | Produtos, ajustes justificados e impedimento de saldo negativo. |
| Compras | Fornecedores, itens e recebimento que atualiza o estoque. |
| Vendas | Venda de produtos, baixa de estoque e estorno com recomposição. |
| CRM | Interessados, estágio de atendimento e conversão para aluno. |
| Notificações | Avisos gerais ou por destinatário e estado de leitura persistente. |
| Relatórios | Agregados operacionais/financeiros e exportações CSV. |
| Usuários | Contas, hierarquia, ativação/desativação e revogação de sessões. |
| Auditoria | Registro de alterações e ações críticas com autor e data. |
| Personalização | Nome, fonte, cor principal, fundo, logo, papel de parede, posição da navegação e ícones. |

### Fluxo recomendado para a primeira conferência

1. Entre como proprietário e confira **Personalização**.
2. Cadastre um profissional e uma conta com perfil **Personal**.
3. Cadastre um aluno e vincule esse profissional.
4. Crie um plano e uma matrícula. Confira a cobrança gerada.
5. Registre o pagamento manual e faça o check-in do aluno.
6. Crie uma ficha de treino para ele.
7. Encerre e abra novamente a aplicação. Confira os mesmos registros.
8. Entre com a conta de personal e verifique que ela só acessa os alunos vinculados e as funções permitidas.

## Hierarquia e segurança

O proprietário (`super_admin`) administra toda a academia, inclusive as contas com privilégios elevados. Os demais perfis são administrador, gerente, recepção, financeiro, professor e personal. A matriz está em [docs/PERMISSOES.md](docs/PERMISSOES.md). A autorização é aplicada no servidor a cada requisição. A navegação acompanha essas permissões para facilitar o uso.

Professores e personais trabalham com os alunos sob sua responsabilidade. Desativar uma conta ou mudar suas permissões invalida sessões existentes. O sistema protege a conta proprietária contra a remoção do último acesso de controle.

As sessões usam cookie HttpOnly, SameSite e Secure em HTTPS. Expiram após 30 minutos de inatividade ou, no máximo, 12 horas. O servidor revalida também a sessão, o perfil e a versão da conta dentro das transações de alteração. As alterações autenticadas exigem token CSRF e origem válida. As senhas usam scrypt com sal aleatório; o banco não guarda a senha original. A autenticação em duas etapas usa TOTP e pode ser ativada na área de segurança. Cada código TOTP só pode ser consumido uma vez. Guarde a chave do ambiente para manter os segredos MFA legíveis após restaurações. Os detalhes estão em [docs/SEGURANCA-BACKEND.md](docs/SEGURANCA-BACKEND.md).

Os uploads de logo e papel de parede aceitam apenas imagens PNG, JPEG ou WebP de até 5 MB, com validação do conteúdo. A personalização aceita propriedades e ícones conhecidos; não recebe CSS, HTML ou JavaScript arbitrários.

## Regras que evitam inconsistências

- O preço contratado fica preservado quando o preço do plano é alterado.
- Alterações usam a versão do registro. Se outra pessoa salvar antes, a API retorna conflito em vez de sobrescrever silenciosamente.
- Pagamentos e estornos mantêm histórico; repetir uma operação identificada não deve duplicar seu efeito.
- Recebimento, venda e estorno de venda atualizam o estoque dentro da operação financeira correspondente.
- A capacidade de uma aula é protegida no banco, inclusive em tentativas simultâneas.
- Um aluno não deve manter duas entradas abertas. Entradas negadas são registradas.
- A carência de atraso é configurável. A política inicial considera três dias.
- Os formulários só apresentam sucesso depois da confirmação do servidor.

Os cenários concretos estão em [tests/integration.mjs](tests/integration.mjs), [tests/backend-flows.mjs](tests/backend-flows.mjs) e nas suítes de segurança, domínio e operação. As correções de integridade estão em [docs/INTEGRIDADE-BACKEND.md](docs/INTEGRIDADE-BACKEND.md). Isso não constitui uma promessa de ausência de defeitos; consulte as evidências de execução da versão entregue.

## Testes

### Suíte completa em uma base isolada

```powershell
npm run test:ci
```

Esse comando verifica TypeScript e ESLint, executa testes determinísticos de segurança/domínio/operação, compila a aplicação, cria um banco de teste separado, aplica as migrações, executa os fluxos HTTP reais, reinicia o mesmo ambiente e verifica os dados novamente. O banco operacional em `.wrangler/state` é preservado. As evidências são gravadas em `outputs/`. A matriz e os limites dos testes estão em [docs/TESTES.md](docs/TESTES.md).

A suíte inclui:

- autenticação, cookies, CSRF e rejeição de origem indevida;
- hierarquia, proibição de escalação e restrição por aluno;
- criação/edição, paginação e conflito de versão;
- matrícula, cobrança, pagamentos concorrentes, idempotência e estorno;
- check-in, bloqueios e check-out;
- prescrição e histórico de treino;
- capacidade de aula e reserva concorrente;
- compras, recebimento, venda, estorno e estoque negativo;
- CRM, notificações por destinatário e leitura persistida;
- personalização, upload inválido e imagem armazenada;
- relatórios, CSV e auditoria;
- MFA, troca de senha e revogação de sessão;
- persistência de SQL, arquivos e tema após reinicialização.

Para executar somente a suíte HTTP contra **um ambiente de homologação já iniciado**:

```powershell
$env:VG_TEST_BASE_URL = 'http://127.0.0.1:8787'
$env:VG_TEST_ALLOW_WRITES = '1'
# Defina VG_TEST_LOGIN e VG_TEST_PASSWORD com credenciais do ambiente de teste.
npm run test:integration
npm run test:backend
```

Essa forma escreve registros com prefixo `QA` no ambiente indicado. Não a use no banco operacional. A conferência visual no navegador complementa os testes da API; a suíte HTTP não comprova comportamento de teclado, layout ou foco dos diálogos.

## GitHub e CI

O workflow [.github/workflows/ci.yml](.github/workflows/ci.yml) executa em pushes para `main`/`master`, pull requests e acionamento manual. Ele instala o lockfile, executa `test-ci.mjs` e guarda os relatórios como artefatos. O workflow não publica automaticamente um ambiente com dados da academia.

O histórico original e as branches preexistentes são preservados. A consolidação desta aplicação está registrada no [pull request #1](https://github.com/DragonBlack18/sistema-de-academia/pull/1), com validação do commit enviado antes da integração à `main`.

As Actions são fixadas por SHA completo. O workflow usa `contents: read`, não persiste credenciais do checkout, gera senhas sintéticas aleatórias e não recebe segredos do ambiente operacional. A auditoria de dependências de produção falha a partir de vulnerabilidades moderadas. O Dependabot propõe atualizações sem mesclá-las automaticamente.

Consulte a aba [Actions](https://github.com/DragonBlack18/sistema-de-academia/actions) para o resultado remoto. Um workflow preparado não é, por si só, uma execução aprovada. O resultado efetivamente observado fica documentado na entrega.

```powershell
git clone https://github.com/DragonBlack18/sistema-de-academia.git
cd sistema-de-academia
npm ci
npm run setup:local
npm start
```

Mantenha `.gitignore`: `.dev.vars`, `.wrangler`, `.sites-runtime`, uploads locais e backups nunca entram no repositório.

## Organização do projeto

```text
app/                  Páginas, layout e entrada da API
components/           Shell, dashboard, módulos e componentes compartilhados
lib/                  Cliente da API, metadados e utilitários
server/               Autenticação, segurança, domínios e inicialização
db/                  Esquema relacional tipado
drizzle/             Migrações SQL versionadas
public/               Mídias de demonstração e assets da aplicação
scripts/              Setup, execução local e validação
tests/               Fluxos de integração HTTP
docs/                Contratos, referências e operação
.github/workflows/    Automação de validação
```

A indentação acima não representa projetos aninhados: há um único `package.json` na raiz e uma aplicação principal. A descrição completa dos endpoints está em [docs/API-CONTRACT.md](docs/API-CONTRACT.md); os campos estão em [docs/DOMAIN-FIELDS.md](docs/DOMAIN-FIELDS.md).

## Atualização, backup e restauração

Leia [docs/OPERACAO.md](docs/OPERACAO.md). Compilar ou atualizar o código preserva o banco e os arquivos quando as pastas de dados são mantidas. O procedimento de backup inclui o estado D1/R2 e o arquivo de variáveis. Não há comando de reset automático no fluxo de atualização.

## Escopo e limites desta versão

Esta entrega é a **versão web de uma academia e uma unidade**. O Portal do Aluno e o empacotamento Electron não entram neste ciclo.

Pagamentos são registrados manualmente. A aplicação não cria cobranças reais em um gateway, não envia e-mails/WhatsApp e não aciona catracas físicas. Essas integrações precisam de contas, chaves e equipamentos homologados. Não há recuperação automática por e-mail enquanto não existir um serviço de envio configurado. A aplicação também não emite documentos fiscais.

A execução é online: alterações precisam chegar ao servidor. Multiunidade, operação offline, tarefas agendadas de backup externo, importação do banco antigo e homologação de carga/segurança para produção são etapas próprias. O backend inclui verificação de prontidão em `/api/system/readiness`, restrita ao proprietário, e backup local verificável; consulte [docs/PRODUCAO.md](docs/PRODUCAO.md) antes de usar dados reais. Os dados de demonstração são sintéticos e não comprovam testes de escala.

## Referências e decisões

As fontes oficiais e os repositórios usados como referência estão em [docs/REFERENCIAS.md](docs/REFERENCIAS.md). A identidade e os padrões de interação estão em `DESIGN.md` e `UX-CONTRACT.md`.

As mídias, fontes locais e suas licenças estão documentadas em [docs/MIDIAS-LICENCAS.md](docs/MIDIAS-LICENCAS.md). Os componentes fornecidos pelo starter mantêm suas licenças. Projetos citados como inspiração não foram incorporados como aplicações adicionais dentro desta base.

A consulta de vulnerabilidades conhecidas das dependências de produção e as atualizações aplicadas estão em [docs/AUDITORIA-DEPENDENCIAS.md](docs/AUDITORIA-DEPENDENCIAS.md). Esse resultado é datado e precisa ser repetido ao atualizar os pacotes.
