const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomString(size: number): string {
  let result = '';
  for (let i = 0; i < size; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    result += alphabet[index];
  }
  return result;
}

export function createId(prefix: string): string {
  const stamp = Date.now().toString(36);
  return `${prefix}-${stamp}-${randomString(5)}`;
}
