import { useAuth } from '../lib/auth';

export function DashboardPage() {
  const { me } = useAuth();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Xin chào, {me?.user.fullName}</h1>
    </div>
  );
}
