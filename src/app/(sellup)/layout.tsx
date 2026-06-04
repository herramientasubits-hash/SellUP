import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/layout/app-shell';

export default async function SellUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Consulta directa a la tabla - más confiable que RPC con RLS
  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('access_status')
    .eq('auth_user_id', user.id)
    .single();

  const accessStatus = internalUser?.access_status ?? 'pending_approval';

  if (accessStatus !== 'active') {
    const accessRedirects: Record<string, string> = {
      pending_approval: '/access-pending',
      rejected: '/access-rejected',
      suspended: '/access-suspended',
      archived: '/access-archived',
    };

    redirect(accessRedirects[accessStatus] ?? '/access-pending');
  }

  const { count } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  const unreadCount = count ?? 0;

  return (
    <AppShell user={user} initialUnreadCount={unreadCount}>
      {children}
    </AppShell>
  );
}
