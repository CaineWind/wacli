import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { CliApplication, CliPackageMetadata } from '@/shared/types.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createCliService } from './cli.service.js';
import { createSandboxCommandService } from './sandbox.service.js';

function runNpmCommand(argumentsList: string[], inheritOutput = false): string {
  const result = spawn.sync('npm', argumentsList, {
    encoding: 'utf8',
    stdio: inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(stderr || `npm exited with status ${result.status ?? 'unknown'}`);
  }

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

/**
 * Creates the production CLI application for the executable entrypoint. This is
 * the CLI module's single composition root: it reads package metadata and wires
 * all concrete Node filesystem, subprocess, environment, clock, and module-start
 * adapters before passing them into otherwise isolated services.
 */
export function createCliApplication(): CliApplication {
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
  const packageMetadataJson = JSON.parse(
    fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'),
  ) as { version: string; homepage?: string; bugs?: { url?: string } };
  const packageMetadata: CliPackageMetadata = {
    version: packageMetadataJson.version,
    homepage: packageMetadataJson.homepage,
    bugsUrl: packageMetadataJson.bugs?.url,
  };
  const fileSystem = {
    pathExists: (filePath: string) => fs.existsSync(filePath),
    getFileStats: (filePath: string) => {
      const stats = fs.statSync(filePath);
      return { size: stats.size, modifiedAt: stats.mtime };
    },
  };
  const output = {
    log: (message?: string) => console.log(message),
    error: (message?: string) => console.error(message),
  };
  const homeDirectory = os.homedir();
  const sandboxService = createSandboxCommandService({
    homeDirectory,
    fileSystem,
    output,
    runSandboxCommand: (argumentsList, inheritOutput = false) => {
      const result = execFileSync('sbx', argumentsList, {
        encoding: 'utf8',
        stdio: inheritOutput ? 'inherit' : 'pipe',
      });
      return result || '';
    },
    spawnDetachedSandbox: (argumentsList) => {
      const childProcess = spawn('sbx', argumentsList, {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      childProcess.unref();
    },
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });

  return createCliService({
    applicationRoot,
    defaultDatabasePath: path.join(homeDirectory, '.cloudcli', 'auth.db'),
    homeDirectory,
    packageMetadata,
    environment: process.env,
    fileSystem,
    output,
    sandboxService,
    getLatestPackageVersion: async () => {
      // Yield first so the default `start` command can begin loading the server
      // before this best-effort npm registry check runs.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const output = runNpmCommand([
        'view',
        'wind-agent-cli@latest',
        'version',
        '--json',
      ]);
      const version = JSON.parse(output) as unknown;
      if (typeof version !== 'string' || !version.trim()) {
        throw new Error('npm returned an invalid latest version');
      }
      return version.trim();
    },
    updateGlobalPackage: (version) => {
      runNpmCommand([
        'install',
        '--global',
        `wind-agent-cli@${version}`,
      ], true);
    },
    startServer: async () => {
      // The server executable is an entrypoint rather than a feature module,
      // so it has no barrel contract to import through.
      // eslint-disable-next-line boundaries/no-unknown
      await import('../../index.js');
    },
    startBrowserUseMcp: async () => {
      const { startBrowserUseMcp } = await import('../browser-use/index.js');
      await startBrowserUseMcp();
    },
  });
}
