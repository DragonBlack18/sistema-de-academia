# Evidências executadas — reforço do backend

Data de referência: **27 de outubro de 2026**, fuso de apresentação **America/Sao_Paulo**.

O frontend permaneceu congelado nesta rodada. O trabalho se concentrou em persistência, transações, autorização, autenticação, configuração operacional e testes do servidor. A inspeção de diferenças nos diretórios `components/`, `lib/`, nas páginas, no layout e no CSS não encontrou alteração na interface durante a conferência de QA.

## Escopo do ambiente

As suítes HTTP foram executadas contra a prévia oficial local `http://terminal.local:4173/`, usando Worker, D1 e R2 locais, e repetidas no GitHub Actions em uma base isolada. No CI, o build real é servido por Miniflare/workerd com HTTP, assets e bindings preservados. Foram criadas contas e informações sintéticas, sem importar o banco anterior, acionar gateways de pagamento, enviar mensagens ou operar equipamentos físicos. O código da aplicação recebeu as mesmas requisições de API que são usadas pelo frontend; não houve substituição de respostas do servidor por mocks.

O banco publicado não foi usado como base de testes. O fato de o processo local estar acessível não foi tratado como prova de prontidão operacional: o endpoint restrito de prontidão retornou **503** e identificou os requisitos pendentes do ambiente de teste, como se espera.

