export interface ParsedClipboardCard {
  title: string;
  checked: boolean;
}

const checklistRegex = /^\s*[-*+]\s+\[([ xX])]\s+(.+)$/;
const bulletRegex = /^\s*[-*+]\s+(.+)$/;
const orderedRegex = /^\s*\d+[.)]\s+(.+)$/;

export function parseClipboardList(text: string): ParsedClipboardCard[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cards: ParsedClipboardCard[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const checklist = trimmed.match(checklistRegex);
    if (checklist) {
      const title = (checklist[2] || '').trim();
      if (title) {
        cards.push({
          title,
          checked: (checklist[1] || '').toLowerCase() === 'x',
        });
      }
      continue;
    }

    const bullet = trimmed.match(bulletRegex);
    if (bullet) {
      const title = (bullet[1] || '').trim();
      if (title) {
        cards.push({
          title,
          checked: false,
        });
      }
      continue;
    }

    const ordered = trimmed.match(orderedRegex);
    if (ordered) {
      const title = (ordered[1] || '').trim();
      if (title) {
        cards.push({
          title,
          checked: false,
        });
      }
      continue;
    }

    cards.push({
      title: trimmed,
      checked: false,
    });
  }

  return cards;
}
