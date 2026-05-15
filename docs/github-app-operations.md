# Operating the Gardener GitHub App

This guide covers day-to-day setup and operation for the Gardener GitHub App.

## 1. Create or validate the app

Generate a manifest URL:

```sh
pnpm gardener github-app manifest-url \
  --name "Backlog Gardener" \
  --webhook-url https://your-public-host.example/webhooks/github
```

For an organization-owned app:

```sh
pnpm gardener github-app manifest-url \
  --org Automattic \
  --name "Backlog Gardener" \
  --webhook-url https://your-public-host.example/webhooks/github
```

After creating the app, exchange the manifest code if GitHub provided one:

```sh
pnpm gardener github-app exchange-code <code>
```

If the app was configured manually, set these in `.env`:

```sh
GARDENER_APP_ID=...
GARDENER_APP_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...'
GARDENER_APP_WEBHOOK_SECRET=...
OPENAI_API_KEY=...
```

Validate app credentials and repository access:

```sh
pnpm gardener github-app doctor
pnpm gardener github-app doctor --repo owner/repo
```

## 2. Configure a target repository

Gardener reads repository-owned configuration from `.github/gardener.yml`.

Minimal example:

```yaml
enabled: true
mode: suggest-comments

product:
  slug: example-repo
  name: Example Repo

issues:
  enabled: true
  comments:
    enabled: true

actions:
  issueComments: true

prReviews:
  enabled: true
  liveMode: true
  inlineComments: false
  triggers:
    opened: true
    readyForReview: true
    synchronize: true
```

Optional human guidance goes in root `.gardener.md`. PR reviews receive it as project context.

## 3. Manual investigation recipes

Executable recipes are disabled unless the repo opts in:

```yaml
investigation:
  enabled: true
  defaultRecipe: docs-check
  recipes:
    docs-check:
      description: Validate docs and package metadata.
      timeoutSeconds: 120
      maxOutputChars: 12000
      commands:
        - pnpm test
```

For stricter repositories, restrict recipe commands to approved prefixes:

```yaml
investigation:
  enabled: true
  allowedCommandPrefixes:
    - pnpm
    - npm
    - node
    - test
```

When prefixes are configured, every recipe command must exactly match a prefix or start with `<prefix> `. Gardener also redacts common token, API key, and private-key patterns from command output before storing artifacts or posting comments.

Trusted maintainers can trigger recipes from an issue or PR thread:

```text
@gardener help
@gardener list recipes
@gardener investigate
@gardener reproduce
@gardener run recipe docs-check
@gardener rerun
@gardener explain
```

Command behavior:

- `help` shows supported commands and recipes.
- `list recipes` lists configured recipes.
- `investigate` and `reproduce` run the default recipe.
- `run recipe <name>` runs a named recipe.
- `rerun` runs the latest recipe previously used on the thread.
- `explain` posts the latest persisted investigation summary for the thread.

## 4. Inline PR review comments

PR reviews are summary-only by default. To allow Gardener to attach file/line review comments, opt in explicitly:

```yaml
prReviews:
  enabled: true
  liveMode: true
  inlineComments: true
```

Inline comments are only published when Gardener can validate that the target line is an added line in the pull request patch. Invalid or unchanged-line suggestions are dropped and kept in the persisted artifact details.

## 5. Inspect jobs locally

Webhook deliveries are persisted as app jobs before processing. Inspect them when debugging webhook delivery, retries, skipped work, or dead-lettered failures:

```sh
pnpm gardener github-app jobs list \
  --state .gardener-state/app.db

pnpm gardener github-app jobs list \
  --state .gardener-state/app.db \
  --repo owner/repo \
  --status dead_letter
```

Jobs include attempt counters and any scheduled `nextRunAt` retry time. Manually requeue a failed or dead-letter job after inspecting the failure:

```sh
pnpm gardener github-app jobs retry <job-id> \
  --state .gardener-state/app.db
```

Manual retries preserve the attempt count so repeated failures remain visible in the job history.

## 6. Inspect artifacts locally

All issue, PR, and manual investigation results are persisted in SQLite.

```sh
pnpm gardener github-app investigations list \
  --state .gardener-state/app.db \
  --repo owner/repo

pnpm gardener github-app investigations show <artifact-id> \
  --state .gardener-state/app.db
```

Use artifacts to debug skipped comments, suppressed issue triage, manual command outputs, and synthesized conclusions.

## 7. Safety model

Gardener favors explicit opt-in and low-risk defaults:

- Repository writes require `enabled: true` and the relevant action flag.
- Manual executable recipes require `investigation.enabled: true`.
- Manual recipe commands only run after a trusted `OWNER`, `MEMBER`, or `COLLABORATOR` comment.
- Bot comments and untrusted comments are ignored for command execution.
- Only base-branch repository config is trusted for execution recipes.
- Commands run in app-owned checkouts under `.gardener-worktrees/`.
- Command environment variables are restricted.
- Obvious secret/env dumping and curl-pipe-shell commands are rejected during config parsing.
- Concurrent manual investigations for the same issue/PR are locked to avoid duplicate runs and comment spam.

## 8. Local development loop

For local webhook testing:

```sh
ngrok http 3000
# Set the GitHub App webhook URL to https://<ngrok-host>/webhooks/github
pnpm gardener:github-app
```

Useful runtime overrides:

```sh
GARDENER_CONFIG_REF=branch-or-sha
GARDENER_APP_STATE_PATH=.gardener-state/app-live-test.db
GARDENER_APP_CODE_ROOT=/path/to/existing/checkout
GARDENER_APP_OPENAI_MODEL=gpt-4.1-mini
```
