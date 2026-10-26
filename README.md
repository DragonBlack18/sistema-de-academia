# Vitality Gym

Sistema Web de gestão de academia — Next.js/React/TypeScript, FastAPI/SQLAlchemy e PostgreSQL.

## Estado do repositório

Repositório privado inicializado para receber a consolidação do código existente e a evolução funcional. Esta revisão inicial não é uma versão operacional do sistema.

O trabalho de implementação inclui sessões Web revogáveis, proteção CSRF, revisão de autorização, equipamentos/manutenção, auditoria de alterações, gráficos baseados em dados reais e consolidação da navegação. A versão Web precede o Electron.

## Regras de segurança e entrega

- Não versionar `.env`, cookies, tokens, senhas, dumps de banco, dados reais ou relatórios contendo dados pessoais.
- Nenhum procedimento de atualização pode apagar o volume operacional ou recriar seu banco.
- Testes destrutivos de esquema executam apenas em banco de teste explicitamente autorizado.
- Resultado de teste local, resultado em PostgreSQL, build e E2E devem ser relatados separadamente.
- Nenhuma afirmação de segurança absoluta ou de homologação sem evidência.

A implementação completa será proposta em uma branch própria, preservando esta referência inicial.
