#!/usr/bin/env node

import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { OpenAICompletionProvider } from '../llm/openai.js';
import { StoreDb } from '../store/db.js';
import { ensureAppRepoCheckout } from './code.js';
import { parseGitHubAppConfig, type GitHubAppConfig } from './config.js';
import { fetchRepoGitHubAppConfig, GitHubRestAppClient } from './github-client.js';
import { createInstallationToken, verifyGitHubWebhookSignature } from './github-app.js';
import { enrichDecisionWithInvestigationResult } from './investigation.js';
import {
  fallbackManualInvestigationSynthesis,
  manualInvestigationCommandAllowed,
  parseManualInvestigationCommand,
  renderManualInvestigationComment,
  renderManualInvestigationHelp,
  renderRecipeList,
  renderUnknownRecipeComment,
  runManualInvestigation,
  synthesizeManualInvestigation,
} from './manual-investigation.js';
import { buildWebhookDecisionLogEntry, writeStructuredLog } from './logging.js';
import { evaluateDecisionPolicy } from './policy.js';
import { publishDecision } from './publisher.js';
import { runScheduledReportSweep } from './scheduler.js';
import { SqliteAppStateStore } from './state.js';
import type { AppDecision, RepoRef } from './types.js';
import { handleGitHubWebhook } from './webhooks.js';

export interface AppServerOptions {
  port?: number;
  webhookSecret: string;
  internalToken?: string;
}

