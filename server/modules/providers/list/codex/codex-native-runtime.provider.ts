import path from 'node:path';

import {
  appendFilesInputTag,
  isAllowedImageSourcePath,
  normalizeImageDescriptors,
  resolveImageAbsolutePath,
} from '@/shared/image-attachments.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
} from '@/shared/utils.js';
import type {
  AnyRecord,
  CodexAppServerNotification,
  CodexAppServerRequest,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

import { CodexAppServerClient } from './codex-app-server.client.js';
import { parseCodexNativeCommand } from './codex-native-command.service.js';
import { codexRuntime as sdkCodexRuntime } from './codex-runtime.provider.js';

type AppServerRun = {
  client: CodexAppServerClient;
  threadId: string;
  turnId: string | null;
  aborted: boolean;
  finishAbort(): void;
};

type AppServerThreadResponse = {
  thread?: { id?: string };
};

type AppServerTurnResponse = {
  turn?: { id?: string };
  reviewThreadId?: string;
};

const planModeSessions = new Set<string>();
const activeAppServerRuns = new Map<string, AppServerRun>();
const pendingCodexApprovals = new Map<string, {
  client: CodexAppServerClient;
  rpcRequestId: number;
  sessionId: string;
  message: Record<string, unknown>;
  kind: 'approval' | 'userInput';
  questions?: Array<{ id: string; question: string }>;
}>();

function send(writer: ProviderRuntimeWriter, message: unknown): void {
  writer.send(message);
}

function sendText(writer: ProviderRuntimeWriter, sessionId: string | null, content: string): void {
  send(writer, createNormalizedMessage({
    kind: 'text',
    provider: 'codex',
    sessionId,
    role: 'assistant',
    content,
  }));
}

function mapPermissionMode(permissionMode: unknown): {
  sandbox: 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'untrusted' | 'never';
} {
  if (permissionMode === 'bypassPermissions') {
    return { sandbox: 'danger-full-access', approvalPolicy: 'never' };
  }
  if (permissionMode === 'acceptEdits') {
    return { sandbox: 'workspace-write', approvalPolicy: 'never' };
  }
  return { sandbox: 'workspace-write', approvalPolicy: 'untrusted' };
}

function transformCompletedItem(item: Record<string, any>): Record<string, any> | null {
  switch (item.type) {
    case 'agentMessage':
      return {
        type: 'item',
        itemType: 'agent_message',
        message: { role: 'assistant', content: item.text || '' },
      };
    case 'plan':
      return {
        type: 'item',
        itemType: 'agent_message',
        message: { role: 'assistant', content: `<proposed_plan>\n${item.text || ''}\n</proposed_plan>` },
      };
    case 'reasoning': {
      const content = [...(item.summary || []), ...(item.content || [])].filter(Boolean).join('\n');
      return content
        ? {
            type: 'item',
            itemType: 'reasoning',
            message: { role: 'assistant', content, isReasoning: true },
          }
        : null;
    }
    case 'commandExecution':
      return {
        type: 'item',
        itemType: 'command_execution',
        command: item.command,
        output: item.aggregatedOutput,
        exitCode: item.exitCode,
        status: item.status,
      };
    case 'fileChange':
      return {
        type: 'item',
        itemType: 'file_change',
        changes: item.changes,
        status: item.status,
      };
    case 'mcpToolCall':
      return {
        type: 'item',
        itemType: 'mcp_tool_call',
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        result: item.result,
        error: item.error,
        status: item.status,
      };
    case 'webSearch':
      return {
        type: 'item',
        itemType: 'web_search',
        query: item.query || item.action?.query || '',
      };
    default:
      return null;
  }
}

function forwardNotification(
  event: CodexAppServerNotification,
  context: ProviderRuntimeContext,
  writer: ProviderRuntimeWriter,
  sessionId: string,
): void {
  if (event.method === 'item/completed') {
    const raw = transformCompletedItem(event.params.item || {});
    if (raw) {
      for (const message of context.normalizeMessage(raw, sessionId)) {
        send(writer, message);
      }
    }
    return;
  }

  if (event.method === 'thread/tokenUsage/updated') {
    const usage = event.params.tokenUsage;
    const total = usage?.total;
    if (total) {
      send(writer, createNormalizedMessage({
        kind: 'status',
        provider: 'codex',
        sessionId,
        text: 'token_budget',
        tokenBudget: {
          used: Number(total.totalTokens || 0),
          total: Number(event.params.modelContextWindow || 200_000),
          inputTokens: Number(total.inputTokens || 0),
          outputTokens: Number(total.outputTokens || 0),
          breakdown: {
            input: Number(total.inputTokens || 0),
            output: Number(total.outputTokens || 0),
          },
        },
      }));
    }
  }
}

function createTurnInput(
  command: string,
  options: AnyRecord,
  workingDirectory: string,
): Array<Record<string, unknown>> {
  const prompt = appendFilesInputTag(command, options.files);
  const input: Array<Record<string, unknown>> = [{
    type: 'text',
    text: prompt,
    text_elements: [],
  }];

  for (const image of normalizeImageDescriptors(options.images)) {
    const imagePath = resolveImageAbsolutePath(workingDirectory, image.path);
    if (isAllowedImageSourcePath(imagePath, workingDirectory)) {
      input.push({ type: 'localImage', path: imagePath });
    }
  }
  return input;
}

function handleApprovalRequest(
  request: CodexAppServerRequest,
  client: CodexAppServerClient,
  writer: ProviderRuntimeWriter,
  sessionId: string,
): boolean {
  const isCommandApproval = request.method === 'item/commandExecution/requestApproval';
  const isFileApproval = request.method === 'item/fileChange/requestApproval';
  const isUserInput = request.method === 'item/tool/requestUserInput';
  if (!isCommandApproval && !isFileApproval && !isUserInput) {
    return false;
  }

  const requestId = `codex:${sessionId}:${request.id}:${Date.now()}`;
  const questions = isUserInput && Array.isArray(request.params.questions)
    ? request.params.questions
        .filter((question: unknown): question is Record<string, any> => Boolean(
          question && typeof question === 'object',
        ))
        .map((question) => ({
          id: String(question.id || question.question || ''),
          question: String(question.question || ''),
          header: String(question.header || ''),
          multiSelect: false,
          options: Array.isArray(question.options) ? question.options : [],
        }))
    : [];
  const message = createNormalizedMessage({
    kind: 'permission_request',
    provider: 'codex',
    sessionId,
    requestId,
    toolName: isUserInput ? 'AskUserQuestion' : (isCommandApproval ? 'Bash' : 'FileChanges'),
    input: isUserInput
      ? { questions }
      : isCommandApproval
      ? {
          command: request.params.command,
          cwd: request.params.cwd,
          reason: request.params.reason,
        }
      : {
          reason: request.params.reason,
          grantRoot: request.params.grantRoot,
        },
  });
  pendingCodexApprovals.set(requestId, {
    client,
    rpcRequestId: request.id,
    sessionId,
    message,
    kind: isUserInput ? 'userInput' : 'approval',
    questions: questions.map(({ id, question }) => ({ id, question })),
  });
  send(writer, message);
  return true;
}

function clearApprovalsForClient(
  client: CodexAppServerClient,
  writer: ProviderRuntimeWriter,
): void {
  for (const [requestId, approval] of pendingCodexApprovals.entries()) {
    if (approval.client !== client) {
      continue;
    }
    pendingCodexApprovals.delete(requestId);
    send(writer, createNormalizedMessage({
      kind: 'permission_cancelled',
      provider: 'codex',
      sessionId: approval.sessionId,
      requestId,
    }));
  }
}

async function runThroughAppServer(
  command: string,
  operation: 'plan' | 'review' | 'compact',
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<void> {
  const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
  const providerSessionId = context.resolveProviderSessionId(appSessionId);
  if (operation === 'compact' && !providerSessionId) {
    send(writer, createNormalizedMessage({
      kind: 'error',
      provider: 'codex',
      sessionId: appSessionId,
      content: 'There is no Codex thread to compact yet.',
    }));
    send(writer, createCompleteMessage({ provider: 'codex', sessionId: appSessionId, exitCode: 1 }));
    return;
  }

  const workingDirectory = path.resolve(options.cwd || options.projectPath || process.cwd());
  const resolvedModel = await context.resolveResumeModel(appSessionId, options.model);
  const catalog = await context.getProviderModels();
  const selectedModel = resolvedModel || catalog.DEFAULT;
  const selectedOption = catalog.OPTIONS.find((option) => option.value === selectedModel);
  const allowedEfforts = selectedOption?.effort?.values.map((entry) => entry.value) || [];
  const selectedEffort = typeof options.effort === 'string'
    && options.effort !== 'default'
    && allowedEfforts.includes(options.effort)
    ? options.effort
    : null;
  const permissions = mapPermissionMode(options.permissionMode);
  const client = await CodexAppServerClient.start();

  let threadId = providerSessionId || '';
  let turnId: string | null = null;
  const terminalState: { error: Error | null } = { error: null };
  let resolveFinished!: (exitCode: number) => void;
  const finished = new Promise<number>((resolve) => {
    resolveFinished = resolve;
  });

  const unsubscribe = client.onNotification((event) => {
    if (event.method === 'error' && event.params.willRetry === false) {
      terminalState.error = new Error(event.params.error?.message || 'Codex turn failed');
    }
    forwardNotification(event, context, writer, threadId || appSessionId);
    if (operation === 'compact' && event.method === 'thread/compacted') {
      resolveFinished(0);
    }
    if (operation !== 'compact' && event.method === 'turn/completed') {
      const status = event.params.turn?.status;
      resolveFinished(status === 'completed' ? 0 : 1);
    }
  });
  const unsubscribeRequests = client.onRequest((request) => handleApprovalRequest(
    request,
    client,
    writer,
    threadId || appSessionId,
  ));
  const unsubscribeExit = client.onExit(({ error }) => {
    terminalState.error = error;
    resolveFinished(1);
  });

  try {
    const threadParams = {
      model: selectedModel,
      cwd: workingDirectory,
      approvalPolicy: permissions.approvalPolicy,
      sandbox: permissions.sandbox,
    };
    const threadResponse = providerSessionId
      ? await client.request<AppServerThreadResponse>('thread/resume', {
          threadId: providerSessionId,
          ...threadParams,
        })
      : await client.request<AppServerThreadResponse>('thread/start', threadParams);

    threadId = threadResponse.thread?.id || providerSessionId || '';
    if (!threadId) {
      throw new Error('Codex app-server did not return a thread id');
    }

    const activeRun: AppServerRun = {
      client,
      threadId,
      turnId,
      aborted: false,
      finishAbort: () => resolveFinished(1),
    };
    if (appSessionId) {
      activeAppServerRuns.set(appSessionId, activeRun);
    }
    writer.setSessionId?.(threadId);
    if (!providerSessionId) {
      send(writer, createNormalizedMessage({
        kind: 'session_created',
        provider: 'codex',
        sessionId: threadId,
        newSessionId: threadId,
      }));
    }

    if (operation === 'compact') {
      await client.request('thread/compact/start', { threadId });
    } else if (operation === 'review') {
      const response = await client.request<AppServerTurnResponse>('review/start', {
        threadId,
        target: command
          ? { type: 'custom', instructions: command }
          : { type: 'uncommittedChanges' },
        delivery: 'inline',
      });
      turnId = response.turn?.id || null;
      activeRun.turnId = turnId;
    } else {
      const response = await client.request<AppServerTurnResponse>('turn/start', {
        threadId,
        input: createTurnInput(command, options, workingDirectory),
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: selectedModel,
            reasoning_effort: selectedEffort || 'medium',
            developer_instructions: null,
          },
        },
      });
      turnId = response.turn?.id || null;
      activeRun.turnId = turnId;
    }

    const exitCode = await finished;
    const currentRun = appSessionId ? activeAppServerRuns.get(appSessionId) : null;
    if (currentRun?.aborted) {
      return;
    }
    if (operation === 'compact' && exitCode === 0) {
      sendText(writer, threadId, 'Codex context compacted.');
    }
    if (terminalState.error) {
      send(writer, createNormalizedMessage({
        kind: 'error',
        provider: 'codex',
        sessionId: threadId,
        content: terminalState.error.message,
      }));
    }
    send(writer, createCompleteMessage({
      provider: 'codex',
      sessionId: threadId,
      actualSessionId: threadId,
      exitCode: terminalState.error ? 1 : exitCode,
    }));
  } catch (error) {
    const activeRun = appSessionId ? activeAppServerRuns.get(appSessionId) : null;
    if (!activeRun?.aborted) {
      const installed = await context.isProviderInstalled();
      const message = installed
        ? (error instanceof Error ? error.message : String(error))
        : 'Codex CLI is not configured. Please set up authentication first.';
      send(writer, createNormalizedMessage({
        kind: 'error',
        provider: 'codex',
        sessionId: threadId || appSessionId,
        content: message,
      }));
      send(writer, createCompleteMessage({
        provider: 'codex',
        sessionId: threadId || appSessionId,
        exitCode: 1,
      }));
    }
  } finally {
    unsubscribe();
    unsubscribeRequests();
    unsubscribeExit();
    clearApprovalsForClient(client, writer);
    client.close();
    if (appSessionId) {
      activeAppServerRuns.delete(appSessionId);
    }
  }
}

