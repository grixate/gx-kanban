import { describe, expect, it } from 'vitest';

import { parseClipboardList } from '../src/model/clipboard';

describe('parseClipboardList', () => {
  it('parses checklist, bullets, ordered, and plain lines', () => {
    const raw = `- [x] Done item
- [ ] Open item
* Bullet item
1. Ordered item
2) Another ordered
Plain line`;

    const parsed = parseClipboardList(raw);

    expect(parsed).toEqual([
      { title: 'Done item', checked: true },
      { title: 'Open item', checked: false },
      { title: 'Bullet item', checked: false },
      { title: 'Ordered item', checked: false },
      { title: 'Another ordered', checked: false },
      { title: 'Plain line', checked: false },
    ]);
  });

  it('ignores empty lines', () => {
    const parsed = parseClipboardList('\n\n- item\n\n');
    expect(parsed).toEqual([{ title: 'item', checked: false }]);
  });
});