## Resultados observados nesta rodada

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Sintaxe dos scripts de QA | **PASS** | `node --check` nas suítes, cliente HTTP e harness alterados. |
| ESLint dos arquivos de QA alterados | **PASS — 0 erros/avisos** | Execução direta do ESLint sobre as suítes e o harness. Conferência geral concluída pelo executor principal conforme linhas abaixo. |
| Integração dos fluxos originais | **PASS — 21 gates, 0 falhas** | `outputs/integration-report.json`, 12:38:13–12:38:33. Incluiu os novos controles de MFA e o parser de imagem. |
| Conferência financeira entre perfis | **PASS — 1 gate** | `outputs/finance-report.json`, 12:38:33. Proprietário e financeiro receberam os mesmos totais autorizados. |
| Fluxos complementares de backend | **PASS — 24 gates, 584 verificações contabilizadas, 0 falhas** | `outputs/backend-flows-report.json`, 12:42:46–12:42:57. Incluiu a matriz de sete perfis, todas as 20 listas e as regressões finais de busca, formato JSON e gratuidade. |
| Persistência após reinício da versão atual | **PASS — 22 gates, 0 falhas** | `outputs/restart-report.json`: 4 gates; `outputs/backend-restart-report.json`: 18 gates. Execução 13:44:11–13:44:12 após parar a prévia oficial, aplicar a migração 0002 e iniciar outro processo usando a mesma persistência. |
| Testes determinísticos de autenticação | **PASS — 21 gates, 0 falhas** | `outputs/security-hardening-report.json`, 12:40:54–12:41:05; arquivo de resultado conferido pela QA. |
| Testes determinísticos de domínio | **PASS — 28 gates, 0 falhas** | `outputs/domain-hardening-report.json`, 12:40:38; arquivo de resultado conferido pela QA. |
| Testes determinísticos de operação | **PASS — 8 gates, 0 falhas** | `outputs/operations-hardening-report.json`; arquivo de resultado conferido pela QA. |
| TypeScript da fonte completa | **PASS** | `tsc --noEmit --incremental false`, após integração das correções. |
| ESLint da fonte completa | **PASS — 0 erros/avisos** | Execução geral, sem reduzir regras do projeto. |
| Build oficial de publicação | **PASS** | Worker, cliente e SSR compilados; aviso de chunk acima de 500 kB permanece sem alteração do frontend. |
| Auditoria de dependências de produção | **PASS — 0 vulnerabilidades conhecidas** | `npm audit --omit=dev --json`, relatório `outputs/npm-audit-production.json`. |
| Pipeline remoto no GitHub Actions | **PASS — job completo e artefatos confirmados** | [Execução 40546837491](https://github.com/DragonBlack18/sistema-de-academia/actions/runs/40546837491), commit da PR `52409b01f058c5141d19d17bfe8c53ad6ad20c7f`; conclusão da suíte às 14:04:14 em 27/10/2026. |

Os relatórios JSON são gerados localmente e como artefatos no CI; não são incluídos na árvore pública do código. O nome e a quantidade de gates descrevem verificações agrupadas, não porcentagem de cobertura de linhas ou comprovação formal de ausência de defeitos.

As suítes HTTP e de persistência somam **68 gates aprovados**: 21 de integração, 1 de conferência financeira, 24 de fluxos complementares e 22 após reinício. As 584 verificações contabilizadas da suíte complementar estão dentro de seus 24 gates; elas não são somadas novamente ao total.

Somados aos **57 gates determinísticos** — 21 de segurança, 28 de domínio e 8 de operação — são **125 gates aprovados, sem falhas**, além de tipos, lint, build, migrações e auditoria de dependências. A execução remota acima repetiu essas suítes completas em Ubuntu com Node 24, incluindo a parada e a partida de dois processos distintos sobre os mesmos dados isolados.

## Execução remota e correção do harness

A primeira execução remota interrompeu o teste de origem após o proxy de `wrangler dev` devolver 503 imediatamente depois da rejeição 413 de um corpo excessivo. A inspeção da versão instalada e os relatos upstream indicaram uma falha na camada de proxy; a mensagem não comprovava um reinício real do Worker. O harness passou a executar o build diretamente em Miniflare/workerd, usando o adaptador e o runtime da mesma dependência fixada pelo lockfile.

A execução aprovada manteve os testes e os códigos esperados, inclusive a sequência imediata 413 → 403. Não foram acrescentadas pausas artificiais, repetição de requisições ou exceções para aceitar falhas. Os logs passaram a ser drenados durante a execução, e falha no encerramento do runtime também reprova o CI. O resultado foi confirmado pelo job completo `full-stack` e pelo artefato `vitality-gym-validation`, ID `12753715633`.

Os relatórios de CI têm retenção de 14 dias nos artefatos. Esta evidência registra a execução identificada acima; para alterações posteriores, consulte o resultado do commit correspondente na [aba Actions](https://github.com/DragonBlack18/sistema-de-academia/actions).

## O que foi exercitado

As 20 listas foram chamadas com cada um dos sete perfis: proprietário, administrador, gerente, recepção, financeiro, professor e personal. Isso produziu **140 verificações de acesso a listas**, além de dashboard, relatórios, personalização e recusas de escrita. Quando um perfil não possui permissão de escrita, a API foi chamada diretamente com um corpo vazio para verificar que a autorização é aplicada antes da validação do formulário.

Também foram exercitados os seguintes fluxos completos:

- Cadastro, leitura e edição dos dados de alunos, equipe, planos, exercícios, avaliações, produtos e fornecedores; conflitos de versão recusados.
- Matrícula com geração de cobrança, preço contratado preservado, renovação, suspensão, retomada e cancelamento com histórico.
- Matrícula gratuita com cobrança de valor zero vencida, confirmando que ela não bloqueia uma entrada válida; busca longa com caracteres UTF-8 e curingas literais; rejeição de tipo MIME que apenas contém o texto `application/json`.
- Cobrança paga, estornada, paga novamente, estornada novamente e cancelada; conferência dos recebimentos e estornos em centavos e do resultado líquido.
- Despesa aberta, paga, corrigida mediante justificativa e cancelada.
- Entrada recusada e auditada, liberação excepcional com perfil autorizado, saída e bloqueio de saída repetida.
- Prescrição de treino, ativação, execução, substituição por nova ficha, arquivo e bloqueio de operações em ficha arquivada.
- Reservas de aula com duplicidade e limite de vagas, concorrência pela última vaga, redução de capacidade recusada, cancelamento de reserva e retirada de aluno que foi desativado.
- Ajustes simultâneos de estoque, recebimento concorrente de compra, cancelamento de compra em rascunho, rejeição de venda com item sem saldo, preço adulterado recusado, venda idempotente concorrente e estorno sem duplicar a recomposição.
- Mudanças de etapa de um contato e conversão concorrente sem duplicar o aluno.
- Avisos gerais e dirigidos, com leitura individual por conta e recusa de outro destinatário.
- Transferência do aluno para outro professor, com perda imediata do acesso do profissional anterior aos dados, avaliações e treinos.
- Desativação de acesso, papel alterado, senha alterada e logout, verificando que sessões antigas deixam de funcionar.
- Requisições com CSRF ausente, origem externa, JSON excessivo, upload excessivo ou tipo de arquivo falso, além de upload e leitura de PNG válido.
- Valores de personalização inseguros recusados sem incrementar a versão do registro.
- Rotas desconhecidas recusadas, métodos do healthcheck, identificador de requisição nos erros e prontidão operacional acessível somente ao proprietário.

No teste de MFA, a habilitação consumiu um código de uma janela de tempo. Reutilizar esse código para login foi recusado. O login seguinte e a desabilitação utilizaram códigos de janelas posteriores, dentro da tolerância documentada. Isso comprova o fluxo real com a proteção de uso único, além dos testes determinísticos de concorrência.

## Persistência e organização dos testes

Os testes complementares mantêm snapshots de campos relevantes de **18 módulos**: alunos, equipe, planos, matrículas, cobranças, despesas, exercícios, treinos, avaliações, aulas, produtos, fornecedores, compras, vendas, CRM, avisos, frequência e contas. Esses snapshots não contêm senhas, tokens ou segredos de MFA. A releitura após um reinício real é uma etapa distinta da criação dos dados.

A conferência após o reinício concluiu que os 18 snapshots continuavam iguais nos campos esperados. A suíte original também confirmou login utilizável, registros SQL anteriores, arquivo de imagem acessível pelo R2 com o tipo esperado e o tema salvo. O executor principal realizou a parada e a partida; a QA só iniciou a leitura depois da confirmação de que o novo processo estava atendendo.

O harness de CI usa uma base nova e isolada para cada execução, com login de domínio `.invalid`, senha aleatória e chave de MFA aleatória. O arquivo de ambiente e o banco não entram nos artefatos. A suíte HTTP exige credenciais pelo ambiente do processo; não há fallback com a senha ou o identificador real do proprietário no código de testes.

As Actions foram resolvidas nos repositórios oficiais e fixadas nos seguintes commits em 27/10/2026:

| Action | Versão consultada | Commit fixado |
| --- | --- | --- |
| `actions/checkout` | 7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | 7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | 7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

O token do workflow possui somente leitura de conteúdo e o checkout não mantém suas credenciais. A auditoria das dependências de produção é uma etapa com falha efetiva a partir de severidade moderada. O Dependabot propõe atualizações para revisão; nenhuma atualização é mesclada automaticamente pelo projeto.

## Verificação anterior de interface

Na entrega anterior, foram observadas a tela de login desktop e sua ajuda. O percurso autenticado completo no navegador, telas móveis, navegação por teclado e personalização visual não foram homologados. Esta rodada manteve a interface congelada e aprofundou o backend; os testes HTTP não ampliam automaticamente a evidência visual anterior.

## Limites da conclusão

Os resultados não equivalem a certificação de cibersegurança, pentest independente, ensaio de carga, homologação de integrações externas nem verificação de todos os requisitos históricos. Não comprovam uma restauração operacional de backup em outra infraestrutura. O relatório de prontidão e os procedimentos de operação devem ser usados para verificar as condições do ambiente que receberá dados reais.

Uma alteração posterior nos arquivos correspondentes exige repetir os gates afetados. O resultado final de TypeScript, lint geral, build, migrações, testes determinísticos, reinício e GitHub Actions deve corresponder ao commit entregue; não se deve substituir essa confirmação pelo resultado de uma versão anterior.

## Complementos de operação verificados

O teste de operação foi repetido após os ajustes finais e manteve **8 gates aprovados**: prontidão recusa chave MFA que não abre os segredos existentes e conta legada sem auditoria de troca de senha, mesmo quando a variável de bootstrap foi removida. O setup aceita comentários válidos em dotenv, gera apenas campos vazios, preserva credenciais existentes e restringe permissões do arquivo. Backup/restauração de SQLite, objetos e ambiente sintéticos foi executado; alteração de arquivo copiado foi detectada.

A tela de login desktop foi observada novamente na prévia após reinício, sem erros da aplicação no console. Não foi realizada nova homologação visual de todo o percurso autenticado.
