// ── Classify import rows API — Hito 16AB.40 ──────────────────────────────────
// POST /api/prospect-batches/classify-import-rows
// Server-only. Classifies rows without persisting. Used for preview + correction.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadImportCatalog } from '@/modules/prospect-batches/import-catalog-loader';
import { classifyImportRows } from '@/modules/prospect-batches/import-classification-service';
import type { ImportRow } from '@/modules/prospect-batches/import-candidates-parser';
import type {
  ImportClassificationPreviewRow,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Request types ─────────────────────────────────────────────────────────────

type ClassifyRequest = {
  rows: Array<{
    company_name: string;
    country?: string;
    country_code?: string;
    industry?: string;
    subindustry?: string;
    website?: string;
    linkedin_url?: string;
    city?: string;
    company_size?: string;
    description?: string;
    source_url?: string;
    source_evidence?: string;
    confidence?: string;
    notes?: string;
  }>;
  defaults?: {
    country?: string;
    country_code?: string;
    industry?: string;
  };
};

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
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

    const input = await request.json() as ClassifyRequest;

    if (!input.rows || input.rows.length === 0) {
      return NextResponse.json({
        success: false,
        code: 'empty_rows',
        message: 'No rows provided.',
      }, { status: 400 });
    }

    // ── Load catalog ────────────────────────────────────────────────────────
    const catalogResult = await loadImportCatalog();
    if (!catalogResult.success) {
      return NextResponse.json({
        success: false,
        code: 'industry_catalog_unavailable',
        message: catalogResult.message,
      }, { status: 503 });
    }

    const { catalog, catalogVersionId } = catalogResult;

    // ── Convert to ImportRow format for classification ──────────────────────
    const classifiableRows: ImportRow[] = input.rows.map((r, i) => {
      const resolvedCountryCode = resolveCountryCode(r.country_code ?? r.country ?? input.defaults?.country_code ?? '');
      return {
        index: i,
        raw: {
          company_name: r.company_name,
          country: r.country ?? input.defaults?.country,
          country_code: resolvedCountryCode ?? undefined,
          industry: r.industry ?? input.defaults?.industry,
          subindustry: r.subindustry,
          website: r.website,
          linkedin_url: r.linkedin_url,
          city: r.city,
          company_size: r.company_size,
          description: r.description,
          source_url: r.source_url,
          source_evidence: r.source_evidence,
          confidence: r.confidence,
          notes: r.notes,
        },
        status: 'valid' as const,
        errors: [],
        warnings: [],
        resolved_country_code: resolvedCountryCode,
        country_from_default: !r.country && !r.country_code,
        industry_from_default: !r.industry,
        industryOriginalValue: r.industry ?? null,
        subindustryOriginalValue: r.subindustry ?? null,
      };
    });

    // ── Classify ────────────────────────────────────────────────────────────
    const classificationResult = classifyImportRows({
      rows: classifiableRows,
      catalog,
      catalogVersionId,
    });

    // ── Convert to preview rows ─────────────────────────────────────────────
    const previewRows: ImportClassificationPreviewRow[] = classificationResult.rows.map((r) => ({
      rowNumber: r.rowNumber,
      companyName: r.parsedRow.raw.company_name,
      countryCode: r.parsedRow.resolved_country_code,

      industryOriginalValue: r.classification.industryOriginalValue,
      industryCanonicalId: r.classification.industryId,
      industryCanonicalName: r.classification.industryName,
      industryMatchStatus: r.classification.industryMatchStatus,

      subindustryOriginalValue: r.classification.subindustryOriginalValue,
      subindustryCanonicalId: r.classification.subindustryId,
      subindustryCanonicalName: r.classification.subindustryName,
      subindustryMatchStatus: r.classification.subindustryMatchStatus,

      validationStatus: r.validationStatus,
      requiresHumanReview: r.classification.requiresHumanReview,
      warnings: r.classification.classificationWarnings,

      correctionSource: null,
    }));

    return NextResponse.json({
      success: true,
      catalogVersion: classificationResult.catalogVersion,
      catalogVersionId: classificationResult.catalogVersionId,
      rows: previewRows,
      summary: {
        total: classificationResult.summary.totalRows,
        valid: classificationResult.summary.readyRows,
        normalized: classificationResult.summary.normalizedRows,
        warning: classificationResult.summary.warningRows,
        requiresReview: classificationResult.summary.reviewRows,
        invalid: classificationResult.summary.invalidRows,
      },
    });
  } catch (err) {
    console.error('[classify-import-rows]', err);
    return NextResponse.json({
      success: false,
      code: 'internal_error',
      message: err instanceof Error ? err.message : 'Error interno',
    }, { status: 500 });
  }
}

// ── Country code resolution (client-safe subset) ─────────────────────────────

const COUNTRY_TO_CODE: Record<string, string> = {
  'colombia': 'CO', 'co': 'CO',
  'chile': 'CL', 'cl': 'CL',
  'méxico': 'MX', 'mexico': 'MX', 'mx': 'MX',
  'argentina': 'AR', 'ar': 'AR',
  'brasil': 'BR', 'brazil': 'BR', 'br': 'BR',
  'perú': 'PE', 'peru': 'PE', 'pe': 'PE',
  'uruguay': 'UY', 'uy': 'UY',
  'ecuador': 'EC', 'ec': 'EC',
  'paraguay': 'PY', 'py': 'PY',
  'bolivia': 'BO', 'bo': 'BO',
  'venezuela': 'VE', 've': 'VE',
  'guatemala': 'GT', 'gt': 'GT',
  'honduras': 'HN', 'hn': 'HN',
  'el salvador': 'SV', 'sv': 'SV',
  'nicaragua': 'NI', 'ni': 'NI',
  'costa rica': 'CR', 'cr': 'CR',
  'panamá': 'PA', 'panama': 'PA', 'pa': 'PA',
  'república dominicana': 'DO', 'dominican republic': 'DO', 'do': 'DO',
  'estados unidos': 'US', 'united states': 'US', 'us': 'US',
  'españa': 'ES', 'spain': 'ES', 'es': 'ES',
};

function resolveCountryCode(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  const key = trimmed.toLowerCase();
  return COUNTRY_TO_CODE[key] ?? null;
}
