import { describe, expect, it } from 'vitest';

import {
  clampEditableCardText,
  fromEditableCardText,
  toEditableCardText,
} from '../src/model/cardContent';

describe('cardContent', () => {
  it('maps single-line text to title only', () => {
    const parsed = fromEditableCardText('Single line');
    expect(parsed).toEqual({
      title: 'Single line',
      description: '',
    });
  });

  it('maps multiline text to title and description', () => {
    const parsed = fromEditableCardText('Title line\nSecond line\nThird line');
    expect(parsed).toEqual({
      title: 'Title line',
      description: 'Second line\nThird line',
    });
  });

  it('falls back to Untitled on empty text', () => {
    const parsed = fromEditableCardText(' \n\t\n');
    expect(parsed).toEqual({
      title: 'Untitled',
      description: '',
    });
  });

  it('combines title and description into editable text', () => {
    const text = toEditableCardText({
      title: 'A',
      description: 'B\nC',
    });

    expect(text).toBe('A\nB\nC');
  });

  it('keeps text unchanged at exactly max length', () => {
    const value = 'a'.repeat(1000);
    expect(clampEditableCardText(value, 1000)).toBe(value);
  });

  it('clamps text that exceeds max length', () => {
    const value = 'a'.repeat(1005);
    expect(clampEditableCardText(value, 1000)).toHaveLength(1000);
  });
});
