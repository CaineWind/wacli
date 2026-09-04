import type { ITerminalOptions } from '@xterm/xterm';

import type { ShellMode } from '../types/types';

export const SHELL_RESTART_DELAY_MS = 200;
export const TERMINAL_INIT_DELAY_MS = 100;
export const TERMINAL_RESIZE_DELAY_MS = 50;
export const TERMINAL_MOBILE_BREAKPOINT_PX = 768;
export const HERDR_NARROW_MOBILE_BREAKPOINT_PX = 480;
export const HERDR_NARROW_MOBILE_FONT_SIZE = 9;
export const HERDR_MOBILE_FONT_SIZE = 12;
export const HERDR_FONT_FAMILY = '"JetBrainsMono Nerd Font Mono", monospace';
export const HERDR_MOUSE_TRACKING_SEQUENCE = '\x1b[?1002h\x1b[?1006h';

// CLI prompt overlay detection
export const PROMPT_DEBOUNCE_MS = 500;
export const PROMPT_BUFFER_SCAN_LINES = 20;
export const PROMPT_OPTION_SCAN_LINES = 15;
export const PROMPT_MAX_OPTIONS = 5;
export const PROMPT_MIN_OPTIONS = 2;

export const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  allowProposedApi: true,
  allowTransparency: false,
  convertEol: true,
  scrollback: 10000,
  tabStopWidth: 4,
  windowsMode: false,
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  // Keep the runtime theme keys used by the previous JSX implementation.
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
    extendedAnsi: [
      '#000000',
      '#800000',
      '#008000',
      '#808000',
      '#000080',
      '#800080',
      '#008080',
      '#c0c0c0',
      '#808080',
      '#ff0000',
      '#00ff00',
      '#ffff00',
      '#0000ff',
      '#ff00ff',
      '#00ffff',
      '#ffffff',
    ],
  },
};

export function canApplyResponsiveTerminalFontSize(
  currentFontSize: number | undefined,
  responsiveFontSize: number | undefined,
  hasManualOverride: boolean,
): boolean {
  return !hasManualOverride && currentFontSize === responsiveFontSize;
}

export function getTerminalOptions(
  shellMode: ShellMode = 'default',
  viewportWidth = Number.POSITIVE_INFINITY,
): ITerminalOptions {
  if (shellMode !== 'herdr') {
    return { ...TERMINAL_OPTIONS };
  }

  return {
    ...TERMINAL_OPTIONS,
    fontFamily: HERDR_FONT_FAMILY,
    fontSize: viewportWidth <= HERDR_NARROW_MOBILE_BREAKPOINT_PX
      ? HERDR_NARROW_MOBILE_FONT_SIZE
      : viewportWidth < TERMINAL_MOBILE_BREAKPOINT_PX
        ? HERDR_MOBILE_FONT_SIZE
        : TERMINAL_OPTIONS.fontSize,
    convertEol: false,
    cursorBlink: false,
    scrollback: 0,
    theme: {
      ...TERMINAL_OPTIONS.theme,
      cursor: 'rgba(0, 0, 0, 0)',
      cursorAccent: 'rgba(0, 0, 0, 0)',
    },
  };
}
