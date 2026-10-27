# Personalização do Vitality Gym

## O que pertence à academia e o que pertence à pessoa

A personalização mantém três níveis de escolha. A identidade da academia é a base. Um padrão por perfil pode adaptar a experiência de recepção, financeiro ou treinamento. A preferência salva na conta tem prioridade sobre esses padrões. Ao remover uma escolha pessoal, aquele campo volta a acompanhar o perfil e a academia.

| Nível | Quem altera | O que controla |
| --- | --- | --- |
| Identidade e aparência da academia | Proprietário e administrador, conforme `settings.write` | Nome, mensagem, logos, favicon, cores, fonte, ícones, fundo, cantos, tela de entrada e padrões gerais. |
| Padrões por perfil | Proprietário e administrador | Preferências iniciais de aparência, leitura e navegação de cada perfil. Não modificam permissões. |
| Preferências pessoais | Qualquer pessoa autenticada, na própria conta | Tema, fonte, posição e tamanho do menu, densidade das tabelas, escala do texto, movimento, transparência, página inicial e favoritos. |

Esconder, escolher ou favoritar uma página nunca concede acesso a ela. O servidor verifica a página inicial e os favoritos contra as permissões do perfil ao salvar. As APIs de alunos, financeiro, treinamento e demais módulos continuam aplicando suas próprias autorizações em cada operação.

Em **Configurações**, as abas são **Personalizar academia**, **Minhas preferências** e **Segurança**. A primeira aparece para quem pode editar a identidade global. Dentro dela, o editor organiza as escolhas em **Marca**, **Tema**, **Menu e ícones**, **Login**, **Por perfil**, **Temas salvos**, **Histórico** e **Regras**. A senha e o autenticador permanecem na área de Segurança.

## Identidade visual

As configurações da academia incluem:

- Nome e mensagem da marca, usados nos componentes da identidade.
- Cor de destaque, fundo do tema escuro e fundo do tema claro.
- Tema escuro, claro ou automático, com fonte Manrope, Inter ou a fonte do dispositivo.
- Cantos suaves ou mais retos, além de ícones com traço leve ou marcante.
- Substituição dos ícones das páginas por identificadores de um catálogo fechado.
- Logo principal, variantes para os temas escuro e claro, formato símbolo ou horizontal e escolha de exibir o nome junto à imagem.
- Favicon independente.
- Papel de parede, intensidade entre 0% e 35% e posição superior, central ou inferior.
- Imagem da tela de entrada, posição, apresentação dividida ou centralizada e textos de apresentação e boas-vindas.

As escolhas não aceitam CSS, JavaScript, fontes remotas ou componentes arbitrários. Os formatos e valores são limitados por schemas no servidor. Isso permite personalizar a aparência sem oferecer um campo capaz de substituir a estrutura da aplicação.

As cores do texto, superfícies e estados são geradas pelo adaptador compartilhado `lib/theme.ts`. O destaque visível é ajustado quando necessário para manter contraste nas superfícies da interface. O valor de marca escolhido permanece armazenado; a aplicação utiliza uma variação legível nos locais apropriados. Erros, avisos, sucesso e informações mantêm papéis semânticos próprios.

## Preferências pessoais e herança

Cada campo pode acompanhar os padrões ou receber uma escolha pessoal. Os campos pessoais disponíveis são:

| Preferência | Valores aceitos |
| --- | --- |
| Tema | Escuro, claro ou automático. |
| Fonte | Manrope, Inter ou sistema. |
| Posição do menu | Esquerda ou direita. |
| Tamanho do menu | Expandido ou compacto. |
| Tabelas | Densidade confortável ou compacta. |
| Texto | 100%, 110% ou 120%. O zoom do navegador permanece disponível. |
| Movimento | Acompanhar o dispositivo ou reduzir movimento. |
| Transparência | Preferência pessoal por reduzir transparência. |
| Página inicial | Uma página disponível para o perfil. |
| Favoritos | Até oito páginas distintas disponíveis para o perfil. |

O objeto de preferências é gravado no banco por `user_id`, obtido da sessão. A API não aceita um identificador de outra pessoa no corpo. Um objeto vazio restaura a herança de todos os campos. As escolhas acompanham o login em outro navegador; não dependem de uma chave genérica compartilhada de `localStorage`.

## Imagens e reaproveitamento

Logos, favicon e imagens de fundo usam o armazenamento R2 existente. A biblioteca retorna uma lista paginada com nome, tipo, tamanho, data e indicador de uso na configuração publicada. Enviar um arquivo disponibiliza a imagem para seleção; a alteração da identidade passa a valer quando a configuração é salva.

São aceitos PNG, JPEG e WebP de até 5 MiB. A validação existente inspeciona o formato e a estrutura do arquivo, com limite de 10.000 pixels por dimensão e 25 milhões de pixels. Arquivos SVG, HTML e tipos não permitidos são recusados. A validação estrutural não equivale a um antivírus nem a uma decodificação integral de todos os pixels.

As imagens atualmente referenciadas pela identidade publicada podem ser carregadas antes do login, para exibir a marca e a tela de entrada. Uma imagem enviada para um rascunho, ou mantida apenas no histórico, exige acesso administrativo. Retirar a imagem da configuração publicada retira essa disponibilidade pública na origem; não revoga cópias já baixadas.

