import { Card } from './types';

const tagRegex = /(^|\s)#([A-Za-z0-9/_-]+)/g;
const dueRegex = /^\d{4}-\d{2}-\d{2}$/;

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  let match: RegExpExecArray | null = null;

  while ((match = tagRegex.exec(text)) !== null) {
    const tagBody = match[2];
    if (tagBody) {
      tags.add(`#${tagBody.toLowerCase()}`);
    }
  }

  return Array.from(tags).sort((left, right) => left.localeCompare(right));
}

export function normalizeDueDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!dueRegex.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function normalizeTagFilter(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

export function buildSearchText(
  title: string,
  description: string,
  tags: string[],
  dueDate: string | null
): string {
  const parts = [title, description, tags.join(' '), dueDate || ''];
  return parts.join('\n').toLowerCase();
}

export function normalizeCard(input: Omit<Card, 'tags' | 'searchText'>): Card {
  const dueDate = normalizeDueDate(input.dueDate);
  const tags = extractTags(`${input.title}\n${input.description}`);

  return {
    ...input,
    dueDate,
    tags,
    searchText: buildSearchText(input.title, input.description, tags, dueDate),
  };
}
