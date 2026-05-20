'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function requestReaccess(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, access_status')
    .eq('auth_user_id', user.id)
    .single();

  if (!internalUser || internalUser.access_status !== 'archived') {
    redirect('/login');
  }

  await supabase
    .from('internal_users')
    .update({
      access_status: 'pending_approval',
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', internalUser.id);

  await supabase.rpc('notify_admins_of_pending_user');

  redirect('/access-pending');
}