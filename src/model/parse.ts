import { parse as parseYaml } from 'yaml';

import { normalizeCard, normalizeDueDate } from './card';
import { createDefaultBoard } from './boardTemplate';
import { createId } from './id';
import { BoardDocument, Card, CardDensity, Column, ColumnDefinition } from './types';

const headingRegex = /^##\s+\[([^\]]+)]\s+(.+?)\s*$/;
const cardRegex = /^-\s+\[([ xX])]\s+\[([^\]]+)]\s*(.*)$/;
const dueLineRegex = /^due::\s*(\d{4}-\d{2}-\d{2})\s*$/;
const blockAnchorRegex = /^\^[A-Za-z0-9/_-]+\s*$/;
const archiveBlockRegex =
  /%%\s*kanban-next:archive:start\s*%%\n?([\s\S]*?)\n?%%\s*kanban-next:archive:end\s*%%/m;

interface ParsedColumn {
  id: string;
  title: string;
  cards: Card[];
}

interface ParsedFrontmatter {
  kanban?: unknown;
  boardTitle?: unknown;
  boardDescription?: unknown;
  density?: unknown;
  columns?: unknown;
}

export class BoardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardParseError';
  }
}

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function splitFrontmatter(content: string): { frontmatter: ParsedFrontmatter; body: string } {
  const normalized = normalizeNewlines(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    throw new BoardParseError('Kanban board is missing YAML frontmatter.');
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] || '');
  } catch {
    throw new BoardParseError('Kanban frontmatter could not be parsed as YAML.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new BoardParseError('Kanban frontmatter must be a YAML object.');
  }

  return {
    frontmatter: parsed as ParsedFrontmatter,
    body: normalized.slice((match[0] || '').length),
  };
}

function parseDensity(value: unknown): CardDensity {
  return value === 'compact' ? 'compact' : 'normal';
}

function parseWipLimit(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  const next = Math.floor(value);
  return next >= 0 ? next : null;
}

function parseColumnDefinitions(value: unknown): ColumnDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const columns: ColumnDefinition[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const id =
      typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id.trim() : '';
    const title =
      typeof (entry as { title?: unknown }).title === 'string'
        ? (entry as { title: string }).title.trim()
        : '';

    if (!id || !title) {
      continue;
    }

    columns.push({
      id,
      title,
      wipLimit: parseWipLimit((entry as { wipLimit?: unknown }).wipLimit),
    });
  }

  return columns;
}

function normalizeDescription(rawLines: string[]): { description: string; dueDate: string | null } {
  const lines = [...rawLines];
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last === undefined || last.trim() !== '') {
      break;
    }
    lines.pop();
  }

  let dueDate: string | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (line.trim().match(blockAnchorRegex)) {
      continue;
    }

    const dueMatch = line.trim().match(dueLineRegex);
    if (!dueDate && dueMatch) {
      dueDate = normalizeDueDate(dueMatch[1] || '');
      continue;
    }

    bodyLines.push(line);
  }

  return {
    description: bodyLines.join('\n').trimEnd(),
    dueDate,
  };
}

function parseCardsFromLines(lines: string[]): Card[] {
  const cards: Card[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const cardMatch = line.match(cardRegex);
    if (!cardMatch) {
      continue;
    }

    const checked = (cardMatch[1] || '').toLowerCase() === 'x';
    const cardId = (cardMatch[2] || '').trim() || createId('card');
    const title = (cardMatch[3] || '').trim();
    const descriptionLines: string[] = [];

    for (let nextIndex = i + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex] || '';
      if (cardRegex.test(nextLine) || headingRegex.test(nextLine)) {
        break;
      }

      if (nextLine.trim() === '' || nextLine.startsWith('  ') || nextLine.startsWith('\t')) {
        descriptionLines.push(nextLine.replace(/^( {2}|\t)/, ''));
        i = nextIndex;
        continue;
      }

      break;
    }

    const { description, dueDate } = normalizeDescription(descriptionLines);
    cards.push(
      normalizeCard({
        id: cardId,
        title,
        description,
        checked,
        dueDate,
      })
    );
  }

  return cards;
}

function parseColumnsFromBody(body: string): ParsedColumn[] {
  const lines = normalizeNewlines(body).split('\n');
  const columns: ParsedColumn[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const headingMatch = line.match(headingRegex);
    if (!headingMatch) {
      continue;
    }

    const sectionLines: string[] = [];

    for (let nextIndex = i + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex] || '';
      if (headingRegex.test(nextLine)) {
        i = nextIndex - 1;
        break;
      }

      sectionLines.push(nextLine);

      if (nextIndex === lines.length - 1) {
        i = nextIndex;
      }
    }

    columns.push({
      id: (headingMatch[1] || '').trim() || createId('column'),
      title: (headingMatch[2] || '').trim() || 'Untitled',
      cards: parseCardsFromLines(sectionLines),
    });
  }

  return columns;
}

function extractArchiveSection(body: string): { bodyWithoutArchive: string; archive: Card[] } {
  const normalized = normalizeNewlines(body);
  const match = normalized.match(archiveBlockRegex);

  if (!match || typeof match.index !== 'number') {
    return {
      bodyWithoutArchive: normalized,
      archive: [],
    };
  }

  const archiveMarkdown = match[1] || '';
  const archive = parseCardsFromLines(archiveMarkdown.split('\n'));

  const bodyWithoutArchive =
    normalized.slice(0, match.index) + normalized.slice(match.index + (match[0] || '').length);

  return {
    bodyWithoutArchive,
    archive,
  };
}

function mergeColumns(fromFrontmatter: ColumnDefinition[], fromBody: ParsedColumn[]): Column[] {
  const bodyById = new Map(fromBody.map((column) => [column.id, column]));
  const seen = new Set<string>();
  const columns: Column[] = [];

  for (const definition of fromFrontmatter) {
    seen.add(definition.id);
    const bodyColumn = bodyById.get(definition.id);

    columns.push({
      id: definition.id,
      title: definition.title || bodyColumn?.title || 'Untitled',
      wipLimit: definition.wipLimit,
      cards: bodyColumn?.cards || [],
    });
  }

  for (const bodyColumn of fromBody) {
    if (seen.has(bodyColumn.id)) {
      continue;
    }

    columns.push({
      id: bodyColumn.id,
      title: bodyColumn.title,
      wipLimit: null,
      cards: bodyColumn.cards,
    });
  }

  return columns;
}

export function parseBoardMarkdown(content: string): BoardDocument {
  const { frontmatter, body } = splitFrontmatter(content);

  if (frontmatter.kanban !== true) {
    throw new BoardParseError('File frontmatter is missing `kanban: true`.');
  }

  const boardTitle =
    typeof frontmatter.boardTitle === 'string' && frontmatter.boardTitle.trim().length > 0
      ? frontmatter.boardTitle.trim()
      : 'Untitled Kanban';

  const boardDescription =
    typeof frontmatter.boardDescription === 'string' ? frontmatter.boardDescription.trim() : '';

  const density = parseDensity(frontmatter.density);
  const frontmatterColumns = parseColumnDefinitions(frontmatter.columns);

  const { bodyWithoutArchive, archive } = extractArchiveSection(body);
  const bodyColumns = parseColumnsFromBody(bodyWithoutArchive);
  const columns = mergeColumns(frontmatterColumns, bodyColumns);

  if (columns.length === 0) {
    const fallback = createDefaultBoard(boardTitle);
    fallback.boardDescription = boardDescription;
    fallback.density = density;
    fallback.archive = archive;
    return fallback;
  }

  return {
    boardTitle,
    boardDescription,
    density,
    columns,
    archive,
  };
}
