import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

import crossSpawn from 'cross-spawn';

import type {
  CodexAppServerExit,
  CodexAppServerNotification,
  CodexAppServerRequest,
} from '@/shared/types.js';

type JsonRpcId = number;

type JsonRpcMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type AppServerProcessFactory = () => ChildProcessWithoutNullStreams;

/**
 * Small JSON-RPC client for one Codex app-server process.
 *
 * The native runtime owns each instance for the duration of one operation and
 * subscribes to notifications through `onNotification`.
 */
export class CodexAppServerClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<(event: CodexAppServerNotification) => void>();
  private readonly requestListeners = new Set<(event: CodexAppServerRequest) => boolean>();
  private readonly exitListeners = new Set<(event: CodexAppServerExit) => void>();
  private nextRequestId = 1;
  private stderr = '';
  private closed = false;
  private exitReported = false;

  private constructor(processHandle: ChildProcessWithoutNullStreams) {
    this.process = processHandle;

    const stdoutLines = readline.createInterface({
      input: processHandle.stdout,
      crlfDelay: Infinity,
    });
    stdoutLines.on('line', (line) => this.handleLine(line));

    processHandle.stderr.on('data', (chunk: Buffer | string) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-8_000);
    });
    processHandle.once('error', (error) => this.reportExit(error));
    processHandle.once('exit', (code, signal) => {
      this.closed = true;
      const detail = this.stderr.trim();
      const suffix = detail ? `: ${detail}` : '';
      this.reportExit(new Error(`Codex app-server exited (${code ?? signal ?? 'unknown'})${suffix}`));
    });
  }

  /** Starts Codex app-server and completes the required initialization handshake. */
  static async start(processFactory?: AppServerProcessFactory): Promise<CodexAppServerClient> {
    const executable = process.env.CODEX_CLI_PATH?.trim() || 'codex';
    const processHandle = processFactory?.() ?? (
      crossSpawn(executable, ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams
    );
    const client = new CodexAppServerClient(processHandle);

    await client.request('initialize', {
      clientInfo: {
        name: 'cloudcli',
        title: 'CloudCLI',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    client.notify('initialized');
    return client;
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server is closed'));
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (!this.closed) {
      this.write({ method, params });
    }
  }

  onNotification(listener: (event: CodexAppServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(listener: (event: CodexAppServerRequest) => boolean): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onExit(listener: (event: CodexAppServerExit) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  respond(id: number, result: unknown): void {
    if (!this.closed) {
      this.write({ id, result });
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.process.stdin.end();
    this.process.kill();
    this.rejectPending(new Error('Codex app-server was closed'));
  }

  private write(message: JsonRpcMessage): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return;
    }

    if (typeof message.id === 'number' && !message.method) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'Codex app-server request failed'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method && typeof message.id === 'number') {
      const request = {
        id: message.id,
        method: message.method,
        params: (message.params && typeof message.params === 'object'
          ? message.params
          : {}) as Record<string, any>,
      };
      if ([...this.requestListeners].some((listener) => listener(request))) {
        return;
      }
      this.write({
        id: message.id,
        error: {
          code: -32601,
          message: `CloudCLI does not handle app-server request ${message.method}`,
        },
      });
      return;
    }

    if (message.method) {
      const event = {
        method: message.method,
        params: (message.params && typeof message.params === 'object'
          ? message.params
          : {}) as Record<string, any>,
      };
      for (const listener of this.notificationListeners) {
        listener(event);
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private reportExit(error: Error): void {
    if (this.exitReported) {
      return;
    }
    this.exitReported = true;
    this.rejectPending(error);
    for (const listener of this.exitListeners) {
      listener({ error });
    }
  }
}
