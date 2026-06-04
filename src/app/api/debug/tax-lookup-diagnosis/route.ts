import { NextResponse } from 'next/server';
import { checkSocrataColombiaAvailability } from '@/server/prospect-batches/tax-identifier-providers/colombia';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  // Solo disponible en entornos distintos de producción para desarrollo y pruebas seguras
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const statusInfo = await checkSocrataColombiaAvailability();

  return NextResponse.json({
    tax_identifier_lookup_config: {
      socrata_import_available: statusInfo.available,
      provider_fiscal_available: statusInfo.available,
      source_key_detected: statusInfo.source_key,
      connection_status: statusInfo.connection_status,
      enabled_by: statusInfo.enabled_by,
      rues_dataset_id: 'c82u-588k',
    },
  });
}
