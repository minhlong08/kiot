/** A pluggable SMS / Zalo / email provider. Register a real one in `adapters` below. */
export interface MessagingAdapter {
  readonly name: string;
  send(to: string, body: string): Promise<{ ok: boolean; error?: string }>;
}

/** Records nothing externally; every message "succeeds". Used until a real provider is configured. */
export class StubMessagingAdapter implements MessagingAdapter {
  readonly name = 'stub';
  async send(to: string, body: string) {
    if (process.env.NODE_ENV !== 'test') console.info(`[messaging:stub] → ${to}: ${body.slice(0, 80)}`);
    return { ok: true };
  }
}

const adapters: Record<string, MessagingAdapter> = { sms: new StubMessagingAdapter(), zalo: new StubMessagingAdapter(), email: new StubMessagingAdapter() };

export function getMessagingAdapter(channel: string): MessagingAdapter {
  return adapters[channel] ?? adapters.sms;
}

export function registerMessagingAdapter(channel: string, adapter: MessagingAdapter) {
  adapters[channel] = adapter;
}
