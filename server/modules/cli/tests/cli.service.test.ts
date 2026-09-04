import assert from 'node:assert/strict';
import test from 'node:test';

import type { CliEnvironment, CliOutput } from '@/shared/types.js';

import { createCliService } from '../cli.service.js';

type HarnessOptions = {
  currentVersion?: string;
  latestVersion?: string;
  latestVersionError?: Error;
  updateError?: Error;
};

function createHarness(options: HarnessOptions = {}) {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  const environment: CliEnvironment = {};
  const output: CliOutput = {
    log: (message = '') => logMessages.push(message),
    error: (message = '') => errorMessages.push(message),
  };
  let serverStarts = 0;
  let sandboxArguments: string[] = [];
  let updatedVersion: string | null = null;
  const service = createCliService({
    applicationRoot: '/application',
    defaultDatabasePath: '/home/user/.cloudcli/auth.db',
    homeDirectory: '/home/user',
    packageMetadata: {
      version: options.currentVersion ?? '1.2.3',
      homepage: 'https://cloudcli.example',
      bugsUrl: 'https://cloudcli.example/issues',
    },
    environment,
    fileSystem: {
      pathExists: () => false,
      getFileStats: () => ({ size: 0, modifiedAt: new Date(0) }),
    },
    output,
    sandboxService: {
      execute: async (argumentsList) => {
        sandboxArguments = argumentsList;
        return 7;
      },
    },
    getLatestPackageVersion: async () => {
      if (options.latestVersionError) {
        throw options.latestVersionError;
      }
      return options.latestVersion ?? '1.2.3';
    },
    updateGlobalPackage: (version) => {
      updatedVersion = version;
      if (options.updateError) {
        throw options.updateError;
      }
    },
    startServer: async () => {
      serverStarts += 1;
    },
    startBrowserUseMcp: async () => undefined,
  });

  return {
    service,
    environment,
    logMessages,
    errorMessages,
    getServerStarts: () => serverStarts,
    getSandboxArguments: () => sandboxArguments,
    getUpdatedVersion: () => updatedVersion,
  };
}

test('applies CLI options to the injected environment before starting the server', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run([
    '--port',
    '8080',
    '--database-path=/data/app.db',
  ]);

  assert.equal(exitCode, 0);
  assert.equal(harness.environment.SERVER_PORT, '8080');
  assert.equal(harness.environment.DATABASE_PATH, '/data/app.db');
  assert.equal(harness.getServerStarts(), 1);
});

test('passes only sandbox arguments to the injected sandbox service', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['sandbox', 'ls']);

  assert.equal(exitCode, 7);
  assert.deepEqual(harness.getSandboxArguments(), ['ls']);
});

test('shows wacli as the installed command', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['help']);

  assert.equal(exitCode, 0);
  assert.match(harness.logMessages.join('\n'), /wacli \[command\] \[options\]/);
  assert.match(harness.logMessages.join('\n'), /\$ wacli status/);
  assert.match(harness.logMessages.join('\n'), /\$ wacli update/);
});

test('updates the global package to the exact latest version', async () => {
  const harness = createHarness({ latestVersion: '2.0.0' });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getUpdatedVersion(), '2.0.0');
  assert.match(harness.logMessages.join('\n'), /Updated 1\.2\.3 -> 2\.0\.0/);
});

test('does not reinstall the package when already on the latest version', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getUpdatedVersion(), null);
  assert.match(harness.logMessages.join('\n'), /Already on the latest version \(1\.2\.3\)/);
});

test('updates a prerelease installation to the latest stable version', async () => {
  const harness = createHarness({
    currentVersion: '1.2.3-beta.1',
    latestVersion: '1.2.3',
  });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 0);
  assert.equal(harness.getUpdatedVersion(), '1.2.3');
  assert.match(harness.logMessages.join('\n'), /Updated 1\.2\.3-beta\.1 -> 1\.2\.3/);
});

test('returns a failure code when the latest version cannot be checked', async () => {
  const harness = createHarness({ latestVersionError: new Error('registry unavailable') });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 1);
  assert.equal(harness.getUpdatedVersion(), null);
  assert.match(harness.errorMessages.join('\n'), /Could not check for updates: registry unavailable/);
});

test('returns a failure code and recovery command when installation fails', async () => {
  const harness = createHarness({
    latestVersion: '2.0.0',
    updateError: new Error('permission denied'),
  });

  const exitCode = await harness.service.run(['update']);

  assert.equal(exitCode, 1);
  assert.equal(harness.getUpdatedVersion(), '2.0.0');
  assert.match(harness.errorMessages.join('\n'), /Update failed: permission denied/);
  assert.match(harness.logMessages.join('\n'), /npm install --global wind-agent-cli@2\.0\.0/);
});

test('returns a failure code for an unknown command without exiting the process', async () => {
  const harness = createHarness();

  const exitCode = await harness.service.run(['unknown']);

  assert.equal(exitCode, 1);
  assert.match(harness.errorMessages[0], /Unknown command: unknown/);
});
