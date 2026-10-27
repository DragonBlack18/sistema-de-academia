# Perfis e autorização

A versão web usa uma academia, uma unidade e um perfil principal por conta. O catálogo de permissões está em `server/auth.ts`. A tabela abaixo resume a política implementada; as verificações do servidor continuam sendo a autoridade de execução.

| Perfil | Administração de acessos | Operação | Financeiro e relatórios | Treinos e avaliações | Personalização |
| --- | --- | --- | --- | --- | --- |
| Proprietário (`super_admin`) | Todos os perfis e contas | Completa | Completo | Completo | Completa |
| Administrador (`admin`) | Cria/edita contas não administrativas; proprietários e outros administradores exigem proprietário | Completa, com exceção autorizada de acesso | Completo e auditoria | Completo | Completa |
| Gerente (`manager`) | Sem acesso ao módulo de contas | Cadastros, planos, matrículas, frequência, equipe, aulas, estoque, CRM e avisos | Completo e relatórios | Completo | Sem alteração |
| Recepção (`reception`) | Sem acesso | Alunos, matrículas, entradas/saídas, aulas e CRM; consulta planos e treinos | Sem acesso aos lançamentos financeiros | Consulta de treinos | Sem alteração |
| Financeiro (`finance`) | Sem acesso | Consulta reduzida de alunos, planos e matrículas | Cobranças, pagamentos, estornos, despesas e relatórios | Sem acesso | Sem alteração |
| Professor (`trainer`) | Sem acesso | Consulta de alunos e frequência vinculados; gerencia suas aulas | Sem acesso | Cria e altera fichas/avaliações dos alunos vinculados | Sem alteração |
| Personal (`personal`) | Sem acesso | Consulta de alunos e frequência vinculados; consulta aulas | Sem acesso | Cria e altera fichas/avaliações dos alunos vinculados | Sem alteração |

Todos os perfis autenticados podem consultar os avisos gerais ou destinados à própria conta, marcar seus avisos como lidos, trocar a própria senha, configurar seu autenticador, ajustar suas preferências pessoais e sair da sessão. A coluna Personalização da tabela descreve a **identidade compartilhada da academia**; as preferências da própria conta estão disponíveis para todos os perfis ativos.

## Personalização da academia e preferências pessoais

- Proprietário e administrador podem publicar a marca, editar padrões por perfil, salvar temas e rascunhos, consultar/restaurar o histórico de aparência e reutilizar imagens da biblioteca. As permissões continuam `settings.read` e `settings.write`.
- Qualquer conta ativa pode consultar e gravar `/api/preferences`. O servidor usa exclusivamente o identificador da sessão; o corpo não aceita escolher outro usuário.
- Preferências individuais substituem padrões do perfil apenas para a própria pessoa. Um objeto vazio remove as sobreposições e restaura a herança.
- Tema, fonte, posição e modo da navegação, densidade, escala de texto e acessibilidade não alteram autorização. Página inicial e favoritos são validados contra o catálogo de permissões do titular.
- Configurações de aparência restauradas não restauram a carência operacional nem os padrões atuais dos perfis. O histórico é preservado, e a restauração gera uma nova versão com auditoria.
- Rascunhos e temas não são publicados ao salvar. Imagens não publicadas exigem `settings.read`, mesmo quando alguém conhece o identificador do arquivo.
- As gravações revalidam sessão e autorização na mesma transação que os dados. Perder o acesso durante uma edição impede seu commit.

## Controles de segurança

- Uma conta sem permissão recebe `403` na API, mesmo se chamar a rota diretamente.
- Professores e personais só obtêm detalhes dos alunos cujo `trainer_id` corresponde à própria conta.
- As listas e opções respeitam o escopo do perfil; filtros no frontend não substituem essas regras.
- O financeiro recebe uma projeção reduzida dos dados cadastrais de alunos e não acessa avaliações físicas.
- Alterar papel, senha ou ativação invalida sessões anteriores conforme a operação.
- A conta proprietária não pode remover o próprio nível de controle ou se desativar pela mesma sessão. A API também protege o último proprietário ativo.
- Exceções de entrada exigem permissão específica e justificativa. Recepção e gerente não recebem essa exceção automaticamente.
- Descontos na matrícula exigem permissão de escrita financeira.

## Cadastro de pessoas e contas

`staff` representa o cadastro profissional. `users` representa o acesso ao sistema. Um profissional pode existir sem conta de login; quando precisar usar o sistema, crie a conta e vincule o campo correspondente. O responsável por um aluno é uma conta ativa de profissional, usada também para aplicar as restrições de acesso.

Essa versão não possui editor de papéis personalizados nem múltiplos papéis simultâneos por conta. Uma mudança dessa política deve atualizar a matriz de autorização, os filtros de dados e os testes em conjunto.
