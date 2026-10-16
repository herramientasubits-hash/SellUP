import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { IMPORT_BATCH_MAX_ROWS } from '@/modules/prospect-batches/import-batch-schema';
import { precheckImportDuplicates } from '@/server/prospect-batches/import-duplicate-precheck';

// AGENT1-AUDIT-WS5-IMPORT-PRECHECK-1 — el mismo tope de filas que la importación.
const checkItemSchema = z.object({
  index: z.number().int().min(0),
  company_name: z.string().max(300).default(''),
  country_code: z.string().max(8).nullish(),
  domain: z.string().max(2048).nullish(),
  website: z.string().max(2048).nullish(),
  tax_identifier: z.string().max(300).nullish(),
});
const checkBodySchema = z.object({
  items: z.array(checkItemSchema).max(IMPORT_BATCH_MAX_ROWS).default([]),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // Sólo usuarios internos ACTIVOS (igual que la ruta que crea el lote).
    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();
    if (!internalUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
    }

    const parsed = checkBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos para verificar duplicados.' }, { status: 400 });
    }
    const items = parsed.data.items;
    if (items.length === 0) return NextResponse.json([]);

    // El aviso tiene que ver TODO SellUp (no sólo los lotes del vendedor): se
    // lee con el cliente administrativo y sólo se devuelve estado + motivo por
    // fila, nunca datos de otros. Sin cliente administrativo, se usa la sesión.
    let readClient = supabase;
    try {
      readClient = createSupabaseAdminClient();
    } catch (adminErr) {
      console.error('[check-duplicates] admin client unavailable, using session client:', adminErr);
    }

    const results = await precheckImportDuplicates(readClient, items);
    return NextResponse.json(results);
  } catch (err) {
    console.error('[check-duplicates] Error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
