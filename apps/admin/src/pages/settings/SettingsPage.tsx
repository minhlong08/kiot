import type { FC } from 'react';
import { Link } from '@tanstack/react-router';
import { useListState } from '../../components/list';
import { t } from '../../lib/i18n';
import { StoreSettings } from './StoreSettings';
import { BranchesSettings } from './BranchesSettings';
import { UsersSettings } from './UsersSettings';
import { RolesSettings } from './RolesSettings';
import { ProductSettings } from './ProductSettings';
import { OrderSettings } from './OrderSettings';
import { CustomerSettings } from './CustomerSettings';

export type SettingsSection = { key: string; labelKey: string; component: FC };

/** Later milestones append sections here (cash book, print templates, tax, backup...). */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'store', labelKey: 'settings.store', component: StoreSettings },
  { key: 'branches', labelKey: 'settings.branches', component: BranchesSettings },
  { key: 'users', labelKey: 'settings.users', component: UsersSettings },
  { key: 'roles', labelKey: 'settings.roles', component: RolesSettings },
  { key: 'products', labelKey: 'settings.products', component: ProductSettings },
  { key: 'orders', labelKey: 'settings.orders', component: OrderSettings },
  { key: 'customers', labelKey: 'settings.customers', component: CustomerSettings },
];

export function SettingsPage() {
  const { state, set } = useListState({ tab: 'store' });
  const section = SETTINGS_SECTIONS.find(s => s.key === state.tab) ?? SETTINGS_SECTIONS[0];
  const Body = section.component;
  return (
    <div className="flex flex-col gap-4 p-4 lg:flex-row">
      <aside className="w-full lg:w-56">
        <h1 className="mb-3 text-xl font-bold">{t('settings.title')}</h1>
        <nav className="card p-1">
          {SETTINGS_SECTIONS.map(s => (
            <button key={s.key} type="button" onClick={() => set({ tab: s.key })}
              className={`block w-full rounded px-3 py-2 text-left text-sm ${s.key === section.key ? 'bg-brand-50 font-semibold text-brand-800' : 'hover:bg-slate-50'}`}>
              {t(s.labelKey)}
            </button>
          ))}
          <Link to="/settings/audit-log" className="block rounded px-3 py-2 text-sm hover:bg-slate-50">{t('settings.auditLog')}</Link>
        </nav>
      </aside>
      <section className="card min-w-0 flex-1 p-5">
        <h2 className="mb-4 text-lg font-semibold">{t(section.labelKey)}</h2>
        <Body />
      </section>
    </div>
  );
}
