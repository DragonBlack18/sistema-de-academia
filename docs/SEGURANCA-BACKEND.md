# Segurança do backend

Revisão de engenharia realizada em **27/10/2026**, com o frontend preservado. Este documento descreve controles implementados e verificações reproduzíveis. Não constitui certificação de segurança nem substitui avaliação independente antes de tratar dados reais em grande escala.

## Autenticação e sessões

A senha é armazenada com **scrypt**, sal aleatório de 16 bytes e parâmetros `N=32768`, `r=8`, `p=3`. A verificação usa comparação resistente a diferenças de tempo. O servidor rejeita hashes de formato ou parâmetros inesperados e limita o tamanho da senha recebida antes de executar o cálculo.

Novas senhas e alterações de senha usam o contrato existente de 10 a 128 caracteres. A configuração de produção exige uma senha inicial mais forte para criar a primeira conta. A atualização do código não substitui senhas de contas já existentes. A indicação `must_change_password` continua disponível na interface; não há bloqueio da navegação que impeça o usuário de chegar ao formulário de alteração.

Cada login bem-sucedido gera um token aleatório de 32 bytes. O banco mantém somente seu SHA-256. O cookie tem `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em HTTPS. Cookies de sessão duplicados são rejeitados para evitar seleção ambígua entre caminhos ou domínios.

A sessão possui dois limites independentes, aplicados no servidor:

| Limite | Valor | Comportamento |
| --- | --- | --- |
| Duração absoluta | 12 horas | Uma sessão ativa também expira após esse período. |
| Inatividade | 30 minutos | A API devolve 401 e a interface solicita novo login. |
| Atualização da atividade | A partir de 1 minuto | A atividade é atualizada sem escrever no banco em cada leitura do dashboard. |

Uma sessão excluída durante a atualização da atividade não é recriada. Antes de confirmar alterações protegidas, o banco revalida a conta, seu perfil, sua versão, sua condição ativa e a sessão que originou a operação. Essa associação permanece em um `WeakMap` no servidor, sem acrescentar identificadores de sessão ao usuário retornado em JSON. A expiração e a inatividade são comparadas com o relógio do próprio banco dentro da transação.

Troca de senha revoga todas as sessões. Alteração de acesso ou perfil também revoga as sessões daquele usuário. Ativar ou desativar MFA revoga as outras sessões, preservando somente a sessão que concluiu a ação.

## Limites contra tentativas automatizadas

A reserva de cada tentativa acontece por `INSERT ... SELECT ... WHERE`, com a contagem e a gravação na mesma instrução SQLite, antes da verificação cara de senha. Assim, requisições concorrentes não conseguem reservar mais tentativas que o limite.

| Operação | Limite em 15 minutos |
| --- | --- |
| Login de uma conta | 12 tentativas pendentes ou recusadas |
| Login de um IP | 60 tentativas pendentes ou recusadas, inclusive entre contas diferentes |
| Confirmar senha para alterá-la | 10 por conta |
| Configurar, ativar ou desativar MFA | 10 por conta, compartilhadas entre essas três ações |

Uma tentativa concluída com sucesso remove apenas sua própria reserva. Ela não apaga tentativas concorrentes ou falhas anteriores. O pedido inicial de código MFA integra o orçamento de autenticação. As contagens são persistidas no banco, portanto não se perdem ao reiniciar um Worker.

O IP vem de `CF-Connecting-IP`, definido pela infraestrutura Cloudflare. Em execução local sem esse cabeçalho, os acessos compartilham o identificador local. Publicar o Worker atrás de outra infraestrutura exige manter uma fronteira de proxy confiável; o código não confia em um `X-Forwarded-For` arbitrário enviado pelo navegador.

Registros com mais de 24 horas são removidos em lotes de até 256 por tentativa. Essa limpeza também ocorre quando o login falha, sem depender de um usuário conseguir entrar. Índices por data e atividade apoiam a retenção. A limpeza limitada evita transformar uma única requisição em uma exclusão sem limite.

## Autenticador TOTP

O autenticador usa TOTP SHA-1, seis dígitos, período de 30 segundos e tolerância de um intervalo anterior ou posterior. A tolerância acomoda pequenas diferenças entre os relógios do celular e do servidor.

O segredo de 20 bytes fica cifrado com **AES-256-GCM**, nonce aleatório e tag de autenticação. A chave permanece na configuração do servidor. Chave ausente, segredo inválido, conteúdo adulterado ou chave incompatível produzem erro de serviço 503 sem expor a exceção criptográfica.

O contador do último código aceito é persistido em `users.totp_last_counter`. Um código consumido não pode ser reutilizado em outro login ou ação. A atualização do contador ocorre na mesma transação da criação da sessão ou da alteração de MFA. Duas solicitações concorrentes com o mesmo código produzem, no máximo, um sucesso.

A configuração exige a senha atual. A ativação exige o código do segredo recém-configurado. A desativação exige senha atual e um código ainda não consumido. Depois de usar um código, é necessário aguardar o próximo se o aplicativo ainda exibir os mesmos seis dígitos. O frontend existente apresenta a mensagem retornada pelo servidor.

Não foi criado um mecanismo de recuperação por e-mail, código de emergência ou desativação administrativa de MFA. Antes de tornar MFA obrigatório para uma equipe, o responsável deve estabelecer uma recuperação operacional que preserve prova de identidade e auditoria. A chave de cifragem deve ser conservada com segurança: substituí-la sem uma migração dos segredos impede validar autenticadores já cadastrados.

## Hierarquia e integridade das autorizações

O backend determina as permissões a partir do perfil armazenado no banco. A criação e a alteração de usuários possuem verificações adicionais à permissão geral `users.write`:

- Somente `super_admin` pode criar ou alterar acessos administrativos.
- Um usuário não pode desativar sua própria conta nem reduzir seu próprio perfil por esse endpoint.
- A senha de um proprietário é alterada pelo fluxo de segurança com confirmação da senha atual.
- O último proprietário ativo não pode ser removido por operações concorrentes.
- Uma versão de registro antiga recebe conflito 409 e não substitui dados recentes.
- Um administrador rebaixado, desativado ou desconectado durante a operação não consegue confirmar uma gravação com a autorização anterior.

As rotas de usuários aceitam apenas a coleção ou um identificador. Sufixos e prefixos semelhantes não são tratados como rotas válidas. A paginação valida inteiros seguros e limita o tamanho de cada página. Campos de senha, segredo TOTP e contador TOTP não aparecem nas respostas públicas de usuários.

A busca de usuários usa comparação literal com `instr`, evitando o limite de 50 bytes que o D1 aplica a padrões `LIKE` e `GLOB`. Caracteres como `%`, `_` e apóstrofos continuam sendo texto pesquisável e os parâmetros permanecem separados da instrução SQL.

## Proteções HTTP

Operações de escrita exigem origem igual à aplicação e um token CSRF vinculado à sessão. JSON é aceito somente com o tipo de mídia `application/json`, podendo conter parâmetros como `charset`. O corpo é lido com limite de 256 KiB durante o streaming, inclusive quando o cliente não envia `Content-Length`.

As respostas da API recebem `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, política de referência, restrição de permissões do navegador e proteção contra incorporação em frames. Respostas JSON usam uma política CSP restritiva. HTTPS recebe HSTS. Esses cabeçalhos são controles das rotas da API; sua presença não representa uma auditoria de todas as políticas de HTML, ativos ou infraestrutura externa.

