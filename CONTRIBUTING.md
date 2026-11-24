# Contributing to Mnemo

Thanks for your interest. Issues and pull requests are welcome, in English or in French.

## Set up

```sh
nvm use            # Node.js 26 (see .nvmrc); Mnemo runs on 24 or later, the CI tests 24 on Linux
pnpm install
pnpm verifier      # type check (tsc --noEmit)
pnpm test          # Vitest suites of every package
```

The test configurations isolate each run (temporary home folder, a models folder with no model): no test reads your memory or
loads the local models.

## Conventions

- TypeScript runs natively in Node.js, without a build step: erasable syntax only (no `enum`, no `namespace`), relative
  imports with the `.ts` extension, `import type` for types.
- Code, names and messages are in French, like the rest of the code base. Documentation is in English.
- Layers in `packages/mnemo/src`: `domaine/` (pure rules, no `node:` module), `application/` (use cases and their
  ports), `infra/` and `adaptateurs/` (file system, git, processes, CLI, HTTP, MCP). Shared types and pure functions
  live in `packages/commun`.
- One file, one responsibility. No duplicated rule or constant: one definition, imported.
- Every write to the memory is a git commit `mnemo: <action> <path>`, under a lock.
- Paths are built with `node:path` in `infra/`; memory paths are always relative to `_mnemo/` with `/`; files are written
  with `\n`. No external tool except `git`, no shell script.

## Before opening a pull request

- `pnpm verifier` and `pnpm test` pass.
- New behaviour comes with tests that fail without it.
- `pnpm verifier-publication` passes: it rejects files outside `publication/liste-blanche.txt`, secrets, personal paths
  and real email addresses. Test data uses fictitious names, `example.com` addresses and placeholder paths.
