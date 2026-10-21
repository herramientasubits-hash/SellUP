/**
 * Agente 1 · «Competidores de una empresa» — las COMPETIDORAS PEQUEÑAS (puro).
 *
 * Decisión de la dueña (21-10): el piso de 200 empleados sigue para lo que va a
 * HubSpot, pero las competidoras más chicas no se pierden: se ven en su búsqueda,
 * en «Competidoras pequeñas», como parte del mapa del competidor. No van a
 * revisión ni a HubSpot.
 *
 * Dos orígenes, sin migración:
 *   - la revisión de tamaño de Claude (rescate) las deja `discarded` con
 *     `metadata.claude_rescue.discard_reason = 'claude_size_below_min'`;
 *   - el escritor salta las de tamaño ya CONFIRMADO bajo el piso y sólo las anota
 *     en `metadata.writer_omitted_samples` del lote (`gate = 'icp_size'`).
 *
 * Lo usan la página del lote (servidor), «Descartadas» y el envío a revisión.
 */

/** Motivo con el que la revisión de tamaño de Claude descarta (rescate). */
export const CLAUDE_SIZE_BELOW_MIN_REASON = 'claude_size_below_min';

/** Lo que ve «Descartadas» al lado del botón (bloqueado). */
export const COMPETITOR_SMALL_SEND_TO_REVIEW_BLOCKED =
  'Competidora pequeña: se ve en su búsqueda de competidores, pero no va a revisión ni a HubSpot.';

/** Etiqueta corta del estado en «Descartadas». */
export const COMPETITOR_SMALL_STATUS_LABEL = 'Competidora pequeña';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * ¿Es una competidora que la revisión de tamaño dejó fuera? Sólo con la relación
 * «competidor de» en la fila: una empresa pequeña de otra búsqueda no cambia.
 */
export function isCompetitorSmallCompany(metadata: unknown): boolean {
  const record = asRecord(metadata);
  if (asRecord(record?.relationship)?.kind !== 'competitor_of') return false;
  const rescue = asRecord(record?.claude_rescue);
  return rescue?.decision === 'discard' && rescue.discard_reason === CLAUDE_SIZE_BELOW_MIN_REASON;
}

export type CompetitorSmallCompanyCandidate = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  country_code: string | null;
  status: string | null;
  metadata: unknown;
};

export type CompetitorSmallCompany = {
  key: string;
  name: string;
  domain: string | null;
  website: string | null;
  countryCode: string | null;
  /** Qué dice del tamaño (cita de Claude o motivo del escritor). */
  sizeDetail: string | null;
  /** Por qué compite (motivo del juez o de la web), si se guardó. */
  competitorReason: string | null;
  origin: 'size_review' | 'confirmed_size';
};

function cleanDomain(value: string | null): string | null {
  if (!value) return null;
  const host = value
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^www\./, '');
  return host || null;
}

/** «Nombre: motivo» del resumen del piso de tamaño, por nombre (máx. 20 en el lote). */
function blockedReasonsByName(batchMetadata: UnknownRecord | null): Map<string, string> {
  const summary = asRecord(batchMetadata?.icp_size_gate_summary);
  const reasons = Array.isArray(summary?.blocked_reasons) ? summary.blocked_reasons : [];
  const out = new Map<string, string>();
  for (const entry of reasons) {
    const value = text(entry);
    const cut = value ? value.indexOf(': ') : -1;
    if (!value || cut <= 0) continue;
    out.set(value.slice(0, cut).toLowerCase(), value.slice(cut + 2));
  }
  return out;
}

/**
 * Las competidoras pequeñas de un lote, sin repetir (por dominio o nombre): primero
 * las que guardó el lote como filas, después las que el escritor saltó. Las del
 * escritor son las de su ÚLTIMA escritura (el escritor reemplaza la lista).
 */
export function collectCompetitorSmallCompanies(input: {
  batchMetadata: unknown;
  candidates: readonly CompetitorSmallCompanyCandidate[];
}): CompetitorSmallCompany[] {
  const batchMetadata = asRecord(input.batchMetadata);
  const seen = new Set<string>();
  const out: CompetitorSmallCompany[] = [];
  const add = (company: CompetitorSmallCompany) => {
    const key = company.domain ?? `name:${company.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...company, key });
  };

  for (const candidate of input.candidates) {
    if (candidate.status !== 'discarded' || !isCompetitorSmallCompany(candidate.metadata)) continue;
    const metadata = asRecord(candidate.metadata);
    add({
      key: '',
      name: candidate.name,
      domain: cleanDomain(candidate.domain ?? candidate.website),
      website: text(candidate.website),
      countryCode: text(candidate.country_code),
      sizeDetail: text(asRecord(metadata?.claude_rescue)?.discard_detail),
      competitorReason: text(asRecord(metadata?.relationship)?.evidence),
      origin: 'size_review',
    });
  }

  const reasons = blockedReasonsByName(batchMetadata);
  const samples = Array.isArray(batchMetadata?.writer_omitted_samples) ? batchMetadata.writer_omitted_samples : [];
  for (const raw of samples) {
    const sample = asRecord(raw);
    const name = text(sample?.name);
    if (!sample || sample.gate !== 'icp_size' || !name) continue;
    const website = text(sample.url);
    add({
      key: '',
      name,
      domain: cleanDomain(text(sample.domain) ?? website),
      website,
      countryCode: null,
      sizeDetail: reasons.get(name.toLowerCase()) ?? null,
      competitorReason: text(sample.source_snippet),
      origin: 'confirmed_size',
    });
  }
  return out;
}
