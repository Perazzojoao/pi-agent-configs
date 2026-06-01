# pi-agents

`pi-agents` transforma o agente principal do Pi em um **dispatcher**: ele deixa de acessar o código diretamente e passa a coordenar agentes especialistas por meio da tool `dispatch_agent`.

A extensão foi desenhada para dividir trabalho entre especialistas, preservar sessões por instância, controlar concorrência, evitar escritas conflitantes e expor um painel de status no TUI.

## Visão geral

Ao ativar a extensão:

- o agente principal recebe um prompt de sistema de dispatcher;
- as tools de código do agente principal são removidas;
- a tool `dispatch_agent` é registrada;
- agentes especialistas são carregados a partir de arquivos Markdown (`.md`) e configurados por `agents.yaml`;
- cada especialista pode executar em até três instâncias locais, mas todas contam para um limite global de paralelismo;
- tarefas de escrita exigem declaração explícita de recursos (`files` e/ou `worktree`);
- escritas concorrentes sem `worktree` explícita são isoladas em worktrees Git automáticas antes do cálculo final de locks;
- um widget mostra o estado dos especialistas, contexto e tarefas em andamento.

## Instalação e ativação

A extensão fica em uma pasta com `index.ts`:

```text
agent/extensions/pi-agents/index.ts
agent/extensions/pi-agents/src/extension.ts
agent/extensions/pi-agents/core.ts
```

Ative com o caminho da extensão:

```bash
pi -e agent/extensions/pi-agents
```

Ou, se estiver executando a partir de um diretório onde `extensions/pi-agents` é resolvido pelo Pi:

```bash
pi -e extensions/pi-agents
```

A extensão não precisa de um arquivo `agent-teams.ts` e este README não depende dele.

## Estrutura de arquivos

```text
agent/extensions/pi-agents/
├── index.ts          # entrypoint fino que reexporta src/extension.ts
├── core.ts           # reexports compatíveis dos helpers em src/
├── src/
│   ├── extension.ts  # extensão Pi, dispatcher, tool, UI, locks, worktrees e sessões
│   ├── core.ts       # barrel interno dos helpers testáveis
│   ├── types.ts      # tipos compartilhados
│   ├── yaml.ts       # parser de agents.yaml e normalização de tools
│   ├── git-status.ts # parser/status Git e escopo de mudanças
│   └── paths.ts      # paths, locks/resources, validação e planos de worktree
├── package.json      # scripts/dependências locais da extensão
├── test/
│   ├── yaml.test.ts
│   ├── git-status.test.ts
│   ├── paths-resources.test.ts
│   └── worktrees.test.ts
└── README.md         # esta documentação

agent/agents/
└── agents.yaml       # catálogo embutido atual deste repositório, com lista e overrides dos especialistas
```

Durante a execução, a extensão usa diretórios no projeto e, para worktrees automáticas, ao lado do projeto:

```text
.pi/agent-sessions/          # sessões JSON dos especialistas
../worktrees/                # worktrees automáticas para escritas concorrentes (fora do repo)
.pi/agents/agents.yaml       # configuração de agentes do projeto, se existir
.pi/agents/**/*.md           # definições Markdown de agentes no projeto
```

`agent/agents/agents.yaml` é o arquivo atual deste repositório/catálogo embutido. Em runtime, a extensão não carrega esse caminho diretamente: ela procura primeiro `.pi/agents/agents.yaml` no projeto e, se não existir, usa o catálogo global em `<ctx.agentDir>/agents/agents.yaml` ou, sem `ctx.agentDir`, `~/.pi/agent/agents/agents.yaml`.

## Descoberta de agentes `.md`

A extensão procura definições Markdown recursivamente nestes diretórios, nesta ordem:

1. `agents/`
2. `.claude/agents/`
3. `.pi/agents/`
4. diretório global de agentes do Pi (`ctx.agentDir/agents` ou `~/.pi/agent/agents`)

Cada arquivo deve ter frontmatter YAML simples:

