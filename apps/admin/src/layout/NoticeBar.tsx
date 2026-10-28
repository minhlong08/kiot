import { Info } from 'lucide-react';
import { useSettings } from '../lib/settings';

export function NoticeBar() {
  const { data } = useSettings();
  const notice = data?.store.notice;
  if (!notice) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-sm text-amber-900">
      <Info size={14} /> {notice}
    </div>
  );
}
