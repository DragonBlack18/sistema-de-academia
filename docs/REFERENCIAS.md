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

O workflow usa as versões v7 documentadas nos repositórios oficiais de [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node) e [actions/upload-artifact](https://github.com/actions/upload-artifact), com Node 24 e permissões de leitura do código. As referências embasam a configuração; a execução remota ainda depende da publicação do repositório e do primeiro run de Actions.

Não foram importados projetos completos de gestão de academia. Isso evita misturar autenticações, modelos de banco e regras financeiras incompatíveis. O contrato do produto está em [API-CONTRACT.md](API-CONTRACT.md), os campos em [DOMAIN-FIELDS.md](DOMAIN-FIELDS.md) e o comportamento visual em `DESIGN.md`/`UX-CONTRACT.md`.

## Revisão de backend — 27/10/2026

As fontes técnicas adicionais e as decisões verificadas estão em [SEGURANCA-BACKEND.md](SEGURANCA-BACKEND.md), [INTEGRIDADE-BACKEND.md](INTEGRIDADE-BACKEND.md) e [PRODUCAO.md](PRODUCAO.md). As referências incluem RFC 6238 (uso único de TOTP), D1 batch/limites/migrações, OWASP autorização/REST/uploads, especificações PNG/WebP e segurança de Actions.