```md
---
name: scout
description: Explora o código e responde perguntas sobre a base.
tools: read,grep,find,ls
---
Prompt de sistema completo do agente especialista.
```

Campos usados do frontmatter:

- `name` — obrigatório; é o identificador usado em `dispatch_agent.agent`.
- `description` — texto exibido no catálogo do dispatcher e no widget.
- `tools` — fallback de tools do especialista quando `agents.yaml` não define override.
- corpo Markdown — usado como prompt de sistema adicional do especialista.

Se dois arquivos definirem o mesmo `name` sem diferenciar maiúsculas/minúsculas, o primeiro encontrado vence.

## Como `agents.yaml` complementa o frontmatter

O Markdown define o agente e seu prompt. O `agents.yaml` define quais agentes ficam ativos e pode sobrescrever parâmetros operacionais como modelo, esforço, tools e limite de contexto.

A extensão procura primeiro por:

```text
.pi/agents/agents.yaml
```

Se não existir, usa o arquivo global:

```text
<ctx.agentDir>/agents/agents.yaml
# ou, sem ctx.agentDir:
~/.pi/agent/agents/agents.yaml
```

Se nenhum `agents.yaml` existir, ou se o arquivo existir mas não produzir nenhuma entrada em `agents:`, todos os agentes `.md` descobertos são expostos. Se `agents.yaml` produzir uma lista de nomes, somente esses nomes são considerados: cada nome precisa corresponder a um `.md` descoberto via frontmatter `name`. Nomes listados sem definição Markdown correspondente geram aviso e são ignorados; eles não fazem a extensão expor todos os agentes automaticamente.

## Schema de `agents.yaml`

O parser espera um objeto no topo com a chave `agents`, contendo uma lista. Cada item da lista pode ser um nome simples, um nome com campos, ou um nome cujo valor escalar é tratado como `model`.

Schema lógico:

```yaml
agents:
  - <name>:
    model: <string>          # opcional
    effort: <string>         # opcional
    tools: <string|string[]> # opcional
    max_ctx: <number>        # opcional, em milhares de tokens
```

Campos e defaults atuais:

- `name` — obrigatório em cada item. Deve corresponder, sem diferenciar maiúsculas/minúsculas, ao `name` de um arquivo `.md` descoberto.
- `model` — modelo usado pelo subprocesso `pi` do especialista. Default: modelo atual do Pi (`ctx.model.provider/ctx.model.id`) ou, se indisponível, fallback `openai-codex/gpt-5.5`.
- `effort` — valor passado para `--thinking`. Default: `off`.
- `tools` — tools permitidas ao especialista. Aceita string separada por vírgulas, array inline (`[read, grep]`) ou lista YAML aninhada. Default em ordem de precedência: valor de `agents.yaml` > `tools` do frontmatter Markdown > `read,grep,find,ls`.
- `max_ctx` — limite de contexto em milhares de tokens. Default: `100` (100k tokens).

Formatos aceitos:

Lista simples, ativando agentes pelos nomes dos `.md` e usando defaults/frontmatter:

```yaml
agents:
  - scout
  - planner
```

Valor escalar como `model`:

```yaml
agents:
  - scout: openai-codex/gpt-5.5
```

Campos explícitos com `tools` como string:

```yaml
agents:
  - scout:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,grep,find,ls
    max_ctx: 150
```

`tools` como array inline:

```yaml
agents:
  - builder:
    model: openai-codex/gpt-5.5
    tools: [read, write, edit, bash, grep, find, ls]
```

`tools` como lista YAML aninhada:

```yaml
agents:
  - planner:
    effort: high
    tools:
      - read
      - grep
      - find
      - ls
    max_ctx: 100
```

O arquivo atual em `agent/agents/agents.yaml` lista estes especialistas com overrides explícitos:

