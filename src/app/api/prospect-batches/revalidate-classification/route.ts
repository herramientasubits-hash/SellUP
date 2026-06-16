// ── Revalidate classification API — Hito 16AB.40 ──────────────────────────────
// POST /api/prospect-batches/revalidate-classification
// Validates a manually-selected industry+subindustry pair against the live catalog.
// Returns a fully-formed ImportClassificationPreviewRow with correctionSource: 'manual'.
// Does NOT persist anything.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadImportCatalog } from '@/modules/prospect-batches/import-catalog-loader';
import type { ImportClassificationPreviewRow } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Request type ──────────────────────────────────────────────────────────────

type RevalidateRequest = {
  rowNumber: number;
  industryId: string;
  subindustryId: string | null;
  catalogVersion: string;
  // Context for response construction (not used for classification logic)
  companyName?: string;
  countryCode?: string | null;
  industryOriginalValue?: string | null;
  subindustryOriginalValue?: string | null;
};

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, code: 'unauthorized', message: 'No autorizado' }, { status: 401 });
    }

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();

    if (!internalUser) {
      return NextResponse.json({ success: false, code: 'forbidden', message: 'Usuario no encontrado' }, { status: 403 });
    }

    const input = await request.json() as RevalidateRequest;

    if (!input.industryId || typeof input.rowNumber !== 'number') {
      return NextResponse.json({
        success: false,
        code: 'invalid_input',
        message: 'industryId y rowNumber son requeridos.',
      }, { status: 400 });
    }

    // ── Load live catalog ────────────────────────────────────────────────────
    const catalogResult = await loadImportCatalog();
    if (!catalogResult.success) {
      return NextResponse.json({
        success: false,
        code: 'industry_catalog_unavailable',
        message: catalogResult.message,
      }, { status: 503 });
    }

    const { catalog } = catalogResult;

    // ── Catalog version guard ────────────────────────────────────────────────
    if (input.catalogVersion && input.catalogVersion !== catalog.version) {
      return NextResponse.json({
        success: false,
        code: 'catalog_version_changed',
        message: `La versión del catálogo ha cambiado. Versión actual: ${catalog.version}`,
        currentVersion: catalog.version,
      }, { status: 409 });
    }

    // ── Validate industryId exists (reject manipulated IDs) ──────────────────
    const industry = catalog.industries.find((i) => i.id === input.industryId);
    if (!industry) {
      return NextResponse.json({
        success: false,
        code: 'industry_not_found',
        message: `La industria seleccionada no existe en el catálogo publicado.`,
      }, { status: 422 });
    }

    // ── Validate subindustryId if provided ───────────────────────────────────
    let subindustry = null;
    if (input.subindustryId) {
      subindustry = catalog.subindustries.find((s) => s.id === input.subindustryId);
      if (!subindustry) {
        return NextResponse.json({
          success: false,
          code: 'subindustry_not_found',
          message: `La subindustria seleccionada no existe en el catálogo publicado.`,
        }, { status: 422 });
      }
      if (subindustry.industryId !== input.industryId) {
        return NextResponse.json({
          success: false,
          code: 'subindustry_wrong_industry',
          message: `La subindustria "${subindustry.name}" no pertenece a la industria "${industry.name}".`,
        }, { status: 422 });
      }
    }

    // ── Build validated preview row ──────────────────────────────────────────
    const row: ImportClassificationPreviewRow = {
      rowNumber: input.rowNumber,
      companyName: input.companyName ?? '',
      countryCode: input.countryCode ?? null,

      industryOriginalValue: input.industryOriginalValue ?? null,
      industryCanonicalId: industry.id,
      industryCanonicalName: industry.name,
      industryMatchStatus: 'exact_match',

      subindustryOriginalValue: input.subindustryOriginalValue ?? null,
      subindustryCanonicalId: subindustry?.id ?? null,
      subindustryCanonicalName: subindustry?.name ?? null,
      subindustryMatchStatus: subindustry ? 'exact_match' : 'missing',

      validationStatus: 'valid',
      requiresHumanReview: false,
      warnings: [],
      correctionSource: 'manual',
    };

    return NextResponse.json({ success: true, row });
  } catch (err) {
    console.error('[revalidate-classification]', err);
    return NextResponse.json({
      success: false,
      code: 'internal_error',
      message: err instanceof Error ? err.message : 'Error interno',
    }, { status: 500 });
  }
}
