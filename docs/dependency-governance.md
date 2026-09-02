# Dependency governance

## Required gates

Every pull request must pass both dependency audits:

- npm run audit:production
- npm run audit:all

Both commands use an audit threshold of low, so any reported vulnerability
fails CI. Dependency install scripts are version-pinned in allowScripts, and
CI installs with npm 12's strict-allow-scripts policy.

## Security overrides

`@humanfs/node` is pinned to `0.16.8` through `package.json` overrides until
ESLint adopts that patched release directly. This prevents GHSA-p498-v437-472g
in the development dependency tree. Remove the override after the direct
dependency constraint resolves to `0.16.8` or newer, then rerun both audits.

## Tracked upstream deprecations

Last reviewed: 2026-09-02

A clean development install emits six deprecation notices from current stable
build tooling:

| Deprecated package | Dependency path |
| --- | --- |
| glob 7.2.3 and inflight 1.0.6 | electron-builder > app-builder-lib > @electron/asar |
| boolean 3.2.0 | electron-builder > app-builder-lib > @electron/get > global-agent |
| rimraf 2.6.3, glob 7.2.3, and inflight 1.0.6 | electron-builder > app-builder-lib > electron-builder-squirrel-windows > electron-winstaller > temp |
| glob 11.1.0 | vite-plugin-pwa > workbox-build |

These packages are development-only desktop or PWA build dependencies. They
are not present in the published production dependency tree, and npm audit
reports zero vulnerabilities for both production and development trees.

Electron Builder 27 updates the first two paths but is currently prerelease and
still retains the electron-winstaller > temp path. Do not override these
transitive packages across major versions: their APIs are not compatible.
Remove this exception when a stable Electron Builder release replaces the
listed paths, and verify both Windows NSIS and macOS DMG builds when upgrading.
