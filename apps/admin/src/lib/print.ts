import { DEFAULT_TEMPLATES, renderTemplate, type TemplateKind } from '@pd/shared';
import { api } from './api';

/** Renders data with the store's active template for kind/size (built-in default if none) and prints it. */
export async function printWithTemplate(kind: TemplateKind, size: string, data: Record<string, unknown>) {
  const list = await api<{ kind: string; size: string; body: string }[]>('/print-templates').catch(() => []);
  const body = list.find(t => t.kind === kind && t.size === size)?.body ?? (DEFAULT_TEMPLATES[kind] as Record<string, string>)[size];
  const frame = document.createElement('iframe');
  // No allow-scripts: printed HTML (store templates, customer data) can never run code in the app's origin.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  frame.contentDocument!.open(); frame.contentDocument!.write(renderTemplate(body, data)); frame.contentDocument!.close();
  setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1500); }, 250);
}
