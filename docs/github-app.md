# Gardener GitHub App configuration

Gardener is configured by each target repository. The app supplies defaults, schema validation, and safety floors; the repository decides which safe behaviours are enabled.

## Files

### `.github/gardener.yml`

Machine-readable app configuration. This is the primary config file for GitHub App behaviour.

For transition only, `.github/backlog-gardener.yml` is still read as a legacy fallback when `.github/gardener.yml` is absent.

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
  labels: false
  closeIssues: false
  createLinear: false
  openPullRequests: false

pullRequests:
  enabled: true
  reviews:
    enabled: true
    liveMode: true
    mode: summary-review
    dedupeByHeadSha: true
  includeDrafts: false
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
- issue comment webhooks are ignored to avoid bot loops
- writes require `enabled: true` plus the relevant action flag
- protected/ignored labels block comments and PR reviews
- context size is capped before model calls
- app-owned checkouts stay under `.gardener-worktrees/`
- app actions are limited by the GitHub App installation permissions and selected repositories

## Runtime overrides for local testing

These are intended for local development, not repository policy:

- `GARDENER_CONFIG_REF` — read config/guidance from a branch or SHA
- `GARDENER_APP_STATE_PATH` — SQLite app state path, default `.gardener-state/app.db`
- `GARDENER_APP_CODE_ROOT` — use an existing checkout instead of app-managed checkout
- `GARDENER_APP_OPENAI_MODEL` — temporary model override
