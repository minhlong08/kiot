import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@pd/shared';
import { api } from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { toast, toastError } from '../../components/toast';

/** Local editable copy of one settings section, saved with a partial PUT. */
export function useSettingsSection<K extends keyof Settings>(key: K) {
  const { data } = useSettings();
  const qc = useQueryClient();
  const [value, setValue] = useState<Settings[K] | null>(null);
  useEffect(() => { if (data) setValue(data[key]); }, [data, key]);
  const save = useMutation({
    mutationFn: () => api<Settings>('/settings', { method: 'PUT', body: { [key]: value } }),
    onSuccess: s => { qc.setQueryData(['settings'], s); toast('Đã lưu thiết lập'); },
    onError: toastError,
  });
  const patch = (p: Partial<Settings[K]>) => setValue(v => (v ? { ...v, ...p } : v));
  return { value, patch, save: () => save.mutate(), saving: save.isPending };
}
