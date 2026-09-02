# Dependency governance

## Required gates

Every pull request must pass both dependency audits:

- npm run audit:production
- npm run audit:all

Both commands use an audit threshold of low, so any reported vulnerability
fails CI. Dependency install scripts are version-pinned in allowScripts, and
CI installs with npm 12's strict-allow-scripts policy.

## Tracked upstream deprecations

Last reviewed: 2026-09-02

A clean development install emits five deprecation notices from the latest
stable Electron Builder 26 release:

| Deprecated package | Dependency path |
| --- | --- |
| glob 7.2.3 and inflight 1.0.6 | electron-builder > app-builder-lib > @electron/asar |
| boolean 3.2.0 | electron-builder > app-builder-lib > @electron/get > global-agent |
| rimraf 2.6.3, glob 7.2.3, and inflight 1.0.6 | electron-builder > app-builder-lib > electron-builder-squirrel-windows > electron-winstaller > temp |

These packages are development-only desktop packaging dependencies. They are
not present in the published production dependency tree, and npm audit reports
zero vulnerabilities for both production and development trees.

Electron Builder 27 updates the first two paths but is currently prerelease and
still retains the electron-winstaller > temp path. Do not override these
transitive packages across major versions: their APIs are not compatible.
Remove this exception when a stable Electron Builder release replaces the
listed paths, and verify both Windows NSIS and macOS DMG builds when upgrading.