## Migrações

As alterações são incrementais e preservam a migração inicial:

| Migração | Alteração |
| --- | --- |
| `0001_auth_session_hardening.sql` | Adiciona `users.totp_last_counter` e `sessions.last_seen_at`; sessões anteriores herdam a data original de criação como atividade. |
| `0002_auth_retention_indexes.sql` | Acrescenta índices para retenção das tentativas e atividade de sessões. |

A migração não prolonga sessões antigas. Uma sessão que ficou inativa além do limite solicita novo login após a atualização. O esquema, os snapshots Drizzle e o journal acompanham as migrações.

## Evidências automatizadas

Execute, com as dependências instaladas:

```sh
node tests/security-hardening.mjs
```

A suíte usa as funções reais do backend, SQLite real com chaves estrangeiras e transações equivalentes aos batches D1. Os hooks de teste simulam alterações confirmadas entre leitura e gravação, incluindo revogação de sessão e alteração de credenciais. Nenhum servidor é aberto, nenhum banco de produção é acessado e os dados são sintéticos.

O relatório é escrito em `outputs/security-hardening-report.json`. Na revisão, **21 grupos passaram**, incluindo:

- Migração com conta e sessão anteriores, sem prolongamento de atividade.
- Parâmetros e comparação do hash de senha; vetores conhecidos de TOTP do RFC 6238.
- Cifragem, adulteração e configuração ausente de MFA.
- Origem, CSRF, cookies duplicados, tipo de mídia e corpo transmitido acima do limite.
- Trinta reservas concorrentes disputando doze posições, limite de IP e expiração da janela.
- Sessões opacas, expiração absoluta e por inatividade, e revogação durante atualização.
- Troca simultânea de senha e impossibilidade de criar sessão com a credencial antiga.
- Código TOTP consumido uma única vez, inclusive em login concorrente.
- Limites de confirmação de senha e configuração de MFA.
- Hierarquia, rotas inválidas, rebaixamento de administrador e proteção do último proprietário.
- Logout, expiração e inatividade ocorridos antes do commit, com rollback integral.
- Ausência de violações de chaves estrangeiras e limpeza dos guardas transacionais.

A suíte HTTP complementar verifica a integração dessas regras com o Worker e com os módulos. Resultados locais, CI remoto, configuração de produção e teste de restauração devem ser avaliados juntos. Os testes executados não medem capacidade de carga sustentada nem garantem ausência de vulnerabilidades desconhecidas.

## Referências primárias

- [OWASP — Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): resposta de autenticação, confirmação de senha e limitação de tentativas.
- [OWASP — Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): tokens, cookies, expiração absoluta e por inatividade.
- [RFC 6238, seção 5.2](https://www.rfc-editor.org/rfc/rfc6238): uso único do código TOTP e janela temporal.
- [Cloudflare — D1Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/): batches sequenciais com rollback em caso de falha.
- [Cloudflare — D1 Limits](https://developers.cloudflare.com/d1/platform/limits/): limites de parâmetros, consultas e padrões de busca.
