import { stringify as stringifyYaml } from 'yaml';

import { normalizeCard, normalizeDueDate } from './card';
import { BoardDocument, BoardFrontmatter, Card, ColumnDefinition } from './types';

const archiveStartMarker = '%% kanban-next:archive:start %%';
const archiveEndMarker = '%% kanban-next:archive:end %%';

function normalizeColumns(board: BoardDocument): ColumnDefinition[] {
  return board.columns.map((column) => ({
    id: column.id,
    title: column.title,
    wipLimit: typeof column.wipLimit === 'number' && column.wipLimit >= 0 ? column.wipLimit : null,
  }));
}

function buildFrontmatter(board: BoardDocument): BoardFrontmatter {
  return {
    kanban: true,
    kanbanVersion: 1,
    boardTitle: board.boardTitle,
    ...(board.boardDescription ? { boardDescription: board.boardDescription } : {}),
    density: board.density,
    columns: normalizeColumns(board),
  };
}

function serializeCard(card: Card): string[] {
  const normalized = normalizeCard({
    id: card.id,
    title: card.title.trim(),
    description: card.description,
    checked: card.checked,
    dueDate: normalizeDueDate(card.dueDate),
  });

  const lines = [
    `- [${normalized.checked ? 'x' : ' '}] [${normalized.id}] ${normalized.title}`,
    `  ^${normalized.id}`,
  ];
  const descriptionChunks: string[] = [];

  if (normalized.description.trim().length > 0) {
    descriptionChunks.push(normalized.description.trimEnd());
  }

  if (normalized.dueDate) {
    descriptionChunks.push(`due:: ${normalized.dueDate}`);
  }

  if (descriptionChunks.length > 0) {
    const description = descriptionChunks.join('\n');
    for (const line of description.split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  lines.push('');

  return lines;
}

function serializeArchive(archive: Card[]): string[] {
  if (archive.length === 0) {
    return [];
  }

  const lines = ['', archiveStartMarker, ''];

  for (const card of archive) {
    lines.push(...serializeCard(card));
  }

  lines.push(archiveEndMarker);
  lines.push('');

  return lines;
}

export function serializeBoardMarkdown(board: BoardDocument): string {
  const frontmatter = buildFrontmatter(board);
  const yaml = stringifyYaml(frontmatter).trimEnd();

  const lines: string[] = ['---', yaml, '---', ''];

  for (const column of board.columns) {
    lines.push(`## [${column.id}] ${column.title}`);
    lines.push('');

    for (const card of column.cards) {
      lines.push(...serializeCard(card));
    }

    lines.push('');
  }

  lines.push(...serializeArchive(board.archive));

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return `${lines.join('\n')}\n`;
}
