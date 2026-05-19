import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

export async function GET() {
  const admin = createAdminClient(supabaseUrl, supabaseServiceKey);

  // 1. integration row
  const { data: integration, error: intError } = await admin
    .from('external_integrations')
    .select('id, integration_key, is_available')
    .eq('integration_key', 'slack')
    .single();

  // 2. connection row
  const { data: connection, error: connError } = await admin
    .from('external_integration_connections')
    .select('id, integration_id, credentials_status, connection_status, connected_at, metadata, vault_secret_id')
    .eq('integration_id', integration?.id ?? '')
    .single();

  const meta = (connection?.metadata ?? {}) as Record<string, unknown>;

  // 3. vault: bot token
  let hasBotToken = false;
  let vaultBotTokenError: string | null = null;
  try {
    const { data, error } = await admin.rpc('has_vault_secret', { p_name: 'sellup_integration_slack_bot_token' });
    hasBotToken = data === true;
    vaultBotTokenError = error?.message ?? null;
  } catch (e) {
    vaultBotTokenError = e instanceof Error ? e.message : String(e);
  }

  // 4. vault: client secret
  let hasClientSecret = false;
  let vaultClientSecretError: string | null = null;
  try {
    const { data, error } = await admin.rpc('has_vault_secret', { p_name: 'sellup_integration_slack_client_secret' });
    hasClientSecret = data === true;
    vaultClientSecretError = error?.message ?? null;
  } catch (e) {
    vaultClientSecretError = e instanceof Error ? e.message : String(e);
  }

  // 5. recent audit events
  const { data: auditRows } = await admin
    .from('integration_audit')
    .select('event_type, created_at, metadata')
    .eq('integration_key', 'slack')
    .order('created_at', { ascending: false })
    .limit(5);

  // 6. test metadata write: add a test key and read it back
  let metaWriteResult: { success: boolean; error: string | null; wrote_key: boolean } = {
    success: false,
    error: null,
    wrote_key: false,
  };

  if (connection && integration) {
    const testMeta = { ...(meta as Record<string, unknown>), _debug_write_test: new Date().toISOString() };
    const { error: writeErr } = await admin
      .from('external_integration_connections')
      .update({ metadata: testMeta, updated_at: new Date().toISOString() })
      .eq('id', connection.id);

    if (writeErr) {
      metaWriteResult = { success: false, error: writeErr.message, wrote_key: false };
    } else {
      // Read back to verify
      const { data: verify } = await admin
        .from('external_integration_connections')
        .select('metadata')
        .eq('id', connection.id)
        .single();

      const verifyMeta = (verify?.metadata ?? {}) as Record<string, unknown>;
      const wrote = '_debug_write_test' in verifyMeta;
      metaWriteResult = { success: true, error: null, wrote_key: wrote };

      // Restore original metadata (remove debug key)
      const restoredMeta = { ...verifyMeta };
      delete restoredMeta['_debug_write_test'];
      await admin
        .from('external_integration_connections')
        .update({ metadata: restoredMeta, updated_at: new Date().toISOString() })
        .eq('id', connection.id);
    }
  }

  return NextResponse.json({
    integration: {
      found: !!integration,
      error: intError?.message ?? null,
      id: integration?.id ?? null,
      is_available: integration?.is_available ?? null,
    },
    connection: {
      found: !!connection,
      error: connError?.message ?? null,
      id: connection?.id ?? null,
      credentials_status: connection?.credentials_status ?? null,
      connection_status: connection?.connection_status ?? null,
      connected_at: connection?.connected_at ?? null,
      has_vault_secret_id: !!connection?.vault_secret_id,
      metadata_keys: Object.keys(meta),
      has_oauth_client_id: !!meta.oauth_client_id,
      oauth_redirect_uri: (meta.oauth_redirect_uri as string) ?? null,
      has_team_id: !!meta.team_id,
    },
    vault: {
      bot_token: { present: hasBotToken, error: vaultBotTokenError },
      client_secret: { present: hasClientSecret, error: vaultClientSecretError },
    },
    meta_write_test: metaWriteResult,
    recent_audit: auditRows ?? [],
  });
}
