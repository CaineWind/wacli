import assert from 'node:assert/strict';
import test from 'node:test';

import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ShellMinimalView from './ShellMinimalView';

test('reserves mobile space for terminal shortcuts and the safe area', () => {
  const html = renderToStaticMarkup(
    <ShellMinimalView terminalContainerRef={createRef<HTMLDivElement>()} />,
  );

  assert.match(html, /absolute/);
  assert.match(html, /bottom-\[calc\(3\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(html, /md:bottom-0/);
});
