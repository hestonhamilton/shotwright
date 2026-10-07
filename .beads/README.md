# .beads

This directory is managed by [bd (beads)](https://github.com/gastownhall/beads),
the issue tracker this project uses. The tracked files here are bd's own
config and git hooks; the issue database itself lives on a Dolt sql-server and
is not in git.

How this project uses bd — including what is deliberately different from bd's
defaults — is documented in `CLAUDE.md` (section "Beads"). The two rules that
matter most:

- **Never run `bd dolt push`.** The Dolt ref was removed from the git remote
  on purpose; see `docs/backup.md` for the backup that replaced it.
- **Never run raw `dolt` CLI commands** while the server is running — use
  `bd dolt …`.

`bd prime` prints the full workflow reference.
