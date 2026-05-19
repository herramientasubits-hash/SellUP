import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyZHJ1b3d0YWR3YmR1bG5kbHBoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgzODY2NCwiZXhwIjoyMDk0NDE0NjY0fQ.0fnp65rmdJxklJvVkaWuA3J9dtBpf0Jg2zB2kSyyg0E';

export async function GET() {
  const admin = createAdminClient(supabaseUrl, supabaseServiceKey);

  // 1. Check external_integrations row
  const { data: integration, error: intError } = await admin
    .from('external_integrations')
    .select('id, integration_key, is_available')
    .eq('integration_key', 'slack')
    .single();

  // 2. Check external_integration_connections row
  const { data: connection, error: connError } = await admin
    .from('external_integration_connections')
    .select('id, integration_id, credentials_status, connection_status, metadata')
    .eq('integration_key', 'slack')
    .single();

  const meta = (connection?.metadata ?? {}) as Record<string, unknown>;

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
      credentials_status: connection?.credentials_status ?? null,
      connection_status: connection?.connection_status ?? null,
      metadata_keys: Object.keys(meta),
      has_oauth_client_id: !!meta.oauth_client_id,
      has_oauth_redirect_uri: !!meta.oauth_redirect_uri,
    },
  });
}
