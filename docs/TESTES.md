# Validação da versão web

## Evidência e limites

`tests/integration.mjs` testa o servidor HTTP real, seus cookies, regras de negócio e gravações no banco. `scripts/test-ci.mjs` compila a aplicação e usa uma base D1/R2 local separada, com um reinício entre a suíte principal e a conferência de persistência.

`tests/backend-flows.mjs` complementa essa execução com a matriz de sete perfis, todos os módulos de listagem e os fluxos que precisam de várias alterações para terminar. As expectativas de permissões ficam declaradas no teste de forma independente do catálogo do servidor: mudar acidentalmente um papel no backend não atualiza o teste junto.

A existência dos testes não significa que eles passaram. Os resultados executados ficam em:

- `outputs/ci-report.json`: etapa final e resultado do processo completo.
- `outputs/integration-report.json`: nome, duração e resultado de cada gate HTTP.
- `outputs/finance-report.json`: conferência dos totais acessíveis ao perfil financeiro.
- `outputs/restart-report.json`: leitura dos dados depois da reinicialização.
- `outputs/backend-flows-report.json`: os fluxos complementares, a quantidade de verificações e a matriz de permissões.
- `outputs/backend-restart-report.json`: releitura de 18 módulos após reinicialização, comparada a snapshots sem credenciais.
- `outputs/security-hardening-report.json`: testes determinísticos dos controles de autenticação e concorrência.
- `outputs/domain-hardening-report.json`: testes determinísticos de regras e transações de domínio.
- `outputs/operations-hardening-report.json`: configuração, bootstrap, prontidão e backup/restauração sintéticos.
- `outputs/dependency-audit.json`: resultado da consulta de vulnerabilidades nas dependências de produção no CI.
- `outputs/worker-test.log`: saída do Worker no ambiente isolado de testes.

Um relatório `NOT_RUN` significa que o teste ainda não foi executado naquele ciclo. `FAIL` interrompe as etapas dependentes. Nunca trate um relatório de uma versão anterior como evidência de código alterado depois.

## Executar sem usar dados reais

O caminho reproduzível é:

```sh
npm ci
npm run test:ci
```

O harness cria uma pasta temporária ignorada em `.sites-runtime`, uma conta `qa.owner@example.invalid`, uma senha aleatória e uma chave de MFA próprias. Aplica todas as migrações em um D1 novo, inicia o Worker compilado, executa as suítes e reinicia o processo usando o mesmo diretório de persistência. Ele não reutiliza o banco normal em `.wrangler/state`, não usa o ambiente publicado e não imprime a senha. Os relatórios publicados pelo CI não incluem o arquivo de ambiente, o banco ou os snapshots completos das fixtures.

`scripts/test-worker.mjs` executa o build real diretamente em Miniflare/workerd, com HTTP em loopback, assets e os bindings D1/R2 da configuração compilada. O adaptador e o runtime são resolvidos da mesma versão de Wrangler fixada pelo lockfile; atualizar essa dependência exige validar também o adaptador `unstable_getMiniflareWorkerOptions`. A persistência utiliza o mesmo diretório `v3` preparado pelas migrações. O runner exige `APP_ENV=test` e não repete requisições HTTP para esconder falhas.