function resolveCodexApproval(requestId: string, decision: ProviderPermissionDecision): void {
  const approval = pendingCodexApprovals.get(requestId);
  if (!approval) {
    return;
  }
  pendingCodexApprovals.delete(requestId);
  if (approval.kind === 'userInput') {
    const updatedInput = decision.updatedInput && typeof decision.updatedInput === 'object'
      ? decision.updatedInput as AnyRecord
      : {};
    const submittedAnswers = updatedInput.answers && typeof updatedInput.answers === 'object'
      ? updatedInput.answers as Record<string, unknown>
      : {};
    const answers = Object.fromEntries((approval.questions || []).map((question) => {
      const answer = submittedAnswers[question.question];
      const values = typeof answer === 'string' && answer.trim()
        ? answer.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
      return [question.id, { answers: values }];
    }));
    approval.client.respond(approval.rpcRequestId, { answers });
    return;
  }
  approval.client.respond(approval.rpcRequestId, {
    decision: decision.allow
      ? (decision.rememberEntry ? 'acceptForSession' : 'accept')
      : 'decline',
  });
}

function listCodexApprovals(sessionId: string): unknown[] {
  return [...pendingCodexApprovals.values()]
    .filter((approval) => approval.sessionId === sessionId)
    .map((approval) => approval.message);
}

