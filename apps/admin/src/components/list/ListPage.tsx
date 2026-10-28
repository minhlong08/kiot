import type { ReactNode } from 'react';

/** Standard list screen: filter sidebar on the left, toolbar + table on the right. */
export function ListPage({ sidebar, toolbar, children, footer }: { sidebar: ReactNode; toolbar: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 p-4 lg:flex-row">
      {sidebar}
      <div className="min-w-0 flex-1 space-y-3">
        {toolbar}
        <div className="card overflow-hidden">
          {children}
          {footer}
        </div>
      </div>
    </div>
  );
}
