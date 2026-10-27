# Integridade do backend

Revisão de 27/10/2026. O frontend foi mantido inalterado. Este documento registra decisões de implementação e o alcance dos testes de domínio; as verificações HTTP, de autenticação e de operação estão nos demais documentos de validação.

## Escritas, permissões e concorrência

As operações de negócio usam consultas parametrizadas e um `D1Database.batch()` com uma condição de integridade no início. A condição e a alteração pertencem à mesma transação. Se alguma instrução falhar, a gravação do registro, suas relações, movimentações e auditoria são revertidas em conjunto, conforme o contrato de transações do [D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Além das permissões conferidas ao receber a requisição, a transação verifica se o autor ainda existe, está ativo e mantém o papel e a versão de conta usados na autorização. Desativar ou rebaixar uma conta enquanto uma operação está em processamento impede a confirmação com a autorização antiga. Essa regra também se aplica às configurações e aos metadados de uploads.

As alterações de registros usam controle otimista de versão. Um conflito retorna HTTP 409, permitindo recarregar a versão atual sem sobrescrever uma atualização concorrente. No domínio de treinamento, a associação do aluno ao professor e a responsabilidade do instrutor pela aula são verificadas novamente dentro da transação.

### Correções relevantes

| Área | Regra implementada |
| --- | --- |
| Aulas | Um professor só altera uma aula que já esteja sob sua responsabilidade; enviar seu próprio ID no campo `instructor_id` não concede acesso a uma aula alheia. |
| Reservas | Professor, aluno, capacidade e disponibilidade são revalidados na gravação. É possível cancelar uma reserva existente de um aluno que foi desativado. |
| Treinos | A troca de ficha ativa preserva uma versão exata da ficha anterior. Uma revisão concorrente dessa ficha aborta a troca e pede atualização. |
| Histórico de treinos | O snapshot contém a prescrição e seus itens, sem embutir novamente o próprio histórico ou as execuções. Quarenta revisões consecutivas foram verificadas sem crescimento recursivo. |
| Exercícios | Criação, edição e ativação de ficha revalidam a disponibilidade dos exercícios antes de confirmar. |
| Matrículas | Renovação e retomada exigem aluno ativo, inclusive no momento da confirmação. Preço e duração contratados continuam preservados. |
| Acesso | A entrada revalida matrícula, versão do plano, versão da política de carência e débitos. Cobrança com valor zero não representa inadimplência. Exceções continuam exigindo permissão e justificativa. |
| Vendas | Uma venda pode conter até 100 produtos, com validação de preço e estoque. Uma consulta com JSON parametrizado evita ultrapassar o limite de 100 parâmetros por instrução do D1. |
| Idempotência de venda | Repetir chave e dados mantém uma única venda. Mudar observações com a mesma chave retorna conflito. Chaves antigas continuam compatíveis quando correspondem ao registro já salvo. |
| Estorno de venda | Uma repetição com a mesma justificativa mantém o resultado original; outra justificativa não substitui silenciosamente o histórico. |
| Compras | Produtos e fornecedor precisam continuar ativos na confirmação do cadastro. Recebimento permanece atômico e não duplica estoque. |
| Formulários | Valores monetários e quantidades aceitam números ou texto numérico do formulário, mas rejeitam `null`, booleanos e arrays. Campos desconhecidos continuam rejeitados. |
| Busca | A pesquisa literal usa `INSTR` parametrizado para aceitar termos longos e caracteres `%`, `_` e apóstrofos. Isso evita o limite de 50 bytes em padrões `LIKE/GLOB` do D1. |
| Datas | Cálculos de meses tratam corretamente o último dia do mês e anos com menos de quatro algarismos; períodos fora do intervalo suportado retornam validação, não erro interno. |

Os limites citados estão na documentação oficial de [limites do D1](https://developers.cloudflare.com/d1/platform/limits/). A autorização por objeto segue as recomendações da [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

## Imagens e personalização

Os uploads aceitam uma imagem PNG, JPEG ou WebP por requisição, até 5 MiB por arquivo, 10.000 pixels por dimensão e 25 milhões de pixels no total. O formulário completo é limitado antes de sua interpretação. O tipo declarado precisa corresponder à estrutura encontrada no conteúdo.

O backend verifica os limites dos blocos e os metadados de dimensões. Em PNG, confere também os CRCs dos blocos e o encerramento do arquivo. Em JPEG, exige os marcadores e dimensões de quadro; em WebP, verifica o contêiner RIFF e as dimensões informadas nos blocos suportados. Arquivos truncados, cabeçalhos falsos e dimensões excessivas são recusados antes de gravação. A implementação não é um decodificador de pixels nem um antivírus; não se afirma que essa verificação substitui esses serviços.

Cada objeto recebe uma chave aleatória em R2. O nome original serve apenas como metadado normalizado. O registro SQL e a auditoria são confirmados juntos; se essa confirmação falhar, o backend tenta remover o objeto que acabou de enviar. D1 e R2 não compartilham uma transação: uma interrupção do processo entre as etapas, ou falha também na remoção compensatória, pode deixar um objeto sem referência. O evento de falha da remoção é registrado com o ID do objeto, sem dados pessoais ou credenciais.

As configurações exigem um objeto validado e sua versão. Referências a logo e wallpaper são conferidas por tipo e existência. Erros de validação e conflitos não substituem o tema anterior. Nenhuma regra permite CSS, JavaScript ou HTML arbitrário nos campos de personalização.

Referências: [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [PNG Third Edition — W3C](https://www.w3.org/TR/png-3/) e [WebP Container — Google](https://developers.google.com/speed/webp/docs/riff_container).

## Testes reproduzíveis

Execute no diretório do projeto após instalar as dependências:

```powershell
node tests/domain-hardening.mjs
```

A suíte não inicia servidor e não acessa dados de produção. Ela compila os módulos TypeScript para um diretório temporário ignorado pelo Git, aplica todas as migrações SQL em um SQLite em memória e executa as operações reais de domínio. O adaptador conserva os limites de 100 parâmetros por instrução e implementa transações com rollback. Hooks controlados introduzem alterações entre a leitura e a confirmação para testar conflitos de forma determinística.

Resultado da execução desta revisão: **28 gates aprovados, zero falhas**, incluindo 100 produtos em uma única venda, 40 revisões de treino, revogação de papel durante a transação, troca concorrente de responsável, falha de auditoria com rollback de estoque, compatibilidade das chaves de idempotência antigas e compensação de upload. O maior número de parâmetros por consulta observado na suíte foi **14**. Toda execução termina conferindo chaves estrangeiras e ausência de registros residuais na tabela de guards.

O relatório de cada execução fica em `outputs/domain-hardening-report.json`. Esses testes complementam, sem substituir, a suíte HTTP executada sobre o Worker real. O adaptador SQLite não reproduz latência, carga, armazenamento remoto, todos os limites de CPU ou falhas operacionais da hospedagem.

## Limites de escopo preservados

Recebimentos e estornos continuam registros internos; transferir dinheiro exige o meio de pagamento utilizado. Não foram adicionados gateway de cobrança, nota fiscal, catraca física, envio de mensagens ou integração bancária. O módulo de relatórios mantém o limite documentado de exportação de 10.000 linhas. Campos de status da matrícula permanecem estados explícitos do contrato; validade para acesso e métricas também considera o período de vigência. Não há rotina nesta mudança que reescreva automaticamente todo contrato vencido como `expired`.

Não houve alteração de layout, dependências de UI, formulários ou navegação. A validação deste documento não é certificação de segurança nem teste de carga de produção; a operação ainda exige credenciais apropriadas, backups verificáveis, controle de acesso da hospedagem e acompanhamento dos erros reais.
