import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import '@/i18n/config.js';

import QuickSettingsHandle from './QuickSettingsHandle';

test('quick settings handle stays out of the mobile terminal viewport', () => {
  const markup = renderToStaticMarkup(
    <QuickSettingsHandle
      isOpen={false}
      isDragging={false}
      hideOnMobile
      style={{ top: '50%' }}
      onClick={() => {}}
      onMouseDown={() => {}}
      onTouchStart={() => {}}
    />,
  );

  assert.match(markup, /hidden/);
  assert.match(markup, /md:block/);
});

test('quick settings handle remains available on other mobile views', () => {
  const markup = renderToStaticMarkup(
    <QuickSettingsHandle
      isOpen={false}
      isDragging={false}
      style={{ top: '50%' }}
      onClick={() => {}}
      onMouseDown={() => {}}
      onTouchStart={() => {}}
    />,
  );

  assert.doesNotMatch(markup, /md:block/);
});
