// pattern: Functional Core — Catppuccin Macchiato colour palette and TUI styling helpers

export const palette = {
  rosewater: '#f4dbd6',
  flamingo: '#f0c6c6',
  pink: '#f5bde6',
  mauve: '#c6a0f6',
  red: '#ed8796',
  maroon: '#ee99a0',
  peach: '#f5a97f',
  yellow: '#eed49f',
  green: '#a6da95',
  teal: '#8bd5ca',
  sky: '#91d7e3',
  sapphire: '#7dc4e4',
  blue: '#8aadf4',
  lavender: '#b7bdf8',
  text: '#cad3f5',
  subtext1: '#b8c0e0',
  subtext0: '#a5adcb',
  overlay2: '#939ab7',
  overlay1: '#8087a2',
  overlay0: '#6e738d',
  surface2: '#5b6078',
  surface1: '#494d64',
  surface0: '#363a4f',
  base: '#24273a',
  mantle: '#1e2030',
  crust: '#181926',
} as const;

export const theme = {
  accent: palette.mauve,
  accentAlt: palette.lavender,
  heading: palette.mauve,
  selected: palette.mauve,
  cursor: palette.mauve,
  prompt: palette.mauve,

  userMsg: palette.lavender,
  agentMsg: palette.green,
  systemMsg: palette.yellow,
  error: palette.red,
  warning: palette.peach,
  success: palette.green,

  body: palette.text,
  muted: palette.overlay1,
  dim: palette.overlay0,
  separator: palette.surface2,

  statusKey: palette.mauve,
  statusLabel: palette.overlay1,
  statusSep: palette.surface1,

  tabActive: palette.mauve,
  tabInactive: palette.overlay0,

  grantOk: palette.green,
  grantPending: palette.yellow,
  grantRevoked: palette.red,

  taskOn: palette.green,
  taskOff: palette.overlay0,

  spinner: palette.pink,
} as const;

// Blessed style object type for neo-blessed compatibility
export type BlessedStyle = {
  readonly fg: string;
  readonly bg?: string;
  readonly bold?: boolean;
};

// Blessed-compatible style objects mapped from theme colors
export const blessedStyles = {
  userMsg: { fg: palette.lavender, bold: true } as BlessedStyle,
  agentMsg: { fg: palette.green, bold: true } as BlessedStyle,
  systemMsg: { fg: palette.yellow } as BlessedStyle,
  accent: { fg: palette.mauve, bold: true } as BlessedStyle,
  heading: { fg: palette.mauve, bold: true } as BlessedStyle,
  selected: { fg: palette.base, bg: palette.mauve } as BlessedStyle,
  error: { fg: palette.red, bold: true } as BlessedStyle,
  warning: { fg: palette.peach } as BlessedStyle,
  success: { fg: palette.green } as BlessedStyle,
  tabActive: { fg: palette.base, bg: palette.mauve, bold: true } as BlessedStyle,
  tabInactive: { fg: palette.overlay0 } as BlessedStyle,
  border: { fg: palette.surface1 } as BlessedStyle,
  text: { fg: palette.text } as BlessedStyle,
  subtext: { fg: palette.subtext0 } as BlessedStyle,
  surface: { bg: palette.base } as BlessedStyle,
  grantOk: { fg: palette.green, bold: true } as BlessedStyle,
  grantPending: { fg: palette.yellow } as BlessedStyle,
  grantRevoked: { fg: palette.red } as BlessedStyle,
  spinner: { fg: palette.pink } as BlessedStyle,
} as const;

export function separator(width: number): string {
  return '─'.repeat(Math.max(20, width));
}

export type KeyChip = {
  readonly key: string;
  readonly label: string;
};

export function formatKeyChips(chips: ReadonlyArray<KeyChip>): ReadonlyArray<{ key: string; label: string; sep: string }> {
  return chips.map((chip, i) => ({
    key: chip.key,
    label: chip.label,
    sep: i < chips.length - 1 ? ' │ ' : '',
  }));
}
