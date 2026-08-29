import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import MainContentHeaderRow from './MainContentHeaderRow';

test('renders the global mobile header as a single row with leading content first', () => {
  const html = renderToStaticMarkup(
    <MainContentHeaderRow hasSelectedProject={false}>
      <span data-slot="menu">Menu</span>
      <span data-slot="herdr">Herdr</span>
    </MainContentHeaderRow>,
  );

  assert.match(html, /flex-row/);
  assert.match(html, /justify-between/);
  assert.doesNotMatch(html, /flex-col/);
  assert.ok(html.indexOf('data-slot="menu"') < html.indexOf('data-slot="herdr"'));
});

test('keeps project headers stacked below the desktop breakpoint', () => {
  const html = renderToStaticMarkup(
    <MainContentHeaderRow hasSelectedProject>
      <span>Project</span>
      <span>Tabs</span>
    </MainContentHeaderRow>,
  );

  assert.match(html, /flex-col/);
  assert.match(html, /sm:flex-row/);
});