async function runCodex(
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<unknown> {
  const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
  const nativeCommand = parseCodexNativeCommand(command);

  if (nativeCommand?.kind === 'plan') {
    if (!nativeCommand.prompt) {
      const enabled = !planModeSessions.has(appSessionId);
      if (enabled) {
        planModeSessions.add(appSessionId);
      } else {
        planModeSessions.delete(appSessionId);
      }
      sendText(writer, appSessionId, `Plan mode ${enabled ? 'enabled' : 'disabled'}.`);
      send(writer, createCompleteMessage({ provider: 'codex', sessionId: appSessionId, exitCode: 0 }));
      return undefined;
    }
    planModeSessions.add(appSessionId);
    return runThroughAppServer(nativeCommand.prompt, 'plan', options, writer, context);
  }

  if (nativeCommand?.kind === 'review') {
    return runThroughAppServer(nativeCommand.prompt, 'review', options, writer, context);
  }
  if (nativeCommand?.kind === 'compact') {
    return runThroughAppServer('', 'compact', options, writer, context);
  }
  if (appSessionId && planModeSessions.has(appSessionId)) {
    return runThroughAppServer(command, 'plan', options, writer, context);
  }

  return sdkCodexRuntime.run(command, options, writer, context);
}

async function abortCodex(sessionId: string): Promise<boolean> {
  const activeRun = activeAppServerRuns.get(sessionId);
  if (!activeRun) {
    return sdkCodexRuntime.abort(sessionId);
  }

  activeRun.aborted = true;
  if (activeRun.turnId) {
    try {
      await activeRun.client.request('turn/interrupt', {
        threadId: activeRun.threadId,
        turnId: activeRun.turnId,
      });
    } catch {
      // Closing the process below is the fallback cancellation mechanism.
    }
  }
  activeRun.finishAbort();
  activeRun.client.close();
  return true;
}

/** Runtime consumed by CodexProvider to add app-server slash-command semantics. */
export const codexNativeRuntime: IProviderRuntime = {
  run: runCodex,
  abort: abortCodex,
  permissions: {
    resolve: resolveCodexApproval,
    listPending: listCodexApprovals,
  },
};