export function startGitHubAppServer(options: AppServerOptions): ReturnType<typeof createServer> {
  const stateDb = new StoreDb(process.env.GARDENER_APP_STATE_PATH ?? '.gardener-state/app.db');
  const state = new SqliteAppStateStore(stateDb.db);
  const port = options.port ?? 3000;
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404).end('not found');
      return;
    }

    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/webhooks/github') {
        void handleWebhookRequest();
        return;
      }
      if (request.url === '/internal/scheduled-report') {
        void handleScheduledReportRequest();
        return;
      }
      response.writeHead(404).end('not found');
    });

    async function handleWebhookRequest(): Promise<void> {
      const body = Buffer.concat(chunks);
      const signature = request.headers['x-hub-signature-256'];
      const signatureArgs = {
        secret: options.webhookSecret,
        payload: body,
        ...(typeof signature === 'string' ? { signature256: signature } : {}),
      };
      if (!verifyGitHubWebhookSignature(signatureArgs)) {
        response.writeHead(401).end('invalid signature');
        return;
      }

      try {
        const payload = JSON.parse(body.toString('utf8')) as Parameters<typeof handleGitHubWebhook>[0]['payload'];
        const eventName = String(request.headers['x-github-event'] ?? 'unknown');
        const deliveryId = String(request.headers['x-github-delivery'] ?? randomUUID());
        const repo = repoRefFromPayload(payload);
        const loaded = repo ? await createClientAndConfig(repo, configRefForPayload(payload)) : null;
        const config = loaded?.config ?? parseGitHubAppConfig(null);
        const job = state.enqueueJob({
          deliveryId,
          eventName,
          repo: repo?.fullName ?? null,
          payloadJson: body.toString('utf8'),
        });
        response
          .writeHead(202, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: 'queued', jobId: job.id }));
        setImmediate(() => {
          void processWebhookJob({ jobId: job.id, deliveryId, eventName, payload, config, loaded }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            state.completeJob(job.id, 'failed', message);
            writeStructuredLog({ event: 'github_webhook_job_failed', deliveryId, jobId: job.id, error: message });
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
      }
    }

    async function processWebhookJob(args: {
      jobId: string;
      deliveryId: string;
      eventName: string;
      payload: Parameters<typeof handleGitHubWebhook>[0]['payload'];
      config: GitHubAppConfig;
      loaded: { client: GitHubRestAppClient; config: GitHubAppConfig } | null;
    }): Promise<void> {
      state.startJob(args.jobId);
      if (args.eventName === 'issue_comment') {
        await processManualInvestigationCommand(args);
        return;
      }
      const initialResult = handleGitHubWebhook({
        eventName: args.eventName,
        deliveryId: args.deliveryId,
        payload: args.payload,
        config: args.config,
        state,
      });
      let result = initialResult;
      let investigationId: string | null = null;
      let suppressionReason: string | null = null;
      if (
        args.loaded &&
        initialResult.status === 'processed' &&
        initialResult.decision &&
        initialResult.reasons.includes('allowed')
      ) {
        const codeRoot = codeRootForDecision(initialResult.decision, args.config);
        const enriched = await enrichDecisionWithInvestigationResult({
          decision: initialResult.decision,
          client: args.loaded.client,
          provider: createAppCompletionProvider(args.config),
          config: args.config,
          ...(codeRoot ? { codeRoot } : {}),
        });
        if (enriched.artifact) {
          suppressionReason = enriched.artifact.suppressionReason;
          const artifact = state.recordInvestigationArtifact({
            jobId: args.jobId,
            runId: initialResult.runId,
            deliveryId: args.deliveryId,
            repo: repoFromDecisionOrPayload(enriched.decision, args.payload),
            subjectType: enriched.artifact.subjectType,
            subjectNumber: enriched.artifact.subjectNumber,
            status: enriched.artifact.status,
            suppressionReason: enriched.artifact.suppressionReason,
            publicationStatus:
              enriched.artifact.status === 'comment_ready' || enriched.artifact.status === 'review_ready'
                ? 'pending'
                : 'skipped',
            generatedBody: enriched.artifact.generatedBody,
            details: enriched.artifact.details,
          });
          investigationId = artifact.id;
        }
        const finalPolicy = evaluateDecisionPolicy(enriched.decision, args.config, {
          labels: labelsFromPayload(args.payload),
        });
        result = { ...initialResult, decision: enriched.decision, reasons: finalPolicy.reasons };
      }
      let publication: 'skipped' | 'published' = 'skipped';
      if (args.loaded && result.status === 'processed' && result.decision && result.reasons.includes('allowed')) {
        publication = await publishDecision({ client: args.loaded.client, state, decision: result.decision });
        if (investigationId) state.updateInvestigationPublication(investigationId, publication);
        if (
          publication === 'published' &&
          result.decision.type === 'review_pull_request' &&
          result.decision.pullRequest.headSha
        ) {
          state.recordPullRequestReview({
            installationId: result.decision.pullRequest.installationId,
            repo: result.decision.pullRequest.fullName,
            pullRequestNumber: result.decision.pullRequest.pullRequestNumber,
            headSha: result.decision.pullRequest.headSha,
          });
        }
      } else if (investigationId) {
        state.updateInvestigationPublication(investigationId, 'skipped');
      }
      const status = result.status === 'skipped' ? 'skipped' : 'completed';
      state.completeJob(args.jobId, status);
      writeStructuredLog({
        ...buildWebhookDecisionLogEntry({ deliveryId: args.deliveryId, result }),
        jobId: args.jobId,
        publication,
        ...(investigationId ? { investigationId } : {}),
        ...(suppressionReason ? { suppressionReason } : {}),
      });
    }

    async function processManualInvestigationCommand(args: {
      jobId: string;
      deliveryId: string;
      eventName: string;
      payload: Parameters<typeof handleGitHubWebhook>[0]['payload'];
      config: GitHubAppConfig;
      loaded: { client: GitHubRestAppClient; config: GitHubAppConfig } | null;
    }): Promise<void> {
      const command = parseManualInvestigationCommand(args.payload.comment?.body ?? '');
      const repo = repoRefFromPayload(args.payload);
      if (!command || !repo || !args.loaded || !manualInvestigationCommandAllowed(args.payload)) {
        state.completeJob(args.jobId, 'skipped');
        writeStructuredLog({
          event: 'github_manual_investigation_skipped',
          deliveryId: args.deliveryId,
          jobId: args.jobId,
          repo: repo?.fullName ?? null,
          reason: !command
            ? 'no_gardener_command'
            : !manualInvestigationCommandAllowed(args.payload)
              ? 'untrusted_comment_author'
              : 'missing_context',
        });
        return;
      }
      try {
        if (command.type === 'help' || command.type === 'list_recipes') {
          await args.loaded.client.createIssueComment({
            owner: repo.owner,
            repo: repo.repo,
            issueNumber: args.payload.issue!.number!,
            body: command.type === 'help' ? renderManualInvestigationHelp(args.config) : renderRecipeList(args.config),
          });
          state.completeJob(args.jobId, 'completed');
          writeStructuredLog({
            event:
              command.type === 'help'
                ? 'github_manual_investigation_help_posted'
                : 'github_manual_investigation_recipes_listed',
            deliveryId: args.deliveryId,
            jobId: args.jobId,
            repo: repo.fullName,
          });
          return;
        }
        if (!args.config.investigation.enabled) {
          const issueNumber = args.payload.issue?.number;
          if (issueNumber) {
            await args.loaded.client.createIssueComment({
              owner: repo.owner,
              repo: repo.repo,
              issueNumber,
              body: '🌱 **Backlog Gardener manual investigation**\n\nManual investigation recipes are disabled for this repository. Set `investigation.enabled: true` in `.github/gardener.yml` to allow trusted maintainer commands.',
            });
          }
          state.completeJob(args.jobId, 'skipped');
          writeStructuredLog({
            event: 'github_manual_investigation_skipped',
            deliveryId: args.deliveryId,
            jobId: args.jobId,
            repo: repo.fullName,
            reason: 'investigation_disabled',
          });
          return;
        }
        const requestedRecipe =
          command.recipeName === 'default' ? args.config.investigation.defaultRecipe : command.recipeName;
        if (!args.config.investigation.recipes[requestedRecipe]) {
          await args.loaded.client.createIssueComment({
            owner: repo.owner,
            repo: repo.repo,
            issueNumber: args.payload.issue!.number!,
            body: renderUnknownRecipeComment(args.config, requestedRecipe),
          });
          state.completeJob(args.jobId, 'completed');
          writeStructuredLog({
            event: 'github_manual_investigation_unknown_recipe',
            deliveryId: args.deliveryId,
            jobId: args.jobId,
            repo: repo.fullName,
            recipeName: requestedRecipe,
          });
          return;
        }
        const subjectNumber = args.payload.issue!.number!;
        const subjectType = args.payload.issue?.pull_request ? 'pull_request' : 'issue';
        const lockKey = `${repo.fullName}:${subjectType}:${subjectNumber}`;
        if (!state.acquireInvestigationLock({ key: lockKey, owner: args.jobId })) {
          await args.loaded.client.createIssueComment({
            owner: repo.owner,
            repo: repo.repo,
            issueNumber: subjectNumber,
            body: '🌱 **Backlog Gardener manual investigation**\n\nA manual investigation is already running for this thread. Please wait for it to finish before starting another recipe.',
          });
          state.completeJob(args.jobId, 'skipped');
          writeStructuredLog({
            event: 'github_manual_investigation_skipped',
            deliveryId: args.deliveryId,
            jobId: args.jobId,
            repo: repo.fullName,
            reason: 'investigation_already_running',
          });
          return;
        }
        try {
          const checkout = ensureAppRepoCheckout({
            owner: repo.owner,
            repo: repo.repo,
            branch: process.env.GARDENER_APP_CHECKOUT_BRANCH ?? args.config.code.branch,
          });
          const result = await runManualInvestigation({
            payload: args.payload,
            config: args.config,
            repo,
            checkoutPath: checkout.path,
            command,
          });
          let synthesis = fallbackManualInvestigationSynthesis(result);
          try {
            synthesis = await synthesizeManualInvestigation({
              provider: createAppCompletionProvider(args.config),
              repo: repo.fullName,
              subject: `${result.subjectType} #${result.subjectNumber}`,
              result,
            });
          } catch (error) {
            writeStructuredLog({
              event: 'github_manual_investigation_synthesis_failed',
              deliveryId: args.deliveryId,
              jobId: args.jobId,
              repo: repo.fullName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          const artifact = state.recordInvestigationArtifact({
            jobId: args.jobId,
            deliveryId: args.deliveryId,
            repo: repo.fullName,
            subjectType: result.subjectType,
            subjectNumber: result.subjectNumber,
            status: result.subjectType === 'issue' ? 'comment_ready' : 'review_ready',
            publicationStatus: 'published',
            generatedBody: null,
            details: {
              manualCommand: args.payload.comment?.body ?? '',
              commandAuthor: args.payload.comment?.user?.login ?? null,
              recipeName: result.recipeName,
              description: result.description,
              synthesis,
              commands: result.commands,
            },
          });
          const body = renderManualInvestigationComment({
            recipeName: result.recipeName,
            description: result.description,
            commands: result.commands,
            synthesis,
            artifactId: artifact.id,
          });
          await args.loaded.client.createIssueComment({
            owner: repo.owner,
            repo: repo.repo,
            issueNumber: result.subjectNumber,
            body,
          });
          state.updateInvestigationPublication(artifact.id, 'published');
          state.completeJob(args.jobId, 'completed');
          writeStructuredLog({
            event: 'github_manual_investigation_completed',
            deliveryId: args.deliveryId,
            jobId: args.jobId,
            repo: repo.fullName,
            investigationId: artifact.id,
            recipeName: result.recipeName,
          });
        } finally {
          state.releaseInvestigationLock(lockKey, args.jobId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const issueNumber = args.payload.issue?.number;
        if (issueNumber && repo && args.loaded) {
          await args.loaded.client.createIssueComment({
            owner: repo.owner,
            repo: repo.repo,
            issueNumber,
            body: `🌱 **Backlog Gardener manual investigation**\n\nCould not run the requested recipe: ${message}`,
          });
        }
        state.completeJob(args.jobId, 'failed', message);
        writeStructuredLog({
          event: 'github_manual_investigation_failed',
          deliveryId: args.deliveryId,
          jobId: args.jobId,
          repo: repo?.fullName ?? null,
          error: message,
        });
      }
    }

    async function handleScheduledReportRequest(): Promise<void> {
      if (!options.internalToken) {
        response.writeHead(404).end('not found');
        return;
      }
      if (request.headers.authorization !== `Bearer ${options.internalToken}`) {
        response.writeHead(401).end('invalid internal token');
        return;
      }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<RepoRef>;
        if (!payload.installationId || !payload.owner || !payload.repo) {
          response
            .writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: 'missing repo ref' }));
          return;
        }
        const repo: RepoRef = {
          installationId: payload.installationId,
          owner: payload.owner,
          repo: payload.repo,
          fullName: payload.fullName ?? `${payload.owner}/${payload.repo}`,
        };
        const { client, config } = await createClientAndConfig(repo);
        const result = await runScheduledReportSweep({ repo, config, state, client });
        response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
      }
    }
  });
  server.listen(port);
  return server;
}