A biblioteca usa as finalidades `logo` e `wallpaper`. Logos e favicon só podem referenciar imagens do tipo `logo`; papel de parede e imagem de entrada usam `wallpaper`. Reaproveitar uma imagem não exige novo upload. Não há exclusão física de arquivos nesta entrega, de modo que um histórico ainda possa referenciar suas imagens.

## Temas, rascunhos e histórico

Um tema ou rascunho nomeado guarda apenas a aparência. Não inclui dias de carência nem padrões por perfil. Salvar ou editar um deles não modifica a aparência publicada. Ao carregar um tema no editor, a prévia permite revisar as escolhas antes de salvá-las para a academia.

**Guardar prévia** permite dar um nome e escolher entre **Tema reutilizável** e **Rascunho para continuar depois**. Em Temas salvos, **Abrir na prévia** carrega as escolhas para revisão; **Salvar personalização** as aplica à academia. A edição de um tema pode alterar seu nome ou tipo. Substituir a aparência guardada pela prévia atual é uma escolha explícita.

O histórico registra snapshots completos de cada versão confirmada, autor, data, origem e campos alterados. O contador de versão também continua impedindo sobrescritas concorrentes. A restauração gera uma nova versão: não apaga versões anteriores.

**Restaurar aparência preserva as regras operacionais e os padrões por perfil atuais.** Assim, recuperar uma logo, uma cor ou uma composição antiga não muda acidentalmente o prazo usado pela recepção nem os padrões definidos para a equipe. Preferências pessoais também não são alteradas por essa restauração.

Se outra sessão salvar primeiro, a API responde com conflito HTTP 409. O cliente deve manter a edição não confirmada, informar a situação e permitir carregar a versão atual antes de tentar novamente. Não há sobrescrita forçada silenciosa.

No conflito de aparência, **Usar versão publicada** carrega o estado mais recente; **Combinar minhas edições** prepara uma nova prévia para revisão. A combinação não publica sozinha. Em Histórico, **Comparar** permite examinar as diferenças e **Restaurar aparência** pede confirmação antes de aplicar uma nova versão. Em Minhas preferências, restaurar os padrões prepara um objeto vazio; a mudança é confirmada por **Salvar minhas preferências**.

## Persistência e migração

A migração `0003_personalization.sql` acrescenta três tabelas:

| Tabela | Conteúdo |
| --- | --- |
| `user_preferences` | Preferências de uma conta, versão e data de alteração. |
| `settings_history` | Snapshot por versão da configuração da academia, autoria e origem. |
| `appearance_presets` | Temas e rascunhos nomeados, seus valores e versões. |

A migração contém apenas a criação do schema. Na primeira inicialização após a atualização, o bootstrap copia a configuração existente para o histórico de forma idempotente. A gravação de configurações também captura um predecessor ainda ausente dentro do mesmo lote transacional. Contas, senhas, arquivos e registros operacionais não são apagados nem recriados. Campos novos ausentes em uma configuração antiga recebem padrões compatíveis durante a leitura; a leitura não reescreve o registro.

Os commits revalidam conta ativa, papel, versão da conta, sessão autenticada, versão da configuração e referências de imagem aplicáveis. A alteração, o snapshot e a auditoria pertencem ao mesmo lote SQL. Um conflito ou erro no snapshot deve desfazer o lote inteiro.

## API e verificações

Os contratos detalhados estão em [API-CONTRACT.md](API-CONTRACT.md). As rotas principais são:

- `GET` e `PATCH /api/preferences` para a própria conta. A primeira gravação usa versão `0`; `PATCH` substitui o objeto completo de escolhas pessoais.
- `GET` e `PATCH /api/settings` para a configuração global.
- `GET /api/settings/history` e `POST /api/settings/history/:version/restore` para histórico e restauração.
- `GET` e `POST /api/settings/themes`, com `GET` e `PATCH /api/settings/themes/:id` para temas e rascunhos.
- `GET` e `POST /api/assets` para a biblioteca e o envio de imagens.

As novas listagens usam `page` e `pageSize`, com tamanho padrão 12 e máximo 50. Os esquemas aceitam apenas campos conhecidos. As rotas autenticadas de escrita mantêm a exigência de origem e token CSRF.

As suítes próprias estão em `tests/personalization-hardening.mjs` e `tests/personalization-flows.mjs`. A segunda aceita `--persistence` para verificar os mesmos dados depois de um reinício real. A execução HTTP exige uma base local isolada e credenciais sintéticas pelo ambiente; não deve ser apontada para os dados publicados. Consulte [VALIDACAO-PERSONALIZACAO.md](VALIDACAO-PERSONALIZACAO.md) para os resultados efetivamente observados.

Os fluxos descritos neste guia correspondem à implementação. A inspeção em navegador observou a tela de entrada; os fluxos autenticados de salvar, restaurar, navegar com rascunhos e operar em telas menores ou por teclado ainda não foram executados pela interface. A validação HTTP e a persistência após reinício foram concluídas separadamente, com os resultados registrados no relatório acima.

## Limites desta entrega

Este módulo não implementa um construtor livre de dashboards, edição arbitrária de CSS, fontes externas, conjuntos de ícones enviados pelo usuário, recorte de imagens, exclusão de arquivos históricos, importação/exportação de temas ou personalização de documentos fiscais. A personalização não altera regras financeiras, permissões de acesso nem os requisitos operacionais descritos em [PRODUCAO.md](PRODUCAO.md).
