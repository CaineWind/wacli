# Releasing wacli

The `wind-agent-cli` package is published by `.github/workflows/release.yml`.
The workflow uses npm trusted publishing (OIDC), so the repository does not
store a long-lived npm token.

## One-time npm setup

The npm package must trust the GitHub workflow:

```sh
npm trust github wind-agent-cli --file release.yml --repo CaineWind/wacli --allow-publish --yes
```

## Create a release

1. Start from a clean, up-to-date `main` branch.
2. Create the version commit and tag:

   ```sh
   npm run release -- patch
   ```

   Use `minor`, `major`, or an explicit semantic version when appropriate.

3. Review the generated version and changelog commit.
4. Push the commit and tag:

   ```sh
   git push origin main --follow-tags
   ```

The tag must exactly match the package version, for example package version
`1.38.0` requires tag `v1.38.0`. The release workflow reruns every quality gate,
publishes the package with provenance, verifies the registry version, creates a
GitHub Release, and attaches the packed `.tgz` artifact.

Rerunning a partially completed release is safe: an existing npm version is
verified and skipped, while the GitHub Release artifact is uploaded again.
