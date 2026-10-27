# Preparação do ambiente de produção

A versão 1.2.0 acrescenta personalização persistente à base de segurança e integridade da versão 1.1.0: marca e temas compartilhados, preferências por conta, padrões por perfil e histórico de aparência. Código testado e configuração operacional são requisitos diferentes: o ambiente de demonstração não deve ser apresentado como academia em produção com dados reais.

## Ambiente e segredos

Configure no servidor:

| Variável | Produção |
| --- | --- |
| `APP_ENV` | `production` |
| `ENABLE_DEMO_DATA` | `false`, explicitamente |
| `TOTP_ENCRYPTION_KEY` | 64 caracteres hexadecimais aleatórios; preserve a mesma chave enquanto houver segredos cifrados com ela |
| `ADMIN_LOGIN` | Identificador escolhido para o primeiro proprietário de uma base nova |
| `ADMIN_PASSWORD` | Senha inicial forte, com 16–128 caracteres; guardada como segredo do servidor |

Uma base já inicializada mantém suas contas. Alterar `ADMIN_PASSWORD` não redefine senhas existentes. O bootstrap nunca cria um proprietário sobre uma base que já contém outros usuários. Se não houver proprietário ativo nesse caso, a aplicação falha de maneira segura e requer recuperação administrativa do ambiente.

Para instalações novas locais, `setup:local` gera senha e chave aleatórias em `.dev.vars`. Para produção hospedada, use o gerenciador de segredos do ambiente. Nenhum segredo operacional deve ser enviado ao GitHub, ao frontend, a URLs ou aos artefatos do CI. O modo de produção rejeita seed demonstrativo, chave inválida e acessos HTTP aos recursos da aplicação.

## Verificação de prontidão

Depois de entrar como proprietário, abra `/api/system/readiness` na mesma origem da aplicação. O endpoint usa sua sessão atual. Administradores e demais perfis recebem 403; visitantes sem sessão recebem 401.

Retorna **200 e `ready: true`** somente quando os requisitos automatizáveis abaixo passam. Retorna **503 e `ready: false`**, com os itens pendentes, se algum deles falhar:

1. Esquema e migrações de autenticação/configuração disponíveis.
2. Modo `production` e origem HTTPS.
3. Binding de armazenamento de imagens presente.
4. Chave TOTP válida, capaz de abrir os segredos MFA das contas proprietárias.
5. Seed desativado e ausência do marcador de carga demonstrativa na base.
6. Senhas iniciais dos proprietários trocadas e sinalizadores de troca pendente resolvidos.
7. MFA ativado para todos os proprietários ativos.

A verificação da senha inicial exige auditoria de troca da própria conta, confere seus sinalizadores e compara a credencial de bootstrap quando ainda está configurada. Remover a variável não libera uma conta legada sem troca auditada. Essa verificação não mede a força de toda senha já cadastrada. O binding R2 presente não substitui um teste operacional de escrita/leitura. O resultado não certifica backup externo, disponibilidade do provedor, teste de carga, pentest independente nem integrações de terceiros.

O ambiente privado demonstrativo pode retornar 503 corretamente. Não remova dados para tornar esse indicador verde. Para iniciar uma operação sem demonstração, provisione uma base separada e vazia, configure `ENABLE_DEMO_DATA=false` antes do primeiro acesso e valide o fluxo completo com registros de homologação autorizados. Trocar somente a variável não apaga cadastros demonstrativos existentes.

## Implantação e atualização

- A hospedagem atual usa Workers, D1 e R2. A audiência privada do Site deve ser preservada até uma decisão explícita de abertura.
- As migrações são incrementais. `0000` permanece intacta; `0001` acrescenta atividade de sessão e consumo TOTP; `0002` acrescenta índices para limpeza limitada; `0003` cria somente o schema de preferências, histórico e temas/rascunhos.
- Não use comandos de reset, `DROP`, exclusão de volumes ou recriação do banco como atualização.
- Faça backup consistente, registre a versão do código e aplique somente migrações pendentes.
- Depois da atualização, confira saúde, login, uma gravação de teste autorizada, relatório de prontidão e leitura dos dados anteriores.
- Voltar apenas o código para uma versão antiga não desfaz migrações. As migrações desta entrega são aditivas; qualquer restauração de dados deve ser planejada e testada em ambiente separado.

