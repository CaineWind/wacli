import { readFile } from 'node:fs/promises';

const manifestPath = new URL('../dist/manifest.webmanifest', import.meta.url);
const serviceWorkerPath = new URL('../dist/sw.js', import.meta.url);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const serviceWorker = await readFile(serviceWorkerPath, 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(`PWA build verification failed: ${message}`);
};

const assertPng = async (relativePath) => {
  const file = await readFile(new URL(`../dist/${relativePath}`, import.meta.url));
  assert(file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${relativePath} is not a PNG file`);
};

assert(manifest.name === 'WindCli', 'manifest name must be WindCli');
assert(manifest.display === 'standalone', 'manifest must use standalone display mode');
assert(manifest.start_url === '.', 'manifest start_url must remain deployment-relative');
assert(manifest.scope === '.', 'manifest scope must remain deployment-relative');

for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']]) {
  const icon = manifest.icons?.find((candidate) => candidate.sizes === size && candidate.purpose === purpose);
  assert(icon?.type === 'image/png', `missing ${size} ${purpose} PNG icon`);
  await assertPng(icon.src);
}

assert(manifest.screenshots?.some((screenshot) => screenshot.form_factor === 'wide'), 'missing wide screenshot');
assert(manifest.screenshots?.some((screenshot) => screenshot.form_factor === 'narrow'), 'missing narrow screenshot');
assert(manifest.screenshots.every((screenshot) => screenshot.type === 'image/png'), 'screenshots must be PNG files');
await Promise.all(manifest.screenshots.map((screenshot) => assertPng(screenshot.src)));
assert(serviceWorker.includes('push-sw.js'), 'push notification worker is not imported');
assert(serviceWorker.includes('SKIP_WAITING'), 'prompted service-worker updates are not supported');
assert(serviceWorker.includes('plugin-ws'), 'navigation fallback denylist is missing server routes');

console.log(`PWA build verified: ${manifest.icons.length} icons, ${manifest.screenshots.length} screenshots`);