```yaml
agents:
  - scout:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,grep,find,ls
    max_ctx: 150
  - planner:
    model: openai-codex/gpt-5.5
    effort: high
    tools: read,grep,find,ls
    max_ctx: 100
  - builder:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,write,edit,bash,grep,find,ls
    max_ctx: 100
  - reviewer:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,bash,grep,find,ls
    max_ctx: 100
  - documenter:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,write,edit,grep,find,ls
    max_ctx: 100
  - red-team:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,bash,grep,find,ls
    max_ctx: 100
  - bowser:
    model: openai-codex/gpt-5.5
    effort: off
    tools: read,bash,grep,find,ls
    max_ctx: 100
```

## Dispatcher e restrição de tools

No evento `session_start`, a extensão substitui as tools ativas do agente principal por uma lista mínima:

- `dispatch_agent` sempre fica ativa;
- `tilldone` é preservada se já estiver ativa;
- `sudo_exec` é preservada se já estiver ativa;
- `ask_user_question` é preservada/ativada se existir, apenas para esclarecimentos ao usuário;
- `cwd` é preservada/ativada se existir, apenas para consultar ou alterar diretório.

O dispatcher não deve ler, escrever, buscar nem executar código diretamente. Ele deve decompor o pedido do usuário e delegar trabalho aos especialistas com `dispatch_agent`.

Cada especialista é executado em um subprocesso:

```bash
pi --mode json -p --no-extensions --model <model> --tools <tools> --thinking <effort> --append-system-prompt <prompt> --session <session>
```

Isso garante que a restrição de tools do dispatcher não impeça especialistas de usar as tools declaradas para eles.

## Tool `dispatch_agent`

### Parâmetros

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `agent` | string | sim | Nome do agente, sem diferenciar maiúsculas/minúsculas. Deve existir no catálogo ativo. |
| `task` | string | sim | Instrução objetiva para o especialista. |
| `files` | string[] | não | Arquivos ou diretórios relativos ao checkout efetivo que a tarefa vai ler/escrever. Caminhos absolutos ou que escapem do checkout (`..`) são rejeitados. Obrigatório para `mode: "write"` se `worktree` não for informado. |
| `mode` | `"read"` ou `"write"` | não | Modo de acesso aos recursos declarados. Default: `"read"`. |
| `worktree` | string | não | Escopo/worktree explícito para a tarefa. Deve apontar para a raiz de um checkout Git existente, válido e pertencente ao mesmo repositório do `cwd` base (mesmo `git-common-dir`). Também entra no sistema de locks. |

### Exemplos

Exploração somente leitura:

```json
{
  "agent": "scout",
  "task": "Mapeie como a extensão pi-agents carrega agentes e resuma os pontos de entrada.",
  "files": ["agent/extensions/pi-agents"],
  "mode": "read"
}
```

Planejamento:

```json
{
  "agent": "planner",
  "task": "Crie um plano de implementação para adicionar testes da extensão pi-agents.",
  "files": ["agent/extensions/pi-agents", "test"],
  "mode": "read"
}
```

Escrita com arquivos declarados:

```json
{
  "agent": "builder",
  "task": "Atualize a documentação da extensão com uma seção de troubleshooting.",
  "files": ["agent/extensions/pi-agents/README.md"],
  "mode": "write"
}
```

Escrita em worktree explícita:

```json
{
  "agent": "builder",
  "task": "Implemente a alteração nesta worktree isolada e reporte o diff.",
  "mode": "write",
  "worktree": "../minha-worktree",
  "files": ["agent/extensions/pi-agents/index.ts"]
}
```

## Paralelismo

A constante `MAX_PARALLEL_DISPATCHES` limita a execução a **3 tarefas simultâneas no total**, somando todos os especialistas e instâncias.

Além disso:

- cada especialista possui três instâncias locais (`#1`, `#2`, `#3`);
- uma instância em execução não recebe nova tarefa;
- uma instância marcada por excesso de contexto é evitada até ser arquivada/reiniciada;
- se o limite global já foi atingido, `dispatch_agent` recusa a nova chamada.

## Locks de recursos

`dispatch_agent` cria locks determinísticos em memória para recursos efetivos. O checkout base é primeiro canonicalizado para a raiz Git real (`git rev-parse --show-toplevel` + `realpath`), então `ctx.cwd` em subdiretório ou via symlink não cria escopos de lock diferentes:

