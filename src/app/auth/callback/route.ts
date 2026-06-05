import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { openSlackDMForUser } from '@/server/services/slack-connection';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('enrichment_configuration_unavailable');
  }
  return createAdminClient(supabaseUrl, supabaseServiceKey);
}

const AUTHORIZED_DOMAIN = 'ubits.co';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_auth_code`);
  }

  const supabase = await createClient();
  const { error, data: sessionData } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !sessionData?.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const user = sessionData.user;
  const email = user.email?.toLowerCase() ?? '';

  if (!email.endsWith(`@${AUTHORIZED_DOMAIN}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/login?error=domain_not_authorized`
    );
  }

  const { data: internalUserData, error: syncError } = await supabase.rpc(
    'sync_internal_user',
    {
      p_auth_user_id: user.id,
      p_email: email,
      p_full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      p_avatar_url: user.user_metadata?.avatar_url ?? null,
    }
  );

  if (syncError) {
    console.error('Error syncing internal user:', syncError);
  }

  // Abrir DM de Slack si el usuario no tiene uno aún (non-blocking)
  const internalUserId = internalUserData as string | null;
  if (internalUserId) {
    try {
      const admin = getAdminSupabase();
      const { data: existingUser } = await admin
        .from('internal_users')
        .select('slack_dm_channel_id')
        .eq('id', internalUserId)
        .single();

      if (!existingUser?.slack_dm_channel_id) {
        const dmChannelId = await openSlackDMForUser(email);
        if (dmChannelId) {
          await admin
            .from('internal_users')
            .update({ slack_dm_channel_id: dmChannelId, updated_at: new Date().toISOString() })
            .eq('id', internalUserId);
        }
      }
    } catch (err) {
      console.error('Slack DM registration skipped:', err);
    }
  }

  const { data: accessData } = await supabase.rpc('get_internal_user', {
    p_auth_user_id: user.id,
  });

  const accessStatus = accessData?.[0]?.access_status ?? 'pending_approval';

  const accessRedirects: Record<string, string> = {
    pending_approval: '/access-pending',
    rejected: '/access-rejected',
    suspended: '/access-suspended',
    archived: '/access-archived',
    active: '/pipeline',
  };

  const redirectPath = accessRedirects[accessStatus] ?? '/access-pending';

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
