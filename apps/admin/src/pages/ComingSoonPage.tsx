import { Construction } from 'lucide-react';
import { useRouterState } from '@tanstack/react-router';
import { t } from '../lib/i18n';

export function ComingSoonPage() {
  const path = useRouterState({ select: s => s.location.pathname });
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
      <Construction size={40} />
      <p>{t('common.comingSoon')}</p>
      <code className="text-xs">{path}</code>
    </div>
  );
}
