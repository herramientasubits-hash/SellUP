'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function requestReaccess(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient(supabaseUrl, supabaseServiceKey);

  const { data: internalUser } = await admin
    .from('internal_users')
    .select('id, access_status')
    .eq('auth_user_id', user.id)
    .single();

  if (!internalUser || internalUser.access_status !== 'archived') {
    redirect('/login');
  }

  const now = new Date().toISOString();
  await admin
    .from('internal_users')
    .update({
      access_status: 'pending_approval',
      requested_at: now,
      updated_at: now,
      role_id: null,
      manager_id: null,
      group_id: null,
    })
    .eq('id', internalUser.id);

  const { count: pendingCount } = await admin
    .from('internal_users')
    .select('id', { count: 'exact', head: true })
    .eq('access_status', 'pending_approval');

  const plural = (pendingCount ?? 0) > 1 ? 'n' : '';
  const count = pendingCount ?? 0;

  const { data: admins } = await admin
    .from('internal_users')
    .select('id')
    .eq('access_status', 'active');

  if (admins && admins.length > 0) {
    const adminIds = admins.map(a => a.id);

    await admin
      .from('user_notifications')
      .delete()
      .eq('notification_type', 'user_pending_approval')
      .is('entity_id', null)
      .in('recipient_internal_user_id', adminIds)
      .eq('is_read', false);

    const notifications = adminIds.map(adminId => ({
      recipient_internal_user_id: adminId,
      notification_type: 'user_pending_approval',
      title: 'Usuarios pendientes de aprobación',
      message: `${count} usuario${plural} pendiente${plural} de revisión.`,
      action_label: 'Revisar usuarios',
      action_url: '/settings/users?tab=usuarios&filter=pending',
      entity_type: 'internal_user',
      entity_id: null,
      is_read: false,
      created_at: now,
    }));

    await admin.from('user_notifications').insert(notifications);
  }

  redirect('/access-pending');
}