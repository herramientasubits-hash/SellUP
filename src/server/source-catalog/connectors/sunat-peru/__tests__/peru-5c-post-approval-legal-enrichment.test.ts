/**
 * Perú.5C — SUNAT Post-Approval Legal Enrichment Tests
 *
 * Tests for src/server/prospect-batches/peru-sunat-post-approval-enrichment.ts
 * Uses Node.js built-in test module. No Supabase connection required.
 * lookupPeruSunatByRuc is injected via the lookupFn parameter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  enrichPeruCandidateWithSunatLegalLookup,
  resolveRucFromInput,
} from '../../../../prospect-batches/peru-sunat-post-approval-enrichment';
import type {
  PeruSunatEnrichmentInput,
} from '../../../../prospect-batches/peru-sunat-post-approval-enrichment';
import type {
  PeruSunatLegalLookupResult,
} from '../../../../services/peru-sunat-legal-lookup';

const __filename = fileURLToPath(import.meta.url);
const __dirname_path = dirname(__filename);

const ENRICHMENT_FILE = join(
  __dirname_path,
  '..',
  '..',
  '..',
  '..',
  'prospect-batches',
  'peru-sunat-post-approval-enrichment.ts',
);

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeLookupResult(
  overrides: Partial<PeruSunatLegalLookupResult> = {},
): PeruSunatLegalLookupResult {
  return {
    status: 'verified',
    reason: 'ruc_found_active_habido',
    ruc: '20100047218',
    legalName: 'EMPRESA TEST SAC',
    taxpayerStatus: 'ACTIVO',
    domicileCondition: 'HABIDO',
    ubigeo: '150101',
    department: 'LIMA',
    province: 'LIMA',
    district: 'LIMA',
    isActive: true,
    isHabido: true,
    snapshotPeriod: '2024-06',
    snapshotLoadedAt: '2024-06-01T00:00:00Z',
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<PeruSunatEnrichmentInput> = {}): PeruSunatEnrichmentInput {
  return {
    countryCode: 'PE',
    ruc: '20100047218',
    ...overrides,
  };
}

function mockLookup(result: PeruSunatLegalLookupResult) {
  return async (_ruc: string): Promise<PeruSunatLegalLookupResult> => result;
}

// Strips comment-only lines for guardrail source checks
function stripCommentLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

// ── 1. PE + RUC ACTIVO + HABIDO → verified ─────────────────────────────────────

describe('Perú.5C — 01: PE + RUC ACTIVO + HABIDO → verified', () => {
  it('legal_validation_status = verified', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult({ status: 'verified', reason: 'ruc_found_active_habido' })),
    );
    assert.equal(result.enriched, true);
    assert.equal(result.pe_sunat_bulk?.legal_validation_status, 'verified');
    assert.equal(result.pe_sunat_bulk?.legal_validation_reason, 'ruc_found_active_habido');
    assert.equal(result.pe_sunat_bulk?.is_active, true);
    assert.equal(result.pe_sunat_bulk?.is_habido, true);
  });
});

// ── 2. PE + RUC BAJA/INACTIVO → flagged + taxpayer_inactive ───────────────────

describe('Perú.5C — 02: PE + RUC BAJA/INACTIVO → flagged', () => {
  it('legal_validation_status = flagged, reason = taxpayer_inactive', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(
        makeLookupResult({
          status: 'flagged',
          reason: 'taxpayer_inactive',
          taxpayerStatus: 'BAJA DE OFICIO',
          isActive: false,
        }),
      ),
    );
    assert.equal(result.pe_sunat_bulk?.legal_validation_status, 'flagged');
    assert.equal(result.pe_sunat_bulk?.legal_validation_reason, 'taxpayer_inactive');
    assert.equal(result.pe_sunat_bulk?.is_active, false);
  });
});

// ── 3. PE + RUC no encontrado → not_found ─────────────────────────────────────

describe('Perú.5C — 03: PE + RUC no encontrado → not_found', () => {
  it('legal_validation_status = not_found', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(
        makeLookupResult({
          status: 'not_found',
          reason: 'ruc_not_found_in_snapshot',
          ruc: '20100047218',
          legalName: null,
          isActive: null,
          isHabido: null,
        }),
      ),
    );
    assert.equal(result.pe_sunat_bulk?.legal_validation_status, 'not_found');
    assert.equal(result.pe_sunat_bulk?.legal_validation_reason, 'ruc_not_found_in_snapshot');
  });
});

// ── 4. PE sin RUC → pending_snapshot_validation + missing_ruc ─────────────────

describe('Perú.5C — 04: PE sin RUC → pending_snapshot_validation + missing_ruc', () => {
  it('status = pending, reason = missing_ruc, enriched = true', async () => {
    const lookupCalled = { count: 0 };
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput({ ruc: null, taxId: null }),
      async (_ruc) => { lookupCalled.count++; return makeLookupResult(); },
    );
    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'no_ruc');
    assert.equal(result.pe_sunat_bulk?.legal_validation_status, 'pending_snapshot_validation');
    assert.equal(result.pe_sunat_bulk?.legal_validation_reason, 'missing_ruc');
    assert.equal(result.pe_sunat_bulk?.ruc, null);
    // Lookup must NOT be called when RUC is absent
    assert.equal(lookupCalled.count, 0, 'lookupFn must not be called when RUC is absent');
  });
});

// ── 5. RUC inválido → flagged + invalid_ruc_format ────────────────────────────

describe('Perú.5C — 05: RUC inválido → flagged + invalid_ruc_format', () => {
  it('status = flagged, reason = invalid_ruc_format', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput({ ruc: 'BADFORMAT' }),
      mockLookup(
        makeLookupResult({
          status: 'flagged',
          reason: 'invalid_ruc_format',
          ruc: null,
          legalName: null,
          isActive: null,
          isHabido: null,
        }),
      ),
    );
    assert.equal(result.pe_sunat_bulk?.legal_validation_status, 'flagged');
    assert.equal(result.pe_sunat_bulk?.legal_validation_reason, 'invalid_ruc_format');
  });
});

// ── 6. Snapshot unavailable → snapshot_unavailable ────────────────────────────

describe('Perú.5C — 06: snapshot unavailable → snapshot_unavailable', () => {
  it('status = snapshot_unavailable, reason = snapshot_not_loaded', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(
        makeLookupResult({
          status: 'snapshot_unavailable',
          reason: 'snapshot_not_loaded',
          legalName: null,
          isActive: null,
          isHabido: null,
        }),
      ),
    );
    assert.equal(result.pe_sunat_bulk?.legal_validation_status, 'snapshot_unavailable');
    assert.equal(result.pe_sunat_bulk?.legal_validation_reason, 'snapshot_not_loaded');
  });
});

// ── 7. CO no llama SUNAT ──────────────────────────────────────────────────────

describe('Perú.5C — 07: país CO no llama SUNAT', () => {
  it('enrich=false, reason=not_pe_country, pe_sunat_bulk=null', async () => {
    const lookupCalled = { count: 0 };
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      { countryCode: 'CO', taxId: '900123456' },
      async (_ruc) => { lookupCalled.count++; return makeLookupResult(); },
    );
    assert.equal(result.enriched, false);
    assert.equal(result.reason, 'not_pe_country');
    assert.equal(result.pe_sunat_bulk, null);
    assert.equal(lookupCalled.count, 0, 'CO must never call SUNAT lookup');
  });
});

// ── 8. MX no llama SUNAT ─────────────────────────────────────────────────────

describe('Perú.5C — 08: país MX no llama SUNAT', () => {
  it('enrich=false, reason=not_pe_country, pe_sunat_bulk=null', async () => {
    const lookupCalled = { count: 0 };
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      { countryCode: 'MX', taxId: 'XAXX010101000' },
      async (_ruc) => { lookupCalled.count++; return makeLookupResult(); },
    );
    assert.equal(result.enriched, false);
    assert.equal(result.reason, 'not_pe_country');
    assert.equal(result.pe_sunat_bulk, null);
    assert.equal(lookupCalled.count, 0, 'MX must never call SUNAT lookup');
  });
});

// ── 9. CL no llama SUNAT ─────────────────────────────────────────────────────

describe('Perú.5C — 09: país CL no llama SUNAT', () => {
  it('enrich=false, reason=not_pe_country, pe_sunat_bulk=null', async () => {
    const lookupCalled = { count: 0 };
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      { countryCode: 'CL', taxId: '76354771-K' },
      async (_ruc) => { lookupCalled.count++; return makeLookupResult(); },
    );
    assert.equal(result.enriched, false);
    assert.equal(result.reason, 'not_pe_country');
    assert.equal(result.pe_sunat_bulk, null);
    assert.equal(lookupCalled.count, 0, 'CL must never call SUNAT lookup');
  });
});

// ── 10-14. Metadata invariants Peru ───────────────────────────────────────────

describe('Perú.5C — 10-14: metadata invariants siempre presentes en bloque PE', () => {
  it('10: sector_source = inferred_web_ai', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.sector_source, 'inferred_web_ai');
  });

  it('11: confidence_label = sector_inferred', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.confidence_label, 'sector_inferred');
  });

  it('12: ciiu_status = unavailable_for_mvp', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.ciiu_status, 'unavailable_for_mvp');
  });

  it('13: official_ciiu_available = false', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.official_ciiu_available, false);
  });

  it('14: campo official_ciiu NO aparece en el bloque', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult()),
    );
    assert.equal(
      'official_ciiu' in (result.pe_sunat_bulk ?? {}),
      false,
      'official_ciiu field must not exist in the enrichment block',
    );
  });
});

// ── Invariants también en bloque missing_ruc ───────────────────────────────────

describe('Perú.5C — invariantes en bloque missing_ruc', () => {
  it('sector_source, confidence_label, ciiu_status, official_ciiu_available presentes sin RUC', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput({ ruc: null, taxId: null }),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.sector_source, 'inferred_web_ai');
    assert.equal(result.pe_sunat_bulk?.confidence_label, 'sector_inferred');
    assert.equal(result.pe_sunat_bulk?.ciiu_status, 'unavailable_for_mvp');
    assert.equal(result.pe_sunat_bulk?.official_ciiu_available, false);
    assert.equal(result.pe_sunat_bulk?.human_review_required, true);
  });
});

// ── 15-22. Guardrails: análisis de código fuente ───────────────────────────────
//
// Se analiza el código ejecutable del módulo (líneas no comentadas).
// Las menciones en comentarios de guardrail son legítimas; se prohíbe en código ejecutable.

describe('Perú.5C — Guardrails: código fuente del módulo (líneas no comentadas)', () => {
  let executableContent: string;

  it('setup: el archivo del módulo existe y tiene contenido', () => {
    const raw = readFileSync(ENRICHMENT_FILE, 'utf-8');
    executableContent = stripCommentLines(raw);
    assert.ok(executableContent.length > 50, 'Módulo existe y tiene contenido');
  });

  it('15: no llama Migo API (no MIGO_API_KEY ni api.migo.pe) en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    const hasMigo = content.includes('MIGO_API_KEY') || content.includes('api.migo.pe');
    assert.equal(hasMigo, false, 'El módulo no debe llamar a la API de Migo');
  });

  it('16: no llama Tavily en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    const hasTavily = content.includes('tavily') || content.includes('Tavily');
    assert.equal(hasTavily, false, 'El módulo no debe llamar a Tavily');
  });

  it('17: no descarga SUNAT (no www2.sunat ni padron_reducido_ruc.zip) en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    const hasDownload =
      content.includes('www2.sunat') || content.includes('padron_reducido_ruc.zip');
    assert.equal(hasDownload, false, 'El módulo no debe descargar desde SUNAT');
  });

  it('18: no lee .tmp/sunat-peru en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    assert.equal(
      content.includes('.tmp/sunat-peru'),
      false,
      'El módulo no debe leer .tmp/sunat-peru',
    );
  });

  it('19: no ejecuta importer SUNAT en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    const hasImporter =
      content.includes('import-peru-sunat-snapshot') ||
      content.includes('importPeruSunatSnapshot');
    assert.equal(hasImporter, false, 'El módulo no debe ejecutar el importer SUNAT');
  });

  it('20: no crea candidatos (no prospect_candidates.insert) en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    assert.equal(
      content.includes('prospect_candidates'),
      false,
      'El módulo no debe insertar en prospect_candidates',
    );
  });

  it('21: no crea batches (no prospect_batches) en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    assert.equal(
      content.includes('prospect_batches'),
      false,
      'El módulo no debe insertar en prospect_batches',
    );
  });

  it('22: no modifica Colombia/Chile/México (no referencia CO_NIT_SAFE) en código ejecutable', () => {
    const content = stripCommentLines(readFileSync(ENRICHMENT_FILE, 'utf-8'));
    assert.equal(
      content.includes('CO_NIT_SAFE'),
      false,
      'El módulo de Perú no debe referenciar fuentes CO/CL/MX',
    );
  });
});

// ── resolveRucFromInput: resolución de RUC desde campos múltiples ──────────────

describe('Perú.5C — resolveRucFromInput: extrae RUC del campo correcto', () => {
  it('prioriza input.ruc sobre taxId', () => {
    const ruc = resolveRucFromInput({ countryCode: 'PE', ruc: '20100047218', taxId: '99999999999' });
    assert.equal(ruc, '20100047218');
  });

  it('usa taxId si no hay ruc', () => {
    const ruc = resolveRucFromInput({ countryCode: 'PE', taxId: '20100047218' });
    assert.equal(ruc, '20100047218');
  });

  it('usa metadata.ruc si no hay campos directos', () => {
    const ruc = resolveRucFromInput({
      countryCode: 'PE',
      metadata: { ruc: '20100047218' },
    });
    assert.equal(ruc, '20100047218');
  });

  it('usa metadata.tax_id si no hay ruc ni metadata.ruc', () => {
    const ruc = resolveRucFromInput({
      countryCode: 'PE',
      metadata: { tax_id: '20100047218' },
    });
    assert.equal(ruc, '20100047218');
  });

  it('retorna null si no hay ningún campo de RUC', () => {
    const ruc = resolveRucFromInput({ countryCode: 'PE' });
    assert.equal(ruc, null);
  });

  it('retorna null si todos los campos son strings vacíos', () => {
    const ruc = resolveRucFromInput({
      countryCode: 'PE',
      ruc: '  ',
      taxId: '',
      metadata: { ruc: ' ', tax_id: '' },
    });
    assert.equal(ruc, null);
  });
});

// ── source_key siempre = pe_sunat_bulk ────────────────────────────────────────

describe('Perú.5C — source_key = pe_sunat_bulk en todos los casos', () => {
  it('source_key = pe_sunat_bulk en verified', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput(),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.source_key, 'pe_sunat_bulk');
  });

  it('source_key = pe_sunat_bulk en missing_ruc', async () => {
    const result = await enrichPeruCandidateWithSunatLegalLookup(
      makeInput({ ruc: null, taxId: null }),
      mockLookup(makeLookupResult()),
    );
    assert.equal(result.pe_sunat_bulk?.source_key, 'pe_sunat_bulk');
  });
});
