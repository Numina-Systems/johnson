// pattern: Functional Core

const SECTION_PATTERN = (label: string) =>
  new RegExp(
    `<!-- archivist-managed: ${label} -->\\n[\\s\\S]*?<!-- /archivist-managed: ${label} -->`,
  );

export function getArchivistSection(content: string, label: string): string | null {
  const pattern = SECTION_PATTERN(label);
  const match = pattern.exec(content);
  if (!match) return null;
  const inner = match[0]
    .replace(`<!-- archivist-managed: ${label} -->\n`, '')
    .replace(`\n<!-- /archivist-managed: ${label} -->`, '');
  return inner;
}

export function setArchivistSection(content: string, label: string, sectionContent: string): string {
  const pattern = SECTION_PATTERN(label);
  const block = `<!-- archivist-managed: ${label} -->\n${sectionContent}\n<!-- /archivist-managed: ${label} -->`;

  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }

  return `${content}\n\n${block}`;
}

export function removeArchivistSection(content: string, label: string): string {
  const pattern = SECTION_PATTERN(label);
  return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
}
