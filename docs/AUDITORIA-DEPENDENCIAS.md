# Auditoria das dependências de produção

Consulta executada em **27 de outubro de 2026**, usando o registro público do npm e o `package-lock.json` desta aplicação.

## Resultado observado

O comando `npm audit --omit=dev --json` terminou com **saída 0 e total de 0 vulnerabilidades conhecidas** depois das atualizações. O relatório integral está em `outputs/npm-audit-production.json` no ambiente de validação. A consulta inicial foi preservada como `outputs/npm-audit-production-before.json`.

O resultado se restringe aos advisories retornados pelo npm para as dependências de produção presentes no lockfile naquela data. Não representa ausência de defeitos no código, certificação de segurança, auditoria das dependências exclusivas de desenvolvimento ou comprovação de que todas as combinações de implantação foram avaliadas.

## Pacotes corrigidos

Na consulta inicial, o npm sinalizou seis pacotes: um de severidade crítica, três de severidade alta e dois de severidade moderada. A contagem é de pacotes; um pacote pode ter mais de um advisory.

| Pacote | Relação com o projeto | Versão anterior | Versão instalada | Severidade inicial |
| --- | --- | --- | --- | --- |
| `next` | Dependência direta do starter, com compatibilidade usada pelo ecossistema Vinext | 16.3.4 | 16.4.3 | Crítica |
| `zod` | Dependência direta usada na validação dos endpoints e do protocolo local | 3.25.76 | 4.6.7 | Alta |
| `sharp` | Transitiva de Next e Miniflare; o starter já mantinha override para Miniflare | 0.35.4 | 0.35.5 | Alta |
| `source-map-js` | Transitiva de PostCSS e ferramentas de compilação | 1.2.1 | 1.2.2 | Alta |
| `fast-uri` | Transitiva de Ajv/schema-utils e resolvedores de validação | 3.1.7 | 3.1.9 | Moderada |
| `baseline-browser-mapping` | Transitiva de Next/Browserslist | 2.10.30 | 2.11.0 | Moderada |

As versões diretas foram atualizadas com `npm install` explícito, sem `npm audit fix --force`. O override existente de Miniflare foi elevado para `sharp` 0.35.5, e os outros três transitivos receberam overrides precisos compatíveis. `package.json` e `package-lock.json` foram atualizados juntos.

## Efeito no código

O projeto executa o servidor via Vinext/Workers. A busca no código da aplicação não encontrou uso de `next/og`, `next/image` ou funções `use cache` que caracterizam parte dos advisories de Next. Essa observação orientou a revisão, mas não foi usada para dispensar a atualização.

Zod participa diretamente da validação de entradas. A migração para a versão 4 exigiu declarar explicitamente o tipo das chaves em `z.record` e preservar a semântica de PATCH: campos não enviados não podem receber valores padrão que reativem contas ou alterem custos. A suíte HTTP inclui regressões para aluno inativo, usuário inativo e custo/estoque mínimo de produto. Os limites de corpo são aplicados antes da validação do schema e incluem requisições sem tamanho previamente declarado.

A atualização das dependências por si só não comprova o comportamento da aplicação. Typecheck, build e testes HTTP finais devem ser conferidos no registro [VALIDACAO-EXECUTADA.md](VALIDACAO-EXECUTADA.md).

## Repetir a consulta

Na raiz do projeto:

```powershell
npm audit --omit=dev
npm explain next zod sharp source-map-js fast-uri baseline-browser-mapping
```

Revise cada advisory e seus caminhos antes de mudar versões. Depois de uma atualização, execute `npm run test:ci` em uma base isolada e repita a consulta. Uma alteração de versão principal também exige revisar mudanças de API e comportamento.

## Fontes consultadas

- [Advisory oficial do Next para processamento de SVG](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw): versões corrigidas e relação com Sharp.
- [Advisory oficial do Next para funções `use cache`](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr): condições relevantes e versões corrigidas.
- [Advisory oficial do Sharp/librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w): correção em Sharp 0.35.5.
- [Correção oficial do Zod, PR 6652](https://github.com/colinhacks/zod/pull/6652): rejeição de coleções acima do limite antes de percorrer cada elemento.
- [Advisory de `source-map-js`](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [advisory de `fast-uri`](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) e [advisory de `baseline-browser-mapping`](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv), identificados pelo relatório npm: versões sinalizadas e descrição das falhas.
