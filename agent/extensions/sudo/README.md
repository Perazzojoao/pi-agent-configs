# sudo_exec

Extensão para executar comandos privilegiados de forma segura no Pi, sem expor senha ao modelo.

## Objetivo

A tool `sudo_exec` existe para centralizar qualquer operação que exija `sudo`, com autenticação interativa no TUI e controles de segurança.

## Como funciona o diálogo (Tab/Enter)

Ao chamar `sudo_exec`, o usuário vê um diálogo com:
- campo de senha (mascarado),
- botão **[ Confirmar ]**,
- botão **[ Cancelar ]**.

Navegação:
- `Tab`: próximo foco (input → confirmar → cancelar)
- `Shift+Tab`: foco anterior
- `Enter`: aciona o item focado
- `Esc`: cancela

Importante: `Enter` no campo de senha **não confirma**. Para confirmar, mova o foco para **[ Confirmar ]** e pressione `Enter`.

## Política de bloqueio de sudo via bash

Chamadas com `sudo` na tool `bash` são bloqueadas (incluindo variações como `command sudo`, `env sudo`, caminhos absolutos etc.).

Se o agente tentar usar `sudo` em `bash`, a execução é interrompida com orientação para usar `sudo_exec` com o comando **sem** o prefixo `sudo`.

## Formato dos parâmetros da tool

`sudo_exec` aceita:

```json
{
  "command": "<comando sem sudo>",
  "timeout": 30
}
```

- `command` (string, obrigatório): comando alvo sem `sudo`.
- `timeout` (number, opcional): timeout em segundos.

## Observações de segurança

- A senha é coletada apenas na UI interativa.
- A senha é enviada somente para o `stdin` do processo `sudo`.
- A senha **não é retornada ao modelo** e não deve aparecer em logs de output.
- Há limpeza best-effort dos bytes da senha em memória após uso.