function labelsFromPayload(payload: Parameters<typeof handleGitHubWebhook>[0]['payload']): string[] {
  return [...(payload.issue?.labels ?? []), ...(payload.pull_request?.labels ?? [])].flatMap((label) => {
    if (typeof label === 'string') return [label];
    return label.name ? [label.name] : [];
  });
}

function repoFromDecisionOrPayload(
  decision: AppDecision,
  payload: Parameters<typeof handleGitHubWebhook>[0]['payload'],
): string {
  if (decision.type === 'comment_on_issue') return decision.issue.fullName;
  if (decision.type === 'review_pull_request') return decision.pullRequest.fullName;
  if (decision.type === 'update_report') return decision.report.repo.fullName;
  return payload.repository?.full_name ?? 'unknown/unknown';
}

function repoRefFromPayload(payload: Parameters<typeof handleGitHubWebhook>[0]['payload']): RepoRef | null {
  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const fullName = payload.repository?.full_name;
  if (!installationId || !owner || !repo || !fullName) return null;
  return { installationId, owner, repo, fullName };
}

export function configRefForPayload(
  payload: Parameters<typeof handleGitHubWebhook>[0]['payload'],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.GARDENER_CONFIG_REF) return env.GARDENER_CONFIG_REF;
  if (env.GARDENER_ALLOW_PR_HEAD_CONFIG !== 'true') return undefined;
  return payload.pull_request?.head?.sha;
}

