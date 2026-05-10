// pattern: Functional Core — syntax highlighting with Catppuccin Macchiato theme

import chalk from 'chalk';
import { highlight, supportsLanguage } from 'cli-highlight';
import { palette } from './theme.ts';

chalk.level = 3;

const codeTheme = {
  keyword: chalk.hex(palette.mauve),
  built_in: chalk.hex(palette.teal),
  type: chalk.hex(palette.blue),
  literal: chalk.hex(palette.peach),
  number: chalk.hex(palette.peach),
  regexp: chalk.hex(palette.pink),
  string: chalk.hex(palette.green),
  subst: chalk.hex(palette.flamingo),
  class: chalk.hex(palette.yellow),
  function: chalk.hex(palette.yellow),
  title: chalk.hex(palette.yellow),
  params: chalk.hex(palette.text),
  comment: chalk.hex(palette.overlay0).italic,
  doctag: chalk.hex(palette.green),
  meta: chalk.hex(palette.overlay1),
  tag: chalk.hex(palette.overlay1),
  name: chalk.hex(palette.blue),
  attr: chalk.hex(palette.teal),
  attribute: chalk.hex(palette.teal),
  variable: chalk.hex(palette.flamingo),
  addition: chalk.hex(palette.green),
  deletion: chalk.hex(palette.red),
  section: chalk.hex(palette.blue).bold,
  emphasis: chalk.italic,
  strong: chalk.bold,
  link: chalk.hex(palette.sapphire).underline,
  default: chalk.hex(palette.text),
};

export function highlightCode(code: string, language = 'typescript'): string {
  const lang = supportsLanguage(language) ? language : 'plaintext';
  return highlight(code, { language: lang, ignoreIllegals: true, theme: codeTheme });
}

const FENCE_OPEN = /^```(\w+)?\s*$/;
const FENCE_CLOSE = /^```\s*$/;

export function highlightMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inBlock = false;
  let blockLang = '';
  let blockLines: string[] = [];

  for (const line of lines) {
    if (!inBlock) {
      const match = FENCE_OPEN.exec(line);
      if (match) {
        inBlock = true;
        blockLang = match[1] ?? 'typescript';
        blockLines = [];
        out.push(chalk.hex(palette.surface2)('─'.repeat(40)));
        continue;
      }
      out.push(line);
    } else {
      if (FENCE_CLOSE.test(line)) {
        const highlighted = highlightCode(blockLines.join('\n'), blockLang);
        out.push(highlighted);
        out.push(chalk.hex(palette.surface2)('─'.repeat(40)));
        inBlock = false;
        blockLines = [];
        blockLang = '';
      } else {
        blockLines.push(line);
      }
    }
  }

  if (inBlock && blockLines.length > 0) {
    out.push(highlightCode(blockLines.join('\n'), blockLang));
  }

  return out.join('\n');
}
