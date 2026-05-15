# Gardener GitHub App configuration

Gardener is configured by each target repository. The app supplies defaults, schema validation, and safety floors; the repository decides which safe behaviours are enabled.

## Setup CLI

Use the manifest flow to avoid manually clicking through every GitHub App setting:

```sh
pnpm gardener github-app manifest-url \
  --org Automattic \
  --name "Backlog Gardener" \
  --webhook-url https://example-tunnel.example/webhooks/github
```

Open the printed URL, approve the GitHub App creation, then exchange the returned temporary code:

```sh
pnpm gardener github-app exchange-code <code>
pnpm gardener github-app doctor
```

`exchange-code` writes `GARDENER_APP_ID`, `GARDENER_APP_PRIVATE_KEY`, and `GARDENER_APP_WEBHOOK_SECRET` to `.env`. Installing the app on repositories or approving org-level access still happens in GitHub.

## Files

### `.github/gardener.yml`

Machine-readable app configuration. This is the primary config file for GitHub App behaviour.

### `.gardener.md`

Human-readable repository guidance for review and triage. PR reviews receive this as authoritative project context. Use it for conventions, testing expectations, known false positives, and things Gardener should avoid suggesting.

## Example

```yaml
enabled: true
mode: suggest-comments

product:
  slug: example-repo
  name: Example Repo

model:
  provider: openai
  name: gpt-4.1-mini

code:
  checkout: true
  branch: main

issues:
  enabled: true
  comments:
    enabled: true
    minConfidence: medium
  includeRelatedIssues: true
  verifyWithCode: true

report:
  enabled: false

actions:
  issueComments: true

investigation:
  enabled: true
  defaultRecipe: docs-check
  recipes:
    docs-check:
      description: Run a lightweight docs/package validation recipe.
      timeoutSeconds: 120
      maxOutputChars: 12000
      commands:
        - pnpm test

prReviews:
  enabled: true
  liveMode: true
  includeDrafts: false
  cooldownHours: 24
  triggers:
    opened: true
    readyForReview: true
    synchronize: true

controls:
  ignoreLabels:
    - gardener-ignore
  protectedLabels:
    - security
```

## Safety floors

Repository config can enable or narrow behaviour, but it cannot bypass app safety constraints:

- unsupported webhook events are ignored
- issue comment webhooks only run trusted maintainer `@gardener` commands; other comments are ignored to avoid bot loops
- writes require `enabled: true` plus the relevant action flag
- protected/ignored labels block comments and PR reviews
- context size is capped before model calls
- app-owned checkouts stay under `.gardener-worktrees/`
- app actions are limited by the GitHub App installation permissions and selected repositories
- executable investigation recipes require `investigation.enabled: true` and a trusted maintainer command
- recipe commands that obviously dump env/secrets or pipe remote scripts into a shell are rejected during config parsing

## Runtime overrides for local testing

These are intended for local development, not repository policy:

- `GARDENER_CONFIG_REF` — read config/guidance from a branch or SHA
- `GARDENER_APP_STATE_PATH` — SQLite app state path, default `.gardener-state/app.db`
- `GARDENER_APP_CODE_ROOT` — use an existing checkout instead of app-managed checkout
- `GARDENER_APP_OPENAI_MODEL` — temporary model override
