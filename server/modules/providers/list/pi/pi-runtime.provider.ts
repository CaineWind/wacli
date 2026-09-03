import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

import spawn from 'cross-spawn';

import {
  appendFilesInputTag,
  isAllowedImageSourcePath,
  normalizeImageDescriptors,
  resolveImageAbsolutePath,
  resolveImageMediaType,
} from '@/shared/image-attachments.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage, findTopmostGitRoot } from '@/shared/utils.js';

type PiChild = ReturnType<typeof spawn> & { aborted?: boolean };

const activePiProcesses = new Map<string, PiChild>();
const ABORT_GRACE_MS = 500;

const formatError = (value: unknown): string => value instanceof Error ? value.message : String(value);

async function buildPiImages(images: unknown, cwd: string): Promise<Array<{
  type: 'image';
  data: string;
  mimeType: string;
}>> {
  const result: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  for (const descriptor of normalizeImageDescriptors(images)) {
    const mimeType = resolveImageMediaType(descriptor);
    const resolvedPath = resolveImageAbsolutePath(cwd, descriptor.path);
    if (!mimeType?.startsWith('image/') || !isAllowedImageSourcePath(resolvedPath, cwd)) continue;
    try {
      const canonicalPath = await fs.realpath(resolvedPath);
      if (!isAllowedImageSourcePath(canonicalPath, cwd)) continue;
      result.push({
        type: 'image',
        data: (await fs.readFile(canonicalPath)).toString('base64'),
        mimeType,
      });
    } catch (error) {
      console.warn(`[Pi] Unable to attach image ${descriptor.path}: ${formatError(error)}`);
    }
  }
  return result;
}

