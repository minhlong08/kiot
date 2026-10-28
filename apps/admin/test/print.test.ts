import { expect, test, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({ api: vi.fn().mockResolvedValue([{ kind: 'invoice', size: 'A4', body: '<script>window.parent.hacked = 1</script><p>{{code}}</p>' }]) }));
import { printWithTemplate } from '../src/lib/print';

test('templates print in a sandboxed frame where scripts cannot run', async () => {
  vi.useFakeTimers();
  await printWithTemplate('invoice', 'A4', { code: 'HD000001' });
  const frame = document.querySelector('iframe')!;
  const sandbox = frame.getAttribute('sandbox');
  expect(sandbox).not.toBeNull();
  expect(sandbox).not.toContain('allow-scripts');
  vi.useRealTimers();
});
