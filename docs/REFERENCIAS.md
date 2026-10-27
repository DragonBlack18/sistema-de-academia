# Referências de implementação

Consultadas em 27 de outubro de 2026. Este documento registra por que cada referência foi usada. A implementação do produto e suas regras estão nos arquivos do projeto; uma referência não equivale a um teste aprovado.

## Segurança e dados

| Fonte primária | Aplicação no Vitality Gym |
| --- | --- |
| [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Hash de senha com scrypt, sal aleatório e comparação de tempo constante. A configuração escolhida é N=32768, r=8, p=3. Senhas nunca são guardadas em texto puro no banco. |
| [Cloudflare Workers — node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) | Verificar compatibilidade do scrypt e demais operações criptográficas com o runtime Worker usado pelo backend. |
| [OWASP — Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) | Cookie HttpOnly, SameSite, Secure em HTTPS; token opaco; expiração e revogação server-side. |
| [OWASP — CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) | Validar a origem e exigir token CSRF nas alterações autenticadas. SameSite é uma camada adicional. |
| [OWASP — Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Permissões no servidor e restrição de personal/professor aos alunos vinculados. |
| [OWASP — File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Limites de tamanho, tipos permitidos, inspeção dos bytes e armazenamento separado de mídia. |
| [OWASP — CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) | Neutralização de células que poderiam ser interpretadas como fórmulas nas exportações CSV. |
| [Cloudflare — D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | Consultas parametrizadas e lotes SQL transacionais para operações correlacionadas. |
| [Cloudflare — D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) | Mudanças de esquema versionadas e aplicação somente das migrações ainda pendentes. |
| [Cloudflare — D1 CLI](https://developers.cloudflare.com/d1/wrangler-commands/) | Setup local via `d1 migrations apply`, com registro das migrações e comportamento documentado de rollback. |
| [Cloudflare — importação/exportação D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/) | Procedimentos de exportação SQL e restauração; não substituem o backup das imagens no R2. |
| [Cloudflare — variáveis locais](https://developers.cloudflare.com/workers/local-development/environment-variables/) | `.dev.vars` somente no ambiente local. Segredos não entram no bundle nem no Git. |
| [Drizzle — D1](https://orm.drizzle.team/docs/get-started/d1-new) e [migrações](https://orm.drizzle.team/docs/migrations) | Modelo tipado de tabelas e geração de SQL versionado. |

## Interface e experiência

| Fonte primária | Aplicação no Vitality Gym |
| --- | --- |
| [shadcn/ui — dashboard blocks](https://ui.shadcn.com/blocks?category=dashboard) | Referência de hierarquia entre navegação, indicadores, gráficos e tabelas. A identidade visual foi adaptada para a academia. |
| [shadcn/ui — sidebar](https://ui.shadcn.com/blocks/sidebar) | Organização da navegação por grupos de tarefas e comportamento em telas menores. |
| [shadcn/ui — login](https://ui.shadcn.com/blocks/login) | Formulário concentrado, foco no acesso e tratamento discreto da imagem de demonstração. |
| [Radix — Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) | Referência de comportamento de foco, Escape, título acessível e fechamento após uma operação assíncrona confirmada. |
| [Radix — acessibilidade](https://www.radix-ui.com/primitives/docs/overview/accessibility) | Controles navegáveis por teclado, nomes acessíveis e padrões de interação. |
| [Recharts](https://recharts.github.io/) | Gráficos React/SVG baseados nos agregados reais retornados pela API. |
| [Recharts — AreaChart](https://recharts.github.io/en-US/api/AreaChart/) | Tooltip, eixos, responsividade e camada de acessibilidade nos indicadores históricos. |
| [Lucide](https://lucide.dev/guide/packages/lucide-react) | Ícones consistentes e substituição por identificadores de uma lista permitida, sem executar código enviado pelo usuário. |
| [WAI — padrões de diálogo](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Semântica de modal, navegação por teclado e restauração de foco. |

## Referências de domínio e repositórios

- [wger](https://github.com/wger-project/wger): referência para a separação entre catálogo de exercícios, fichas, prescrições e histórico. O projeto usa AGPL-3.0; código, traduções, imagens e base de exercícios do wger **não foram copiados** para esta aplicação.
- [shadcn/ui](https://github.com/shadcn-ui/ui): padrões de componentes e exemplos de organização visual. Dependências efetivamente utilizadas continuam sujeitas às licenças próprias.
- [Recharts](https://github.com/recharts/recharts): biblioteca de visualização utilizada pelo frontend.
- [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm): modelagem e geração de migrações.
- [Vinext](https://github.com/cloudflare/vinext): compatibilidade de estrutura React/Next com o ambiente Vite/Workers fornecido para hospedagem.

## Automação de validação

O workflow usa as versões v7 documentadas nos repositórios oficiais de [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node) e [actions/upload-artifact](https://github.com/actions/upload-artifact), com Node 24 e permissões de leitura do código. Os resultados efetivamente observados ficam em [VALIDACAO-EXECUTADA.md](VALIDACAO-EXECUTADA.md) e na aba Actions do repositório.

O [Miniflare oficial](https://developers.cloudflare.com/workers/testing/miniflare/get-started/) executa o Worker compilado no CI, preservando os bindings e a persistência do ambiente isolado. Os relatos [workers-sdk #15709](https://github.com/cloudflare/workers-sdk/issues/15709) e [#14641](https://github.com/cloudflare/workers-sdk/issues/14641), junto à inspeção do código da versão instalada, orientaram a retirada do proxy de desenvolvimento do harness; os testes de corpo excessivo e origem continuam presentes e sem repetição automática.

Não foram importados projetos completos de gestão de academia. Isso evita misturar autenticações, modelos de banco e regras financeiras incompatíveis. O contrato do produto está em [API-CONTRACT.md](API-CONTRACT.md), os campos em [DOMAIN-FIELDS.md](DOMAIN-FIELDS.md) e o comportamento visual em `DESIGN.md`/`UX-CONTRACT.md`.

## Revisão de backend — 27/10/2026

As fontes técnicas adicionais e as decisões verificadas estão em [SEGURANCA-BACKEND.md](SEGURANCA-BACKEND.md), [INTEGRIDADE-BACKEND.md](INTEGRIDADE-BACKEND.md) e [PRODUCAO.md](PRODUCAO.md). As referências incluem RFC 6238 (uso único de TOTP), D1 batch/limites/migrações, OWASP autorização/REST/uploads, especificações PNG/WebP e segurança de Actions.

## Personalização — 27/10/2026

| Fonte primária | Decisão de implementação e limite da evidência |
| --- | --- |
| [W3C — contraste mínimo, WCAG 2.2, 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Cálculo de luminância relativa e contraste para o texto sobre cores personalizadas. A referência distingue texto comum (4,5:1), texto grande (3:1) e exceções. Medir pares de tokens não certifica a acessibilidade de toda a interface. |
| [W3C — contraste de componentes e gráficos, 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | Controles, estados e indicadores visuais necessários precisam ser identificáveis contra as cores adjacentes. O limiar aplicável de 3:1 é tratado sem arredondar um resultado inferior para aprovação. |
| [MDN — prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) | Tema automático acompanha a preferência clara/escura informada pelo dispositivo. Uma preferência explícita salva na conta pode substituir o padrão da academia. |
| [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) | Respeitar a preferência do dispositivo por menos movimento e permitir a escolha pessoal correspondente. |
| [Cloudflare — D1Database.batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) | Gravar a configuração, sua versão, o histórico e a auditoria no mesmo lote transacional. Asserções SQL devem falhar antes de um conflito de versão produzir alterações parciais. |
| [Cloudflare — migrações D1](https://developers.cloudflare.com/d1/reference/migrations/) | Acrescentar tabelas de personalização sem apagar contas, imagens nem configurações anteriores. |
| [OWASP — autorização](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Preferências vinculadas à identidade autenticada; escrita da identidade da academia continua protegida por permissão no servidor. Ocultar um botão não substitui essa autorização. |

O escopo entregue e as verificações efetivamente executadas ficam em [PERSONALIZACAO.md](PERSONALIZACAO.md) e [VALIDACAO-PERSONALIZACAO.md](VALIDACAO-PERSONALIZACAO.md).