- cada item de `files` vira `file:<caminho absoluto no runCwd>`;
- escritas no checkout base recebem `checkout:<raiz-git-real>` para impedir duas edições simultâneas mesmo se chamadas partirem de subdiretórios/symlinks;
- escritas em worktree explícita/automática recebem `checkout:<runCwd-real>`;
- `worktree` explícita vira `worktree:<runCwd>`.

Regras:

- `read` pode compartilhar lock com outros `read` no mesmo recurso;
- `write` é exclusivo;
- `read` é bloqueado se já houver `write` ativo no recurso;
- `write` é bloqueado se já houver qualquer lock ativo no recurso.

Para `mode: "write"`, a chamada é recusada se nenhum `files` nem `worktree` for declarado.

Ao final de uma escrita, a extensão compara o status Git antes/depois. Avisos de mudanças fora de escopo dependem de `files` declarados: se houver arquivos/diretórios em `files`, mudanças fora deles retornam aviso; com apenas `worktree` e sem `files`, não há validação granular de arquivos.

## Worktrees automáticas para escritas concorrentes

Quando uma tarefa `write` começa enquanto qualquer outra escrita já está em execução e nenhum `worktree` explícito foi informado, a extensão decide o isolamento antes dos locks finais e tenta criar uma worktree automática. Assim, duas escritas concorrentes no mesmo arquivo não são recusadas apenas por compartilharem o checkout base: a segunda execução roda em outro checkout e seus locks são calculados contra esse `runCwd` efetivo.

A worktree automática fica em:

```text
../worktrees/<branch-atual-sanitizado>/<agent>-<instância>/
```

Ela é criada fora da raiz do repositório (como diretório irmão sob `../worktrees`) para evitar que worktrees automáticas fiquem dentro do checkout principal ou de seus filhos.

O branch criado segue o padrão:

```text
<branch-atual-sanitizado>/<agent>-<instância>
```

O slug do branch atual é sanitizado para uso em path/branch temporário: espaços e caracteres inválidos viram `-`, barras são convertidas para `-`, e o resultado é normalizado para minúsculas. Por exemplo, `feat/sub-agents` vira `feat-sub-agents`.

Fluxo em caso de sucesso:

1. cria a worktree a partir de `HEAD`;
2. executa o especialista dentro dela;
3. verifica se houve mudanças;
4. se `files` foi declarado, valida se as mudanças ficaram dentro desses arquivos/diretórios;
5. exige que o repositório base esteja limpo antes do merge;
6. faz `git add -A` e `git commit` na worktree;
7. faz merge `--no-ff` no repositório base;
8. remove a worktree e deleta o branch temporário.

A worktree é preservada para inspeção quando:

- a execução do especialista falha;
- `git status` falha;
- `files` foi declarado e há mudanças fora desses arquivos/diretórios;
- o repositório base não está limpo;
- `git add`, `git commit` ou `git merge` falham;
- ocorre conflito de merge. Nesse caso, a extensão tenta `git merge --abort` no checkout base e, se o abort for seguro, cria uma worktree/branch de resolução preservável em `../worktrees/merge-resolution/<branch-resolução-sanitizado>/` para tentar resolver determinística e automaticamente com `pi`. Se a resolução e o merge final funcionarem, as worktrees automáticas são limpas; se qualquer etapa falhar, a worktree/branch original e a de resolução (quando criada) são preservadas e reportadas.

Antes de qualquer operação que altere o checkout base ou metadados compartilhados (`merge`, `merge --abort`, remoção de worktree ou deleção de branch), a extensão tenta adquirir lock exclusivo `checkout:<base>`. Se houver writer ativo no checkout base, a worktree/branch automática é preservada e o merge/cleanup é recusado de forma estruturada.

O resolver automático de conflitos roda sem tool `bash`; recebe arquivos e saída de merge como JSON delimitado e tratado como dado não confiável. Antes de `git add -A`/commit/merge, revalida o escopo das mudanças contra os arquivos declarados ou conflitantes. Mudanças fora de escopo fazem a resolução ser abortada/preservada para inspeção.

