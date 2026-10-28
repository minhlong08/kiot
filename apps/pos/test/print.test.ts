import { expect, test } from 'vitest';
import { printHtml } from '../src/lib/print';

test('receipts print in a sandboxed frame where scripts cannot run', () => {
  printHtml('<script>1</script><p>x</p>');
  const sandbox = document.querySelector('iframe')!.getAttribute('sandbox');
  expect(sandbox).not.toBeNull();
  expect(sandbox).not.toContain('allow-scripts');
});