O CI executa sobre dados efêmeros, com credenciais sintéticas. Não possui credenciais para publicar ou alterar a base operacional. A implantação do Site usa o fluxo próprio do provedor; hospedar numa conta Cloudflare independente exige provisionar os próprios recursos e segredos.

### Compatibilidade de recuperação da versão 1.2.0

Aplique `0003` antes de iniciar o Worker atualizado; o healthcheck verifica as tabelas novas. O bootstrap registra o snapshot da configuração existente sem redefini-la. Não há reset, limpeza de dados ou alteração das credenciais nessa atualização.

Após gravar a personalização no formato novo, voltar somente ao bundle 1.1.0 é incompatível: o schema antigo rejeita os novos campos de `settings.value`. Recupere o código por uma publicação que continue entendendo o contrato 1.2.0. Para recuperar apenas a aparência, use o histórico dentro do aplicativo atualizado; a restauração preserva regras, padrões de perfil e preferências individuais. Não exclua tabelas nem restaure indiscriminadamente um banco anterior para reverter uma configuração visual. Uma restauração completa de dados deve ser verificada em ambiente separado, considerando todos os registros criados depois da cópia.

## Observação de falhas

`GET /api/health` verifica acesso ao esquema necessário. Não cria contas ou dados demonstrativos, não divulga segredos e não faz uma certificação de toda a aplicação. `HEAD` é aceito; outros métodos são recusados.

Respostas da API recebem `X-Request-ID`. Erros JSON incluem o mesmo identificador. Use esse valor ao correlacionar um relato com logs estruturados do servidor. Logs de erro não incluem corpo de formulário, senha, token, segredo MFA ou valores vinculados a consultas SQL. Respostas 429 incluem `Retry-After: 900`.

Antes da abertura operacional, configure alertas no provedor para indisponibilidade, erros 5xx, falhas persistentes de autenticação e consumo de recursos. O projeto não presume que um serviço externo de monitoramento ou uma pessoa de plantão já foi contratado.

## Backup e restauração

O comando `npm run backup:local` cria cópia offline do estado SQL/R2 local e do arquivo de ambiente, gera manifesto SHA-256 e verifica cada arquivo. Ele recusa sobrescrever pastas ou salvar dentro do projeto. Leia [OPERACAO.md](OPERACAO.md) para comandos e limites. SHA-256 detecta corrupção; não cifra dados nem autentica um manifesto alterado por um invasor.

Na hospedagem, um export SQL não inclui imagens do R2 nem os segredos necessários para ler MFA. A recuperação deve abranger esses três elementos e a versão de código. O D1 oferece mecanismos de exportação e Time Travel na plataforma Cloudflare, mas sua disponibilidade administrativa no ambiente contratado precisa ser conferida pelo responsável. Não foi criado um agendamento externo de backup nesta entrega.

## Integrações e limites que permanecem

Pagamentos, estornos e vendas são lançamentos internos, sem cobrança real em gateway. E-mail, WhatsApp, catracas físicas, biometria, emissão fiscal e importação do banco legado exigem integrações próprias. O escopo atual é uma academia/unidade, operação online, sem Portal do Aluno ou Electron.

A camada de imagem valida estrutura e metadados; não executa um antivírus nem decodifica todos os pixels. D1 e R2 não oferecem transação conjunta: falhas normais de upload possuem compensação; uma interrupção abrupta ainda pode deixar objeto órfão. Backup e regras de retenção precisam considerar os dados pessoais, financeiros e de avaliação armazenados.

## Referências primárias

- [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [Cloudflare D1 — migrações](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 — exportação e importação](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Cloudflare D1 — Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [GitHub — uso seguro de Actions](https://docs.github.com/en/actions/reference/security/secure-use)

Consulta e verificação: 27/10/2026. Evidências e limites de execução: [VALIDACAO-EXECUTADA.md](VALIDACAO-EXECUTADA.md).
