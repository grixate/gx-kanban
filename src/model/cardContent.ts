interface CardTextSource {
  title: string;
  description: string;
}

export interface ParsedCardContent {
  title: string;
  description: string;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function toEditableCardText(source: CardTextSource): string {
  const title = source.title.trim();
  const description = source.description.trimEnd();

  if (!description) {
    return title;
  }

  return `${title}\n${description}`;
}

export function fromEditableCardText(value: string): ParsedCardContent {
  const lines = normalizeNewlines(value).split('\n');
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentLineIndex < 0) {
    return {
      title: 'Untitled',
      description: '',
    };
  }

  const title = lines[firstContentLineIndex]?.trim() || 'Untitled';
  const description = lines.slice(firstContentLineIndex + 1).join('\n').trimEnd();

  return {
    title: title || 'Untitled',
    description,
  };
}

export function clampEditableCardText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}
