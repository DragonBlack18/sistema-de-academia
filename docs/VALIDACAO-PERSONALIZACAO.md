# Evidências — personalização

Data de referência: **27 de outubro de 2026**. Horários apresentados em **America/Sao_Paulo**.

Esta rodada amplia a personalização e seus componentes consumidores. As suítes usam dados sintéticos em SQLite/D1 isolado e, na integração HTTP, o Worker compilado com R2 local. Os dados publicados não são usados como base de teste.

## Resultados observados

| Verificação | Resultado observado | Evidência |
| --- | --- | --- |
| Sintaxe da nova suíte HTTP | PASS | `node --check tests/personalization-flows.mjs`. |
| ESLint das novas suítes e adaptadores alterados | PASS, sem erros/avisos | Execução direta sobre `personalization-flows.mjs`, `personalization-hardening.mjs`, `domain-hardening.mjs` e `operations-hardening.mjs`. |
| Invariantes determinísticos de personalização e corridas do cliente HTTP | **PASS — 29 gates, 0 falhas** | `outputs/personalization-hardening-report.json`, concluído às 15:06:46. Inclui a correção de contraste e os controles de respostas de sessões anteriores. |
| Matriz numérica de contraste dos tokens | **PASS — 3.380 pares medidos** | Está incluída nos 29 gates, não é somada como uma suíte adicional. |
| Integração HTTP de personalização | **PASS — 14 gates, 197 verificações contabilizadas** | `outputs/personalization-flows-report.json`, execução de 15:07:13 a 15:07:17. |
| Personalização após reinício real | **PASS — 10 gates, 18 verificações contabilizadas** | `outputs/personalization-restart-report.json`, execução de 15:07:19 a 15:07:21. |
| Regressão determinística de domínio | **PASS — 28 gates** | `outputs/domain-hardening-report.json`; adaptador atualizado para compilar o contrato compartilhado. |
| Regressão determinística de operação | **PASS — 8 gates** | `outputs/operations-hardening-report.json`; o mesmo adaptador preserva as verificações anteriores. |
| Pipeline local integrado, tipos, lint, migrações e reinicialização | **PASS** | `outputs/ci-report.json`, de 15:06:18 a 15:07:21; estágio final `restart`, sem falha de encerramento do Worker. |
| Renderização da tela de entrada em navegador | **Observada — inspeção visual parcial** | Prévia oficial local `http://terminal.local:4173/`; marca, mensagem da marca, textos e campos de entrada renderizados. |
| Fluxos autenticados da interface em navegador | **Não executados** | O mecanismo de autenticação do navegador retornou `locator_invalid`, inclusive após reinspeção e correção da seleção dos campos. Ver limites abaixo. |

As três suítes de personalização somam **53 gates aprovados, sem falhas**. As 197 verificações HTTP, as 18 verificações de persistência e os 3.380 pares de contraste estão contidos nesses gates; não são somados novamente como suítes separadas.

O mesmo pipeline repetiu com aprovação as verificações anteriores de integração, financeiro, fluxos de backend, segurança, domínio e operação, incluindo a releitura dos 18 módulos após reinício. Os relatórios são gerados em `outputs/` e disponibilizados como artefatos do CI; não incluem o banco de teste nem credenciais. Um relatório ausente ou marcado `NOT_RUN` não constitui aprovação.

## Escopo dos 29 gates determinísticos

A suíte usa SQLite real com o comportamento transacional de `D1Database.batch`. Hooks controlados simulam uma alteração já confirmada entre a leitura e o commit, permitindo testar condições que uma execução sequencial comum não reproduz.

- Migração apenas de schema, preservando exatamente configuração, senha e imagem antigas; bootstrap copia o snapshot inicial e a primeira gravação mantém esse predecessor intacto.
- Leitura compatível de configurações legadas e preferências novas sem escrever valores artificiais no banco.
- Duas primeiras gravações concorrentes de preferências: uma vencedora e uma recusa por conflito, sem duplicar auditoria.
- Substituição completa, restauração da herança, isolamento de contas e rejeição de versão antiga.
- Conta desativada, papel alterado ou sessão revogada entre leitura e commit impedem a alteração.
- Página inicial e favoritos não podem incluir páginas proibidas para o perfil. Campos extras, seletores de outra conta, tipos incorretos e valores fora da lista permitida são recusados.
- Valores armazenados inválidos falham de forma fechada, sem aplicar configuração parcial.
- Gravações globais concorrentes geram apenas um novo snapshot. Uma falha forçada na gravação do histórico desfaz a configuração e a auditoria juntas.
- Imagem removida entre validação e commit impede publicar uma referência quebrada. Todos os seis campos de imagem verificam a finalidade correta do arquivo.
- Restauração cria uma nova versão e preserva os dias de carência e padrões de perfil atuais. Um conflito posterior à leitura também impede a restauração.
- Histórico tem permissão, paginação e diferenças de campos verificadas.
- Temas e rascunhos são persistidos sem publicar a aparência; edição concorrente, perda de permissão, imagem indisponível e corrupção armazenada são cobertas.
- Uma resposta 401 antiga não encerra uma sessão mais recente. Uma resposta antiga de `/me` não repõe o CSRF anterior. Cancelar uma requisição enquanto o JSON está chegando impede a aplicação de seus dados; o tratamento normal de uma sessão atual continua funcionando.
- Preferências seguem a precedência academia → perfil → pessoa sem modificar os objetos de origem.
- Vetores conhecidos de luminância, tema automático, fonte, escala e cantos são verificados.