async function collectProjectSkillArgs(cwd: string): Promise<string[]> {
  const skillDirs = [path.join(cwd, '.pi', 'skills')];
  const repoRoot = await findTopmostGitRoot(cwd);
  let current = path.resolve(cwd);
  while (true) {
    skillDirs.push(path.join(current, '.agents', 'skills'));
    if (!repoRoot || current === path.resolve(repoRoot)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return skillDirs.filter(existsSync).flatMap((directory) => ['--skill', directory]);
}

const readTokenBudget = (event: AnyRecord): AnyRecord | null => {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const usage = (message as AnyRecord).usage;
    if (!usage || typeof usage !== 'object') continue;
    const record = usage as AnyRecord;
    input += Number(record.input ?? 0);
    output += Number(record.output ?? 0);
    cacheRead += Number(record.cacheRead ?? 0);
    cacheWrite += Number(record.cacheWrite ?? 0);
  }
  const used = input + output + cacheRead + cacheWrite;
  return used > 0 ? {
    used,
    inputTokens: input + cacheRead,
    outputTokens: output,
    breakdown: { input: input + cacheRead, output },
  } : null;
};

/** Starts one isolated Pi RPC process for a single chat.send operation. */
export async function runPi(
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<void> {
  const sessionId = typeof options.sessionId === 'string' && options.sessionId.trim()
    ? options.sessionId.trim()
    : crypto.randomUUID();
  const workingDir = typeof options.cwd === 'string' && options.cwd.trim()
    ? options.cwd
    : typeof options.projectPath === 'string' && options.projectPath.trim()
      ? options.projectPath
      : process.cwd();
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const resolvedModel = await context.resolveResumeModel(
    sessionId,
    typeof options.model === 'string' ? options.model : undefined,
  );
  const args = ['--mode', 'rpc', '--no-approve'];
  if (providerSessionId) args.push('--session', providerSessionId);
  else args.push('--session-id', sessionId);
  if (resolvedModel) {
    const slash = resolvedModel.indexOf('/');
    if (slash > 0) args.push('--provider', resolvedModel.slice(0, slash));
    args.push('--model', resolvedModel);
  }
  if (typeof options.effort === 'string' && options.effort !== 'default') {
    args.push('--thinking', options.effort);
  }
  args.push(...await collectProjectSkillArgs(workingDir));

  const images = await buildPiImages(options.images, workingDir);
  const prompt = appendFilesInputTag(command?.trim() ?? '', options.files);

  await new Promise<void>((resolve, reject) => {
    let child: PiChild;
    let stdoutBuffer = '';
    let stderr = '';
    let terminalSent = false;
    let settled = false;
    let agentEnded = false;
    let protocolError: Error | null = null;

    const cleanup = () => {
      if (activePiProcesses.get(sessionId) === child) activePiProcesses.delete(sessionId);
    };
    const settle = (exitCode: number, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!terminalSent && !child.aborted) {
        terminalSent = true;
        writer.send(createCompleteMessage({ provider: 'pi', sessionId, exitCode }));
      }
      if (error) reject(error);
      else resolve();
    };
    const emitError = (message: string) => writer.send(createNormalizedMessage({
      kind: 'error', provider: 'pi', sessionId, content: message,
    }));
    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: AnyRecord;
      try {
        event = JSON.parse(line) as AnyRecord;
      } catch {
        protocolError = new Error('Pi RPC returned invalid JSONL output.');
        emitError(protocolError.message);
        child.stdin?.end();
        setTimeout(() => { if (child.exitCode === null) child.kill(); }, ABORT_GRACE_MS).unref();
        return;
      }
      if (event.type === 'response' && event.success === false) {
        protocolError = new Error(
          typeof event.error === 'string' ? event.error : 'Pi rejected the RPC request.',
        );
        emitError(protocolError.message);
        child.stdin?.end();
        setTimeout(() => { if (child.exitCode === null) child.kill(); }, ABORT_GRACE_MS).unref();
        return;
      }
      for (const message of context.normalizeMessage(event, sessionId)) writer.send(message);
      if (event.type === 'agent_end' && event.willRetry !== true) {
        agentEnded = true;
        const tokenBudget = readTokenBudget(event);
        if (tokenBudget) writer.send(createNormalizedMessage({
          kind: 'status', provider: 'pi', sessionId, text: 'token_budget', tokenBudget,
        }));
        if (!terminalSent) {
          terminalSent = true;
          writer.send(createCompleteMessage({ provider: 'pi', sessionId, exitCode: 0 }));
        }
        child.stdin?.end();
        setTimeout(() => {
          if (child.exitCode === null) child.kill();
        }, ABORT_GRACE_MS).unref();
      }
    };

    try {
      child = spawn('pi', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
      }) as PiChild;
    } catch (error) {
      const wrapped = new Error(`Unable to start Pi CLI: ${formatError(error)}`);
      emitError(wrapped.message);
      reject(wrapped);
      return;
    }

    activePiProcesses.set(sessionId, child);
    writer.setSessionId?.(sessionId);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      const wrapped = new Error(`Pi CLI failed: ${error.message}`);
      emitError(wrapped.message);
      settle(1, wrapped);
    });
    child.on('close', (code) => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      if (settled) {
        cleanup();
        return;
      }
      if (child.aborted) {
        settle(0);
        return;
      }
      if (agentEnded) {
        settle(0);
        return;
      }
      if (protocolError) {
        settle(1, protocolError);
        return;
      }
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        const message = stderr.trim() || `Pi CLI exited with code ${exitCode}.`;
        emitError(message);
        settle(exitCode, new Error(message));
      } else {
        const error = new Error('Pi RPC exited before emitting agent_end.');
        emitError(error.message);
        settle(1, error);
      }
    });
    child.stdin?.write(`${JSON.stringify({
      id: `prompt-${sessionId}`,
      type: 'prompt',
      message: prompt,
      ...(images.length > 0 ? { images } : {}),
    })}\n`);
  });
}

/** Sends Pi's RPC abort command, then force-terminates an unresponsive child. */
export function abortPiSession(sessionId: string): boolean {
  const child = activePiProcesses.get(sessionId);
  if (!child) return false;
  child.aborted = true;
  try {
    child.stdin?.write(`${JSON.stringify({ id: `abort-${sessionId}`, type: 'abort' })}\n`);
  } catch {
    child.kill();
  }
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, ABORT_GRACE_MS).unref();
  activePiProcesses.delete(sessionId);
  return true;
}

export const piRuntime = { run: runPi, abort: abortPiSession };
