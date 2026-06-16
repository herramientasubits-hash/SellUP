// ── Import catalog API — Hito 16AB.40 ─────────────────────────────────────────
// GET /api/prospect-batches/import-catalog
// Returns published catalog in nested UI format for the correction panel.
// Server-only. No persistence. Auth-gated.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadImportCatalog } from '@/modules/prospect-batches/import-catalog-loader';

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();

    if (!internalUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
    }

    const result = await loadImportCatalog();
    if (!result.success) {
      return NextResponse.json({
        success: false,
        code: result.code,
        message: result.message,
      }, { status: 503 });
    }

    const { catalog } = result;

    // Build nested structure expected by the correction panel
    const subsByIndustry = new Map<string, typeof catalog.subindustries>();
    for (const sub of catalog.subindustries) {
      const list = subsByIndustry.get(sub.industryId) ?? [];
      list.push(sub);
      subsByIndustry.set(sub.industryId, list);
    }

    const industries = catalog.industries.map((ind) => ({
      id: ind.id,
      name: ind.name,
      slug: ind.slug,
      subindustries: (subsByIndustry.get(ind.id) ?? []).map((sub) => ({
        id: sub.id,
        name: sub.name,
        slug: sub.slug,
        countries: sub.applicableCountries,
      })),
    }));

    return NextResponse.json({
      success: true,
      catalog: {
        version: catalog.version,
        industries,
      },
    });
  } catch (err) {
    console.error('[import-catalog]', err);
    return NextResponse.json({
      success: false,
      code: 'internal_error',
      message: err instanceof Error ? err.message : 'Error interno',
    }, { status: 500 });
  }
}
