# Backlog Gardener

Backlog Gardener is a local-first agent for turning public feedback from GitHub issues, reviews, forums, and pull requests into concrete proposed backlog or review actions.

Documentation:

- [`docs/github-app.md`](docs/github-app.md)

## Local usage

```sh
pnpm install
pnpm gardener --help
pnpm gardener run --help
pnpm test
```

## GitHub App repo configuration

GitHub App behavior is target-repo driven through `.github/gardener.yml`, with optional review/triage guidance in root `.gardener.md`. See [`docs/github-app.md`](docs/github-app.md).

An example profile lives at `.gardener/products/example-product.yml`. It supports per-role completion settings, including model and thinking effort for `triage`, `evaluator`, and `verifier` under `llm.roles`.

Sync source code for verifier code context:

```sh
pnpm gardener sources sync --profile .gardener/products/example-product.yml
```

This clones configured repositories into `.gardener-worktrees/`, which is gitignored. `gardener run --dry-run` also syncs configured source checkouts automatically before verification; pass `--no-sync-sources` to skip that step.

Run the full local pipeline in dry-run mode. Dry-run still fetches sources, calls configured model providers, updates the invisible local cache, and writes local artifacts, but it performs no external writes such as GitHub/Linear mutations, PR creation, or Slack posts.

```sh
cp .env.example .env
# Fill in .env; gardener loads it automatically.

pnpm gardener run \
  --profile .gardener/products/example-product.yml \
  --lane warm \
  --dry-run
```

Backfill public source history for calibration/reference context:

```sh
pnpm gardener backfill \
  --profile .gardener/products/example-product.yml \
  --state .gardener-state/example-product.db \
  --since 365d
```

Machine-readable output is available with `--json`. Each run writes a portable action plan under `out/{product}/{timestamp}__{runId}/` (the compact-ISO timestamp prefix sorts run directories chronologically), including `actions.jsonl`, `actions.md`, `actions.html`, and `manifest.json`. Open `actions.html` in a browser to review the actions planned for each issue. Draft PR actions are emitted only when an isolated implementer produces patch artifacts; dry-run never pushes branches or opens PRs.

Runs also persist local evaluator decisions and verifier debugging plans. Review them and record local feedback in a browser:

```sh
pnpm gardener review --state .gardener-state/example-product.db
```

Open `http://127.0.0.1:4317`. Feedback is stored locally only; no source comments are posted.

## Docker

```sh
docker build -t backlog-gardener .
docker run --rm \
  -e ANTHROPIC_API_KEY \
  -e OPENAI_API_KEY \
  -e GITHUB_TOKEN \
  -v "$PWD/.gardener-state:/app/.gardener-state" \
  -v "$PWD/out:/app/out" \
  backlog-gardener run \
    --profile .gardener/products/example-product.yml \
    --lane warm \
    --dry-run
```

Implemented checks:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

To apply the coding standard locally:

```sh
pnpm format
pnpm lint:fix
```