O maior lote observado usou **17 parâmetros na mesma consulta**, abaixo do limite de 100 controlado pelo teste. Isso descreve os cenários executados, não todos os tamanhos de entrada imagináveis.

## Contraste e correção encontrada

A matriz cobre os modos claro e escuro, 13 cores de destaque e cinco cores extremas de fundo. Mede texto principal, texto secundário e destaque visível sobre seis superfícies, texto de botões, quatro pares de estados semânticos e bordas de controles. Os limiares são avaliados numericamente, sem arredondar uma razão inferior para aprovação.

Na primeira execução, o texto secundário claro `#4e6053` sobre um fundo resultante próximo de `#cfd0cf` atingiu aproximadamente **4,35:1** e foi reprovado. A cor passou a `#455449`; a repetição aprovou todos os pares testados. O teste também inclui o destaque intermediário `#777777`, para impedir que a escolha do texto do botão dependa apenas de uma estimativa visual de brilho.

Essa matriz verifica os tokens calculados. Ela não substitui inspeção da página renderizada, teste de teclado, leitor de tela, zoom ou avaliação completa de conformidade WCAG.

## Integração HTTP e reinicialização

A suíte de integração executou **14 gates** que abrangem sete identidades reais, controles de acesso, isolamento das preferências, escrita concorrente, CSRF, origem, padrões de perfil, biblioteca de imagens, rascunhos, temas, restauração, limites e snapshots para reinício. O modo de persistência aprovou **10 gates**: configuração/histórico, temas/rascunhos, imagens R2 e preferências dos sete perfis.

Os cenários HTTP não simulam respostas da aplicação. São requisições reais ao Worker local compilado. Ao terminar a fase de gravação, a suíte restaura a configuração global que encontrou, preservando a compatibilidade com os snapshots das suítes anteriores. As contas e imagens sintéticas pertencem exclusivamente à base isolada dessa execução.

Para a etapa de persistência, o primeiro processo foi encerrado normalmente e outro processo abriu os mesmos arquivos isolados. Foram confirmados o conteúdo integral das configurações, os snapshots históricos, os temas e rascunhos com suas versões, as imagens em R2 e a privacidade das imagens não publicadas. As sete contas receberam exatamente as preferências salvas antes da parada.

O arquivo de estado contém identificadores e valores esperados. Senhas de fixtures são derivadas em memória a partir do segredo efêmero do CI; não são incluídas nesse estado, nos relatórios nem no código público. Cookies e tokens CSRF também não são escritos nos snapshots.

## Inspeção da interface em navegador

O executor principal abriu a prévia oficial local em `http://terminal.local:4173/` e observou a tela de entrada renderizada, incluindo marca, mensagem da marca, textos de apresentação e campos de acesso. Essa observação confirma a renderização daquela tela no ambiente de prévia; não demonstra que os fluxos do editor autenticado foram exercitados pela interface.

A inspeção autenticada **não foi executada**. O mecanismo `browserAuth` retornou `locator_invalid` mesmo após uma reinspeção da página e a correção da seleção dos campos. Não houve preenchimento manual de credenciais nem contorno do mecanismo de autenticação. Essa falha da automação não foi tratada como reprovação do login da aplicação; o login e as autorizações continuaram cobertos separadamente pelas suítes HTTP.

Permanecem pendentes de verificação em navegador:

- Usar Voltar/Avançar com alterações não salvas e conferir a confirmação, a preservação do rascunho e o destino após cada escolha.
- Salvar preferências e personalização pelo formulário, aplicar temas, resolver conflitos e restaurar uma versão pelo histórico, acompanhando o resultado visual.
- Verificar a responsividade real em larguras menores, a navegação por teclado, o foco dos diálogos e o comportamento dos controles abertos.

Os resultados HTTP, de reinicialização e de contraste numérico não substituem essas verificações da interface. Alterações posteriores no componente principal devem passar por tipos, lint e build novamente; aprovação nessas etapas não deve ser registrada como uma inspeção visual autenticada.

## Limites da conclusão

Uma contagem de gates não é porcentagem de cobertura de linhas nem prova de ausência de defeitos. A aprovação de tokens de contraste não certifica toda a interface. As verificações não equivalem a auditoria independente de segurança, teste de carga ou homologação operacional da academia. Permanecem aplicáveis as condições de implantação e operação de [PRODUCAO.md](PRODUCAO.md).

As fontes técnicas e a finalidade de cada uma estão em [REFERENCIAS.md](REFERENCIAS.md). A implementação e os fluxos previstos estão documentados em [PERSONALIZACAO.md](PERSONALIZACAO.md); a distinção entre código implementado e interação observada segue as evidências desta página.