Essa execução direta evita o proxy de `wrangler dev`, cuja versão utilizada pode retornar uma mensagem enganosa de reinício após rejeitar um corpo em fluxo excessivo. A sequência de teste continua exigindo 413 para o corpo excessivo e 403 para a tentativa seguinte de origem indevida, sem pausa artificial ou nova tentativa de escrita. Relatos primários relacionados: [workers-sdk #15709](https://github.com/cloudflare/workers-sdk/issues/15709) e [#14641](https://github.com/cloudflare/workers-sdk/issues/14641). A API de execução está documentada em [Cloudflare — Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/get-started/).

Para testar uma prévia local que já esteja em execução, forneça `VG_TEST_BASE_URL`, `VG_TEST_ALLOW_WRITES=1`, `VG_TEST_LOGIN` e `VG_TEST_PASSWORD` pelo ambiente do processo. O teste complementar aceita somente `localhost`, `127.0.0.1`, `::1` ou a prévia interna `terminal.local`. Use uma base de teste separada e um meio de injeção de segredos que não grave valores no histórico do terminal. Não inclua senhas nos comandos salvos, nos commits ou nos relatórios.

```sh
node tests/integration.mjs
node tests/finance-reports.mjs
node tests/backend-flows.mjs
```

Somente depois de parar e reiniciar **o processo real que atende esse ambiente**, execute:

```sh
node tests/integration.mjs --persistence
node tests/backend-flows.mjs --persistence
```

Na primeira suíte, use `VG_TEST_REPORT=outputs/restart-report.json` para preservar o resultado anterior. Executar uma consulta pela segunda vez no mesmo processo não comprova persistência após reinício.

O harness que inicia um Worker próprio é destinado ao ambiente local do desenvolvedor e ao GitHub Actions. No ambiente gerenciado de Sites, a validação usa a prévia oficial; não se deve lançar outro servidor para contornar essa regra.

## Matriz de cobertura por módulo

| Módulo ou opção existente | Verificações HTTP |
| --- | --- |
| Alunos | Campos completos, edição parcial, validação, conflito de versão, busca/paginação, projeção financeira, vínculo profissional e transferência de responsabilidade. |
| Equipe | Cadastro com conta vinculada, edição, leitura do valor salvo e restrição por perfil. |
| Planos | Cadastro, preço/duração, horários em par, edição e preservação do valor já contratado. |
| Matrículas | Cobrança automática, desconto autorizado, duplicidade, renovação, suspensão, retomada, cancelamento, histórico e acesso válido para contrato gratuito. |
| Cobranças | Receber, estornar, receber novamente, cancelar, chaves idempotentes incompatíveis, concorrência e totais em centavos. |
| Despesas | Aberta → paga → corrigida com motivo → cancelada, preservando as regras de data e justificativa. |
| Frequência | Recusa auditada, liberação excepcional autorizada, entrada duplicada, saída e repetição de saída. |
| Exercícios | Cadastro/edição, instruções e vídeo HTTPS, rejeição de esquema inseguro. |
| Treinos | Prescrição, edição com versão, ativação, execução, substituição de ficha, arquivo e proibição de alterar/executar ficha arquivada. |
| Avaliações | Medidas, cálculo do IMC, edição, vínculo imutável do aluno e recusa por outro profissional. |
| Aulas | Agenda, reserva, duplicidade, capacidade, concorrência, redução inválida de vagas, cancelamento de reserva e escopo do instrutor. |
| Estoque | Cadastro, custo/preço, ajuste concorrente, tentativa de definir saldo diretamente, saldo negativo e movimentos. |
| Fornecedores | Dados de contato, edição persistida e conflito de versão. |
| Compras | Itens, total, cancelamento antes do recebimento, recebimento concorrente/repetido e imutabilidade posterior. |
| Vendas | Preço do catálogo, rejeição de múltiplos itens com falta de saldo, chave idempotente, baixa única, estorno e recomposição única. |
| CRM | Novo → em contato → experimental → convertido, conversão concorrente e proibição de reescrever contato convertido. |
| Notificações | Aviso geral/dirigido, recusa de leitura indevida e marcadores de leitura individuais. |
| Acessos | Sete papéis, impossibilidade de escalação, logins únicos, desativação e revogação efetiva de sessões. |
| Personalização e mídia | Gravação, segunda sessão, conflito, restauração do tema, valores inseguros recusados, PNG real e limites de upload. |
| Relatórios e auditoria | Agregados autorizados, conciliação de valores, CSV, proteção de fórmulas, registros e rotas sem mutação livre. |
| Segurança | CSRF, origem, cookie, MFA com código de uso único, revogação, limites de corpo e limites exatos de rota. |

Os sete perfis percorrem as 20 listas, o dashboard, os relatórios e as configurações. Quando um perfil não possui escrita em um módulo, a suíte chama sua API diretamente e exige recusa antes da validação do formulário. Para alunos, treinos, avaliações, reservas e notificações, há também verificações de autorização por registro. Essas verificações por registro são necessárias mesmo quando a pessoa tem permissão para abrir o módulo.

## Segurança do pipeline

O workflow fixa `checkout`, `setup-node` e `upload-artifact` nos SHAs completos consultados nos repositórios oficiais, usa token com `contents: read` e não mantém a credencial no checkout. O Dependabot propõe atualizações de pacotes e Actions; atualizar um SHA exige revisão e execução dos mesmos testes. O workflow não possui etapa que publique automaticamente uma aplicação ou use segredos de produção.

Referências primárias: [GitHub — uso seguro de Actions](https://docs.github.com/en/actions/reference/security/secure-use), [Cloudflare — transações de D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [OWASP — matriz de testes de autorização](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Testing_Automation_Cheat_Sheet.html) e [OWASP — prevenção de acesso indevido por identificador](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html).

## O que a suíte comprova quando passa

| Grupo | Critério real |
| --- | --- |
| Autenticação | A senha correta cria uma sessão utilizável; senha errada não autentica. |
| Sessão e CSRF | Cookie tem atributos de segurança; alterações sem token ou de origem indevida são recusadas. |
| Limites de corpo | JSON e upload acima do limite são recusados, incluindo envio em fluxo sem `Content-Length`. |
| Hierarquia | Perfis inferiores não criam proprietários; último acesso proprietário é protegido. |
| Alunos | Criação/edição reaparecem na API; atualização com versão obsoleta retorna conflito; editar nome preserva status omitido. |
| Escopo profissional | Personal consegue acessar o aluno vinculado e não consegue acessar outro aluno. |
| Contrato | Matrícula gera cobrança e preserva o preço contratado após mudar o plano. |
| Financeiro | Repetição identificada não duplica pagamento; operações concorrentes não geram dois recebimentos. |
| Entrada | Aluno sem matrícula ou com atraso fora da carência é recusado, e a recusa fica registrada. |
| Frequência | Entrada é persistida, entrada aberta duplicada é bloqueada e saída fecha o registro. |
| Treino | Prescrição e revisão são gravadas, com preservação de versão anterior. |
| Avaliação/aula | Avaliação é salva; duas reservas concorrentes não ultrapassam uma vaga. |
| Estoque | Recebimento, venda e estorno alteram o saldo uma única vez; não é permitido saldo negativo; editar nome preserva custo e estoque mínimo. |
| Despesas | Alterar despesa paga exige justificativa e grava o novo valor. |
| CRM e avisos | Conversão não duplica aluno; destinatário e leitura de notificação são respeitados. |
| Personalização | Uma segunda sessão lê o tema gravado; salvamento obsoleto falha; o teste restaura o tema original. |
| Upload | Um falso PNG é rejeitado e um PNG real é armazenado/servido. |
| Relatórios | Indicadores têm valores reais; CSV é retornado e células perigosas recebem tratamento. |
| MFA | Configuração, habilitação, login com código e desabilitação funcionam; habilitar/desabilitar encerra outras sessões da conta. |
| Revogação | Mudança de papel/senha e logout impedem o reuso das sessões anteriores; editar nome de usuário inativo não o reativa. |
| Histórico | Renovação, suspensão, retomada e cancelamento preservam as cobranças e o histórico. |
| Reinício | SQL, arquivo R2 e configurações são consultáveis no mesmo ambiente após reiniciar. |

Os testes não representam auditoria de segurança independente, ensaio de carga, simulação de falha de disco nem homologação de gateway/catraca. Nenhum serviço externo real é cobrado ou acionado.

## Conferência de interface

Além da suíte HTTP, confira no navegador:

1. Login correto, incorreto e com segundo fator.
2. Navegação por teclado e foco nos diálogos; Escape e retorno ao botão de origem.
3. Criar e editar aluno, cancelar formulário e preservar dados após erro de validação.
4. Pesquisa sem resultados, limpeza da pesquisa e paginação.
5. Matrícula → cobrança → pagamento → check-in → check-out.
6. Ação de risco com confirmação e justificativa.
7. Edição de treino com mais de um exercício.
8. Troca de fonte, posição da navegação, cores, logo e papel de parede, seguida de recarregamento.
9. Tela menor, rolagem de tabela e formulário comprido.
10. Sessão expirada e conflito causado por duas janelas editando o mesmo registro.

A automação HTTP não substitui esse percurso. Um botão visível e um `200` na página não comprovam que o fluxo da interface inteira está correto.