Se a worktree não produzir mudanças, ela é limpa automaticamente apenas quando o lock do checkout base é adquirido e `git worktree remove` + `git branch -D` têm sucesso. Se `git worktree remove --force` falhar, a extensão não deleta a branch; falha parcial é reportada e preservada para inspeção.

## Sessões por instância e limpeza

Cada instância de especialista usa uma sessão JSON própria:

```text
.pi/agent-sessions/<agent>-<instância>.json
```

No `session_start`, a extensão remove arquivos `.json` antigos em `.pi/agent-sessions/` para iniciar uma sessão nova para os subagentes.

Durante a sessão atual:

- quando uma execução termina com sucesso, a sessão da instância é preservada;
- a próxima chamada para a mesma instância usa `-c` para continuar a sessão;
- cada instância mantém seu próprio histórico.

## Controle de `max_ctx`

`max_ctx` é interpretado em milhares de tokens. Por exemplo:

```yaml
max_ctx: 100
```

corresponde a 100.000 tokens.

A extensão calcula o percentual usando `usage.input / (max_ctx * 1000)`. Se o uso passar de 100%:

- a instância é marcada como `needsCompaction`;
- o dispatcher recebe um aviso de contexto;
- a sessão não é retomada na próxima reutilização;
- antes de reutilizar a instância, se o arquivo de sessão ainda existir, ele é renomeado para `*.over-max-ctx.<timestamp>.json`;
- se a sessão excedida não existir mais, o estado da instância é limpo sem arquivamento;
- a próxima tarefa começa com sessão fresca e uma nota pedindo resumo conciso do contexto anterior.

A reutilização só é recusada quando ocorre erro ao arquivar/renomear a sessão excedida, para evitar continuar um histórico acima do limite.

## UI, widget e status

A extensão registra:

- widget `pi-agents`, com cards por especialista;
- status `pi-agents`, com quantidade de especialistas e tarefas em execução;
- footer customizado com modelo atual, número de especialistas, tarefas globais em execução e barra de contexto do dispatcher;
- notificações quando especialistas terminam com sucesso ou erro.

Cada card mostra:

- nome do especialista;
- estado (`idle`, `running`, `done`, `error`);
- execuções locais e globais (`N/3 global`);
- tempo decorrido;
- uso de contexto em relação a `max_ctx`;
- última tarefa ou último trecho de trabalho recebido.

## Testes

Testes da extensão ficam em `agent/extensions/pi-agents/test/`, divididos por responsabilidade (`yaml`, `git-status`, `paths/resources`, `worktrees`). O `package.json` local expõe o script `npm test`, que executa `tsx --test test/*.test.ts` a partir da pasta da extensão.

Sugestões de cobertura:

- parser de `agents.yaml` em `src/yaml.ts`;
- normalização de `tools`;
- detecção de mudanças fora de escopo;
- locks de recursos para `read`/`write`;
- comportamento de `dispatch_agent` quando faltam recursos em modo `write`;
- fluxo de worktree automática e falhas de merge/cleanup.

## Limitações conhecidas e boas práticas

- O parser de YAML é intencionalmente simples; use o formato documentado e evite YAML avançado.
- Declare `files` com precisão, principalmente em escritas. Diretórios são aceitos e cobrem mudanças abaixo deles.
- Não use worktrees automáticas como substituto para escopo correto; elas isolam execução, mas a validação granular de arquivos depende de `files` declarados.
- Mantenha uma tarefa clara por dispatch.
- Use Scout para exploração, Planner para plano, Builder para implementação, Reviewer para revisão e Documenter para documentação quando esses agentes existirem.
- Antes de depender do merge automático, mantenha o repositório base limpo.
- Em conflitos ou falhas, inspecione a worktree preservada e resolva manualmente.
- O dispatcher só conhece agentes listados em `agents.yaml` ou, quando não há entradas configuradas, agentes descobertos automaticamente; nomes listados sem `.md` correspondente geram aviso e não entram no catálogo.
