# Operação, atualização e recuperação

## Dados que precisam ser preservados

No modo local, `.wrangler/state/` contém os bancos D1/SQLite e os objetos R2 emulados. `.dev.vars` contém as credenciais de bootstrap e a chave usada para cifrar segredos de MFA. São conteúdos diferentes do código: reinstalar dependências ou recompilar a interface não deve apagar nenhum deles.

Em hospedagem, D1 e R2 são recursos persistentes do ambiente. A publicação do código e a execução de novas migrações não equivalem a recriar o banco. O banco local e o banco hospedado são independentes; os dados não são sincronizados automaticamente.

## Atualização local

1. Encerre a aplicação com `Ctrl+C`.
2. Faça uma cópia consistente dos dados conforme a seção seguinte.
3. Atualize o código da versão desejada.
4. Execute `npm ci` e `npm run setup:local`.
5. Inicie com `npm start`.
6. Entre e confira um aluno, uma cobrança e a personalização previamente salvos.

O setup utiliza o histórico de migrações do Wrangler e aplica somente arquivos novos. Nunca edite uma migração já aplicada. Correções posteriores devem virar uma nova migração. O setup não tem comando de reset e não remove os dados existentes.

### Personalização 1.2.0 e retorno de versão

A migração `0003_personalization.sql` é aditiva e contém somente criação de tabelas e índice: preferências por conta, histórico de configurações e temas/rascunhos. A inicialização do aplicativo preserva a configuração existente como primeiro snapshot. Contas, credenciais, configurações, dados operacionais e imagens não são apagados nem recriados.

Depois da primeira gravação no formato 1.2.0, `settings.value` passa a incluir os novos campos de personalização. O Worker 1.1.0 usa um schema estrito anterior e não interpreta esse JSON. **Voltar apenas ao código 1.1.0 após essa gravação deixa a configuração incompatível.** Corrija falhas de código com uma publicação que mantenha compatibilidade com o contrato 1.2.0. Aplique as migrações pendentes antes de iniciar o Worker atualizado; o healthcheck exige as três tabelas novas.

Para desfazer uma aparência, use **Configurações → Personalizar academia → Histórico**. A restauração cria outra versão e preserva as regras de acesso, os padrões por perfil e as preferências pessoais. Não restaure uma cópia antiga de todo o banco apenas para trocar o tema: isso poderia substituir cadastros e lançamentos feitos depois do backup. Recuperação completa de dados segue o procedimento separado de restauração, com validação em outro ambiente e decisão explícita do responsável.

## Backup local no Windows

O comando automatizado abaixo exige que você encerre a aplicação primeiro. Ele copia SQL, objetos R2 e `.dev.vars` para uma pasta nova fora do projeto, confere hashes antes/depois da cópia e cria um manifesto somente ao concluir. Não contém um comando que apaga ou substitui a base operacional.

```powershell
$BackupVitality = Join-Path $env:USERPROFILE ("Documents\VitalityBackups\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm run backup:local -- --output "$BackupVitality" --app-stopped
npm run backup:local -- --verify "$BackupVitality"
```

O parâmetro `--app-stopped` é a declaração do operador de que todas as instâncias estão paradas; o script não consegue provar que outro processo não está escrevendo. Mudanças detectadas durante a cópia causam falha e não geram um manifesto de conclusão. Uma cópia interrompida fica preservada para inspeção e deve ser refeita em outra pasta, sem sobrescrever backups.

Os arquivos copiados contêm segredos e dados pessoais. A cópia usa permissões restritas onde suportadas pelo sistema; ela **não é cifrada**. Use armazenamento protegido e faça uma segunda cópia externa. O teste automatizado executa backup/restauração de uma base SQLite e objetos sintéticos e detecta adulteração; isso não substitui um exercício com a infraestrutura operacional.

### Alternativa manual

Pare a aplicação antes da cópia para que os arquivos SQLite e seus journals não mudem durante o backup. Salve fora do diretório do projeto, em local com acesso restrito. Exemplo PowerShell, executado na raiz do projeto:

```powershell
$DestinoVitality = Join-Path $env:USERPROFILE ("Documents\VitalityBackups\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $DestinoVitality -Force | Out-Null
Copy-Item -LiteralPath '.\.wrangler\state' -Destination (Join-Path $DestinoVitality 'state') -Recurse
Copy-Item -LiteralPath '.\.dev.vars' -Destination (Join-Path $DestinoVitality '.dev.vars')
Copy-Item -LiteralPath '.\package-lock.json' -Destination (Join-Path $DestinoVitality 'package-lock.json')
Write-Host "Backup criado em $DestinoVitality"
```

A pasta de backup contém dados pessoais e segredos. Use uma unidade protegida e uma segunda cópia fora da máquina. Este procedimento copia os arquivos; ele não implementa criptografia do backup nem agendamento automático.

## Restauração local

Teste a restauração em uma cópia separada do projeto, com a mesma versão de código e `package-lock.json` do backup:

1. Instale as dependências dessa versão.
2. Com a aplicação parada, copie `state` para `.wrangler/state/` na cópia de teste.
3. Copie `.dev.vars` do backup para a raiz dessa cópia.
4. Faça o build e inicie a aplicação. Verifique dados, imagens e login.
5. Só depois execute migrações de versões posteriores.

Não sobrescreva um banco em execução. Não troque a chave `TOTP_ENCRYPTION_KEY` por outra aleatória ao restaurar: isso impediria ler os segredos MFA que já estão cifrados. Restauração que substitui dados operacionais exige uma decisão explícita do responsável.

## Hospedagem e backups

O provedor de hospedagem deve disponibilizar exportação/recuperação de D1 e cópia dos objetos R2. O código não inclui um serviço agendado que envia backups para um destino externo, pois esse destino e suas credenciais ainda não foram definidos. Consulte a documentação do ambiente antes de ativar produção com dados reais. Um export SQL não contém as imagens do R2.

Não use `--remote` nos comandos locais. O deploy por Sites é feito pelos mecanismos próprios da hospedagem. Para uma conta Cloudflare independente, provisione seus próprios bindings e segredos em um ambiente separado; não reutilize identificadores de outro ambiente.

## Retenção e auditoria

Cadastros são desativados, contratos são cancelados e pagamentos são estornados por ações próprias. O histórico financeiro permanece. Logs de auditoria registram operações; a aplicação não permite sua edição pela interface. Requisitos organizacionais de retenção, exclusão de dados pessoais e atendimento aos titulares precisam ser definidos pela academia antes de operação real.

## O que os testes automatizados alteram

`npm run test:ci` cria uma base local temporária própria, sobe a aplicação compilada, cria dados identificados como QA e encerra o servidor ao final. Ele não usa `.wrangler/state` da operação. A suíte HTTP direta exige `VG_TEST_ALLOW_WRITES=1`; use-a somente em homologação. Testes no banco da academia não são uma rotina de produção.
