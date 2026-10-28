import { APP_NAME } from '@pd/shared';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--color-brand-700)" />
      <path d="M9 23V9h7a5 5 0 0 1 0 10h-4" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="22.5" r="2.5" fill="var(--color-accent-500)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold text-brand-800">
      <LogoMark />
      <span className="text-base tracking-tight">{APP_NAME}</span>
    </span>
  );
}