function createAppCompletionProvider(config: GitHubAppConfig): OpenAICompletionProvider {
  return new OpenAICompletionProvider({ model: process.env.GARDENER_APP_OPENAI_MODEL ?? config.model.name });
}

function codeRootForDecision(
  decision: NonNullable<ReturnType<typeof handleGitHubWebhook>['decision']>,
  config: GitHubAppConfig,
): string | null {
  const repo =
    decision.type === 'comment_on_issue'
      ? decision.issue
      : decision.type === 'review_pull_request'
        ? decision.pullRequest
        : null;
  if (!repo || !config.code.checkout) return null;
  if (process.env.GARDENER_APP_CODE_ROOT) return process.env.GARDENER_APP_CODE_ROOT;
  return ensureAppRepoCheckout({
    owner: repo.owner,
    repo: repo.repo,
    branch: process.env.GARDENER_APP_CHECKOUT_BRANCH ?? config.code.branch,
  }).path;
}

async function createClientAndConfig(
  repo: RepoRef,
  ref?: string,
): Promise<{ client: GitHubRestAppClient; config: GitHubAppConfig }> {
  const appId = process.env.GARDENER_APP_ID;
  const privateKey = process.env.GARDENER_APP_PRIVATE_KEY?.replaceAll('\\n', '\n');
  if (!appId || !privateKey) throw new Error('GARDENER_APP_ID and GARDENER_APP_PRIVATE_KEY are required');
  const token = await createInstallationToken({ appId, privateKey, installationId: repo.installationId });
  const client = new GitHubRestAppClient({ token: token.token });
  return { client, config: await fetchRepoGitHubAppConfig({ client, repo, ...(ref ? { ref } : {}) }) };
}

if (process.argv[1]?.endsWith('/server.ts') || process.argv[1]?.endsWith('/server.js')) {
  const webhookSecret = process.env.GARDENER_APP_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('GARDENER_APP_WEBHOOK_SECRET is required');
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
  startGitHubAppServer({
    port,
    webhookSecret,
    ...(process.env.GARDENER_INTERNAL_TOKEN ? { internalToken: process.env.GARDENER_INTERNAL_TOKEN } : {}),
  });
  process.stdout.write(`Backlog Gardener GitHub App listening on :${port}\n`);
}
