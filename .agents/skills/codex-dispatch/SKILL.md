---
name: codex-dispatch
description: Which Codex model and effort to dispatch with — the default is gpt-6-sol at its own medium effort, so omit --model/--effort unless the task calls for luna, astra or a different effort; read before any codex-jobs dispatch that is about to pass those flags.
---

# codex-dispatch

`/codex-jobs` is *how* to dispatch; this skill is *what* to dispatch with. The
table below is the only copy of these facts in the repo — do not restate it in
briefs or other skills.

## Default

Every Codex home sets `model = "gpt-6-sol"` and no effort override, so a plain
dispatch is already the everyday choice:

```
.agents/skills/codex-jobs/scripts/codex-job.sh dispatch --write "<prompt>"   # gpt-6-sol, medium
```

Pass `--model` or `--effort` only when a row below says so.

## Models

| Shortcut | Model | Default effort | Levels | Use for |
|---|---|---|---|---|
| `luna` | gpt-6-luna | medium | low → max | High-volume, well-specified or mechanical work: renames, boilerplate, simple test fixes, running checks and summarising them, parallel fan-out lanes. |
| `sol` | gpt-6-sol | medium | low → ultra | Implementation, debugging, research docs and code review. The default. |
| `astra` | gpt-6-astra | **low** | low → ultra | The hardest problems: tricky diagnoses, cross-cutting design, a slice sol already failed. Its default is low, so raise `--effort` for deep reasoning. |

`--model` accepts the shortcut or the full slug.

## Effort

- **Raise effort before switching to a bigger model** when the task needs
  deeper reasoning but no more capability. `high` or `xhigh` for hard debugging
  and redteam gates; lower for quick lookups.
- The companion caps `--effort` at `none|minimal|low|medium|high|xhigh`; the
  models' `max` and `ultra` levels are not reachable through it.
- A `high`-effort implementation job can spend a Plus account's 5h window in
  about 20 minutes and die mid-slice with "You've hit your usage limit" in the
  job log (`status` shows `failed`; `result` returns its last note, which reads
  like a hand-back). Check limits **right before** dispatching:

  ```
  codex-acct usage
  ```

  Continue a limit-killed run on the other account from the diff it left,
  never from scratch (`/delegated-orchestrator` → Drain both accounts).

## Accounts and sandbox

- Homes: `~/.codex` (`heston`, the default) and `~/.codex-accounts/tab`. Each
  keeps a **hand-mirrored** `[sandbox_workspace_write]` table with
  `network_access = true` and the pnpm store as a writable root; without the
  table a `--write` task runs with no network and cannot `pnpm install`. Edit
  one, mirror the other.
- A long-lived broker pins the account per cwd and reads `config.toml` only
  when it starts. An inline `CODEX_HOME=` on dispatch does **not** override a
  live broker. Check which home the broker carries and restart it only when no
  task is running on that cwd:

  ```
  ps -eo pid,args | grep '[a]pp-server-broker.mjs serve' | grep -- "--cwd $PWD "
  tr '\0' '\n' < /proc/<broker pid>/environ | grep CODEX_HOME
  codex-acct restart "$PWD"
  ```

- `scripts/models.sh` prints what each model in a home's models cache
  supports (default level, level range). The cache is what the CLI last
  fetched, **not** the entitlement list. When a slug is in doubt, probe it
  (read-only, seconds) before editing this table or a config default:

  ```
  CODEX_HOME=~/.codex codex exec --skip-git-repo-check -s read-only -m gpt-6-sol "Reply with the single word ok"
  ```
