import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';
import type { Terminal } from '@xterm/xterm';

import '@/i18n/config.js';

import TerminalShortcutsPanel from './TerminalShortcutsPanel';

test('renders a touch-friendly scrolling shortcut bar inside mobile safe areas', () => {
  const html = renderToStaticMarkup(
    <TerminalShortcutsPanel
      wsRef={{ current: null }}
      terminalRef={{ current: null as Terminal | null }}
      isConnected
    />,
  );

  assert.match(html, /safe-area-inset-left/);
  assert.match(html, /safe-area-inset-right/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /min-h-10/);
  assert.match(html, /h-10 w-10/);
  assert.ok((html.match(/<button/g) ?? []).length >= 10);
});
