/**
 * Agente 1 · «Competidores de una empresa» — lo GRATUITO, filtrado por Claude
 * (puro; el juez y las lecturas se inyectan).
 *
 * Decisión de la dueña (14-10): conectar a Competidores lo que ya usa la búsqueda
 * por criterios —registros oficiales del país y banco de empresas— sin que entren
 * «empresas de la misma industria» que no le compiten a nadie. Por eso:
 *
 *   · en Colombia se lee por el CIIU EXACTO de la referencia (si está en el
 *     registro y su código es de la industria elegida), no por toda la macro;
 *   · Claude (sin búsqueda web) elige de la lista cuáles compiten; si el juez no
 *     responde, no entra NINGUNA (nunca una empresa sin filtrar);
 *   · la referencia misma nunca se ofrece al juez (mismo dominio o mismo nombre).
 *
 * AGENT1-COMPETITOR-PREFILTER-1 (auditoría 16-10) — antes del juez, y sin gastar,
 * también salen: la referencia por la etiqueta de su dominio (alpina.com ⇔
 * «Alpina»), por su número fiscal, las empresas de su grupo según la búsqueda en
 * árbol (`agent1_company_relationships`, migración 148) y los competidores de
 * UBITS (Crehana, Platzi, Coursera…): nunca son prospectos, ni siquiera cuando
 * la referencia misma es uno de ellos.
 */

import type { CandidateRelationshipEvidence, ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import type {
  CompetitorJudgeInput,
  CompetitorJudgeItem,
  CompetitorJudgeOutcome,
} from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge';
import {
  isUbitsCompetitorDomain,
  UBITS_COMPETITOR_DOMAIN_LABELS,
} from '@/server/agents/prospecting-toolkit/claude-classifier/ubits-competitors';
import { isRegistrableDomain, ownDomainLabel } from '@/server/agents/prospecting-toolkit/claude-classifier/site-match';
import { buildFiscalIdentityKey, canonicalizeFiscalIdentifier } from '@/server/agents/prospecting-toolkit/fiscal-identity';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';

/** Cuántas sacar del banco para que el juez elija (las no elegidas vuelven al banco). */
export const COMPETITOR_BANK_DRAW_LIMIT = 40;

/** Palabras de forma societaria o de relleno que no identifican a la empresa. */
const NAME_NOISE = new Set([
  's', 'a', 'sa', 'sas', 'saa', 'bic', 'ltda', 'ltd', 'inc', 'cia', 'y', 'e', 'de', 'del', 'la', 'el', 'los', 'las',
  'sociedad', 'anonima', 'limitada', 'compania', 'company', 'corp', 'corporation', 'grupo', 'group',
]);

/** «Almacenera del Agro S.A. (ALMAGRO)» → «almacenera agro» (minúsculas, sin tildes). */
export function normalizeReferenceName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0 && !NAME_NOISE.has(word))
    .join(' ');
}

/**
 * Patrón `ilike` para buscar la referencia por nombre en el registro (palabras en
 * orden, con lo que sea entre ellas). `null` ⇒ el nombre no deja nada útil.
 */
export function buildReferenceNamePattern(name: string): string | null {
  const words = normalizeReferenceName(name).split(' ').filter((word) => word.length >= 3).slice(0, 4);
  if (words.length === 0) return null;
  return `%${words.join('%')}%`;
}

/**
 * Los CIIU de las filas del registro que son la referencia, sólo los que caen en la
 * industria elegida (si no, la capa gratuita los rechazaría igual). Orden estable.
 */
export function pickReferenceActivityCodes(
  rows: ReadonlyArray<{ ciiu: string | null }>,
  macroCodes: readonly string[],
  normalizeCode: (code: string) => string | null,
): string[] {
  const allowed = new Set(macroCodes);
  const picked = new Set<string>();
  for (const row of rows) {
    const code = row.ciiu ? normalizeCode(row.ciiu) : null;
    if (code && allowed.has(code)) picked.add(code);
  }
  return [...picked].sort();
}

/**
 * ¿Se busca el CIIU de la referencia? Sólo si la búsqueda es en Colombia Y la
 * referencia es colombiana: una empresa de otro país no está en el registro y su
 * nombre puede coincidir con otra (Prod 15-10: «Grupo Caballero», mexicana, cayó
 * en una confeccionista colombiana «… Caballero» y se leyó el CIIU 1410).
 */
export function shouldResolveReferenceActivityCodes(
  searchCountryCode: string,
  reference: { homeCountryCode?: string | null },
): boolean {
  return searchCountryCode === 'CO' && reference.homeCountryCode === 'CO';
}

/**
 * ¿Esta fila del registro ES la referencia? Coincidencia EXACTA: misma web, o el
 * mismo nombre normalizado completo de al menos dos palabras (una sola palabra
 * —«caballero»— es demasiado común para identificar a nadie).
 */
export function isExactReferenceRow(
  reference: { name: string; domain: string | null },
  row: { legalName: string | null; websiteDomain: string | null },
): boolean {
  const refDomain = reference.domain?.toLowerCase().replace(/^www\./, '') ?? null;
  const rowDomain = row.websiteDomain?.toLowerCase().replace(/^www\./, '') ?? null;
  if (refDomain && rowDomain && refDomain === rowDomain) return true;
  const refName = normalizeReferenceName(reference.name);
  if (refName.split(' ').length < 2 || !row.legalName) return false;
  return normalizeReferenceName(row.legalName) === refName;
}

function cleanCompanyDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase().replace(/^www\./, '') ?? '';
  return domain ? domain : null;
}

/**
 * Mismo sitio: igual, o subdominio del otro sólo si el padre es un dominio propio
 * (`portal.alpina.com` ⇔ `alpina.com`; nunca `x.blogspot.com` ⇔ `blogspot.com`).
 * Equivale a `sameSite` de `claude-classifier/domain-finder.ts` con la guarda de
 * `site-match.ts` (no se importa de allí: arrastra todo el buscador de sitios).
 */
function sameCompanySite(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith(`.${b}`)) return isRegistrableDomain(b);
  if (b.endsWith(`.${a}`)) return isRegistrableDomain(a);
  return false;
}

/** Formas societarias de `companyNameKey` (claude-classifier/company-search.ts). */
const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  's', 'a', 'sa', 'sas', 'saa', 'sac', 'ltda', 'ltd', 'inc', 'llc', 'corp', 'spa', 'srl', 'cv', 'rl', 'de', 'y', 'e', 'cia',
]);

/** «Grupo Éxito S.A.» → «grupoexito»: el nombre como lo escribiría un dominio. */
function compactLegalName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token && !LEGAL_FORM_TOKENS.has(token))
    .join('');
}

/** Etiquetas del dominio que pueden ser el nombre: la primera y la propia (sin sufijo público). */
function domainNameLabels(domain: string): string[] {
  const first = domain.split('.')[0] ?? '';
  const own = ownDomainLabel(domain) ?? '';
  return [...new Set([first, own].filter((label) => label.length > 0))];
}

/**
 * ¿El dominio ES el nombre de la referencia? (alpina.com ⇔ «Alpina S.A.»). Es la
 * regla de `isReferenceCompany` de `claude-classifier/company-search.ts` (no
 * exportada): nombre sin forma societaria, sin espacios, igual a la etiqueta del
 * dominio. Además se prueba sin «grupo»/«group» (`normalizeReferenceName`), con al
 * menos 3 letras para que una sigla suelta no saque a nadie.
 */
function domainCarriesReferenceName(referenceName: string, domain: string): boolean {
  const keys = new Set<string>();
  const legal = compactLegalName(referenceName);
  if (legal) keys.add(legal);
  const plain = normalizeReferenceName(referenceName).replace(/ /g, '');
  if (plain.length >= 3) keys.add(plain);
  if (keys.size === 0) return false;
  return domainNameLabels(domain).some((label) => keys.has(label));
}

/**
 * ¿Es la referencia misma? Mismo sitio (o subdominio), mismo nombre normalizado,
 * o un dominio que es su nombre (alpina.com ⇔ «Alpina»).
 */
export function isReferenceItself(
  reference: { name: string; domain: string | null },
  company: { name: string | null; domain: string | null },
): boolean {
  const refDomain = cleanCompanyDomain(reference.domain);
  const domain = cleanCompanyDomain(company.domain);
  if (refDomain && domain && sameCompanySite(refDomain, domain)) return true;
  if (domain && domainCarriesReferenceName(reference.name, domain)) return true;
  const refName = normalizeReferenceName(reference.name);
  return refName.length > 0 && company.name !== null && normalizeReferenceName(company.name) === refName;
}

/**
 * Lo que se sabe de la referencia más allá de su nombre y su web, cargado UNA vez
 * por corrida (servidor): sus números fiscales (con país) y su grupo según la
 * búsqueda en árbol. Vacío ⇒ sólo corren las reglas de nombre y dominio.
 */
export type CompetitorReferenceExclusion = {
  /** Claves fiscales con país (`CO:900123456`, de `buildFiscalIdentityKey`). */
  taxKeys: ReadonlySet<string>;
  /** Dominios de las empresas de su grupo (matriz, filiales, otros países). */
  relatedDomains: ReadonlySet<string>;
  /** Nombres normalizados (`normalizeReferenceName`) de las empresas de su grupo. */
  relatedNames: ReadonlySet<string>;
};

export const EMPTY_COMPETITOR_REFERENCE_EXCLUSION: CompetitorReferenceExclusion = {
  taxKeys: new Set(),
  relatedDomains: new Set(),
  relatedNames: new Set(),
};

/** Clave fiscal comparable (con país); `null` si falta el número o el país. */
export function competitorTaxKey(
  taxId: string | null | undefined,
  countryCode: string | null | undefined,
): string | null {
  return buildFiscalIdentityKey({ canonical: canonicalizeFiscalIdentifier(taxId, countryCode), countryCode });
}

/** Por qué una empresa no llega al juez (telemetría). */
export type CompetitorPrefilterReason = 'reference_itself' | 'reference_tax_id' | 'reference_group' | 'ubits_competitor';

/** ¿Es un competidor de UBITS? Por la etiqueta del dominio o por el nombre exacto («Platzi S.A.S.»). */
export function isUbitsCompetitorCompany(company: { name: string | null; domain: string | null }): boolean {
  if (company.domain && isUbitsCompetitorDomain(company.domain)) return true;
  const compact = company.name ? compactLegalName(company.name) : '';
  return compact.length > 0 && UBITS_COMPETITOR_DOMAIN_LABELS.has(compact);
}

/**
 * El filtro determinista previo al juez (sin gasto). `null` ⇒ se ofrece al juez.
 * El número fiscal sólo compara cuando las dos puntas lo tienen y del mismo país.
 */
export function competitorPrefilterReason(
  reference: { name: string; domain: string | null },
  company: { name: string | null; domain: string | null; taxId?: string | null; countryCode?: string | null },
  exclusion: CompetitorReferenceExclusion = EMPTY_COMPETITOR_REFERENCE_EXCLUSION,
): CompetitorPrefilterReason | null {
  if (isReferenceItself(reference, company)) return 'reference_itself';
  const taxKey = exclusion.taxKeys.size > 0 ? competitorTaxKey(company.taxId, company.countryCode) : null;
  if (taxKey && exclusion.taxKeys.has(taxKey)) return 'reference_tax_id';
  const domain = cleanCompanyDomain(company.domain);
  if (domain && [...exclusion.relatedDomains].some((related) => sameCompanySite(related, domain))) {
    return 'reference_group';
  }
  const name = company.name ? normalizeReferenceName(company.name) : '';
  if (name.length >= 3 && exclusion.relatedNames.has(name)) return 'reference_group';
  if (isUbitsCompetitorCompany(company)) return 'ubits_competitor';
  return null;
}

/** Una fila de `agent1_company_relationships` (migración 148), sólo lo que hace falta. */
export type CompetitorReferenceRelationshipRow = {
  root_name: string | null;
  root_domain: string | null;
  root_account_id: string | null;
  related_name: string | null;
  related_domain: string | null;
};

/** ¿Esta punta de la relación es la referencia? Por la cuenta, el sitio o el nombre. */
function isReferenceEnd(
  reference: { name: string; domain: string | null; accountId?: string | null },
  end: { name: string | null; domain: string | null; accountId?: string | null },
): boolean {
  if (reference.accountId && end.accountId && reference.accountId === end.accountId) return true;
  const refDomain = cleanCompanyDomain(reference.domain);
  const domain = cleanCompanyDomain(end.domain);
  if (refDomain && domain) return sameCompanySite(refDomain, domain);
  const refName = normalizeReferenceName(reference.name);
  return refName.split(' ').length >= 2 && !!end.name && normalizeReferenceName(end.name) === refName;
}

/** Las matrices de la referencia (filas donde ella es la empresa relacionada). */
export function referenceRootDomains(
  reference: { name: string; domain: string | null; accountId?: string | null },
  rows: readonly CompetitorReferenceRelationshipRow[],
): string[] {
  const roots = rows
    .filter((row) => isReferenceEnd(reference, { name: row.related_name, domain: row.related_domain }))
    .map((row) => cleanCompanyDomain(row.root_domain))
    .filter((domain): domain is string => domain !== null);
  return [...new Set(roots)];
}

/**
 * El grupo de la referencia según la búsqueda en árbol: lo que cuelga de ella
 * (filiales, otros países), su matriz y lo que cuelga de su matriz (hermanas). Se
 * suman sus números fiscales (de su cuenta o del registro, con país).
 */
export function buildCompetitorReferenceExclusion(input: {
  reference: { name: string; domain: string | null; accountId?: string | null };
  taxIds: ReadonlyArray<{ taxId: string | null; countryCode: string | null }>;
  relationships: readonly CompetitorReferenceRelationshipRow[];
}): CompetitorReferenceExclusion {
  const { reference } = input;
  const rootDomains = new Set(referenceRootDomains(reference, input.relationships));
  const relatedDomains = new Set<string>();
  const relatedNames = new Set<string>();
  const add = (name: string | null, domain: string | null) => {
    const clean = cleanCompanyDomain(domain);
    if (clean) relatedDomains.add(clean);
    const key = name ? normalizeReferenceName(name) : '';
    if (key.length >= 3) relatedNames.add(key);
  };
  for (const row of input.relationships) {
    const rootIsReference = isReferenceEnd(reference, {
      name: row.root_name,
      domain: row.root_domain,
      accountId: row.root_account_id,
    });
    const rootDomain = cleanCompanyDomain(row.root_domain);
    const rootIsParent = rootDomain !== null && rootDomains.has(rootDomain);
    if (rootIsReference || rootIsParent) add(row.related_name, row.related_domain);
    if (rootIsParent) add(row.root_name, row.root_domain);
  }
  // La referencia misma ya sale por `isReferenceItself`: no se repite aquí.
  const refDomain = cleanCompanyDomain(reference.domain);
  if (refDomain) relatedDomains.delete(refDomain);
  relatedNames.delete(normalizeReferenceName(reference.name));
  const taxKeys = new Set(
    input.taxIds.map((t) => competitorTaxKey(t.taxId, t.countryCode)).filter((key): key is string => key !== null),
  );
  return { taxKeys, relatedDomains, relatedNames };
}

/** Lecturas (servidor) para armar la exclusión; cada una puede lanzar o devolver vacío. */
export type CompetitorReferenceExclusionReader = {
  /** Número fiscal y país de la cuenta de SellUp de la que salió la referencia. */
  readAccountTaxId: (accountId: string) => Promise<{ taxId: string | null; countryCode: string | null } | null>;
  /** Filas donde la referencia es la empresa de partida o la relacionada. */
  readRelationships: (filter: { domain: string | null; accountId: string | null }) => Promise<CompetitorReferenceRelationshipRow[]>;
  /** Filas que cuelgan de sus matrices (hermanas). */
  readRelationshipsByRootDomains: (rootDomains: readonly string[]) => Promise<CompetitorReferenceRelationshipRow[]>;
};

export type CompetitorReferenceExclusionLoad = {
  exclusion: CompetitorReferenceExclusion;
  telemetry: Record<string, unknown>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Carga UNA vez por corrida lo que se sabe de la referencia. Nunca lanza: una
 * lectura que falla sólo apaga su regla (queda anotado en la telemetría) y la
 * corrida sigue con las reglas de nombre y dominio.
 */
export async function loadCompetitorReferenceExclusion(
  reference: { name: string; domain: string | null; accountId?: string | null },
  reader: CompetitorReferenceExclusionReader,
  options: { taxIds?: ReadonlyArray<{ taxId: string | null; countryCode: string | null }>; withAccountTaxId?: boolean } = {},
): Promise<CompetitorReferenceExclusionLoad> {
  const accountId = reference.accountId && UUID_PATTERN.test(reference.accountId) ? reference.accountId : null;
  const domain = cleanCompanyDomain(reference.domain);
  const taxIds = [...(options.taxIds ?? [])];
  const telemetry: Record<string, unknown> = {};

  if (options.withAccountTaxId && accountId) {
    try {
      const account = await reader.readAccountTaxId(accountId);
      if (account?.taxId) taxIds.push(account);
      telemetry.account_tax_id = account?.taxId ? 'found' : 'absent';
    } catch {
      telemetry.account_tax_id = 'read_failed';
    }
  }

  let relationships: CompetitorReferenceRelationshipRow[] = [];
  if (domain || accountId) {
    try {
      relationships = await reader.readRelationships({ domain, accountId });
      const roots = referenceRootDomains(reference, relationships);
      if (roots.length > 0) relationships = [...relationships, ...(await reader.readRelationshipsByRootDomains(roots))];
      telemetry.relationships = relationships.length > 0 ? 'found' : 'absent';
    } catch {
      // Sin la tabla (o sin permiso) la regla del grupo no corre: nunca tumba la corrida.
      relationships = [];
      telemetry.relationships = 'read_failed';
    }
  } else {
    telemetry.relationships = 'no_reference_key';
  }

  const exclusion = buildCompetitorReferenceExclusion({ reference, taxIds, relationships });
  return {
    exclusion,
    telemetry: {
      ...telemetry,
      tax_keys: exclusion.taxKeys.size,
      related_domains: exclusion.relatedDomains.size,
      related_names: exclusion.relatedNames.size,
    },
  };
}

/** Opciones del filtro previo: lo cargado de la referencia y a quién avisar de cada descarte. */
export type CompetitorPrefilterOptions = {
  exclusion?: CompetitorReferenceExclusion;
  onPrefiltered?: (reason: CompetitorPrefilterReason) => void;
};

/** `true` ⇒ se ofrece al juez; si no, avisa el motivo. */
export function passesCompetitorPrefilter(
  reference: { name: string; domain: string | null },
  company: Parameters<typeof competitorPrefilterReason>[1],
  options: CompetitorPrefilterOptions | undefined,
): boolean {
  const reason = competitorPrefilterReason(reference, company, options?.exclusion);
  if (reason) options?.onPrefiltered?.(reason);
  return reason === null;
}

export type CompetitorJudgeContext = Omit<CompetitorJudgeInput, 'items'>;

export type CompetitorJudgeFn = (input: CompetitorJudgeInput) => Promise<CompetitorJudgeOutcome | null>;

/** Las del catálogo que el juez eligió, con su relación. `null` ⇒ el juez no respondió. */
export async function selectCompetitorCompanies(
  companies: readonly CountrySourceCompany[],
  context: CompetitorJudgeContext,
  judge: CompetitorJudgeFn,
  options?: CompetitorPrefilterOptions,
): Promise<CountrySourceCompany[] | null> {
  const offered = companies
    .map((company, index) => ({ company, key: `e${index + 1}` }))
    .filter(({ company }) =>
      passesCompetitorPrefilter(
        context.reference,
        { name: company.legalName, domain: company.domain, taxId: company.taxId, countryCode: company.countryCode },
        options,
      ),
    );
  if (offered.length === 0) return [];
  const items: CompetitorJudgeItem[] = offered.map(({ company, key }) => ({
    key,
    name: company.legalName ?? 'Sin nombre',
    activity: company.declaredIndustry,
    activityCode: company.industryCode,
    domain: company.domain,
    city: company.city,
  }));
  const outcome = await judge({ ...context, items });
  if (!outcome) return null;
  const byKey = new Map(offered.map((entry) => [entry.key, entry.company]));
  return outcome.competitors.flatMap((verdict) => {
    const company = byKey.get(verdict.key);
    return company
      ? [{ ...company, competitorRelationship: { referenceCompanyName: context.reference.name, reason: verdict.reason } }]
      : [];
  });
}

/** Lo que Claude sabe de una empresa del banco: lo que guardó la búsqueda que la trajo. */
function bankActivity(candidate: ProspectingPipelineCandidate): string | null {
  return candidate.sourceSnippet ?? candidate.sourceTitle ?? null;
}

/** Las del banco que el juez eligió (índices), con su relación. `null` ⇒ el juez no respondió. */
export async function selectCompetitorBankCandidates(
  candidates: readonly ProspectingPipelineCandidate[],
  context: CompetitorJudgeContext,
  judge: CompetitorJudgeFn,
  options?: CompetitorPrefilterOptions,
): Promise<Array<{ index: number; relationshipEvidence: CandidateRelationshipEvidence }> | null> {
  const offered = candidates
    .map((candidate, index) => ({ candidate, index, key: `b${index + 1}` }))
    .filter(({ candidate }) =>
      passesCompetitorPrefilter(
        context.reference,
        {
          name: candidate.name,
          domain: candidate.domain,
          // Sólo la identidad oficial fuerte (la que el escritor guardaría como NIT).
          taxId: candidate.officialSourceIdentity?.typedColumns.tax_identifier ?? null,
          countryCode: candidate.countryCode,
        },
        options,
      ),
    );
  if (offered.length === 0) return [];
  const outcome = await judge({
    ...context,
    items: offered.map(({ candidate, key }) => ({
      key,
      name: candidate.name,
      activity: bankActivity(candidate),
      activityCode: null,
      domain: candidate.domain,
      city: null,
    })),
  });
  if (!outcome) return null;
  const byKey = new Map(offered.map((entry) => [entry.key, entry.index]));
  return outcome.competitors.flatMap((verdict) => {
    const index = byKey.get(verdict.key);
    return index === undefined
      ? []
      : [
          {
            index,
            relationshipEvidence: {
              kind: 'competitor_of' as const,
              referenceCompanyName: context.reference.name,
              evidenceUrl: null,
              evidence: verdict.reason,
            },
          },
        ];
  });
}

/** Lo que el juez de verdad miró en una fuente (telemetría de la corrida). */
export type CompetitorJudgeTallyEntry = {
  calls: number;
  /** Filas que se le ofrecieron (ya sin las del filtro previo). */
  offered: number;
  /** Filas que juzgó de verdad (`outcome.judged`: sólo lotes que respondieron, con su tope). */
  judged: number;
  selected: number;
  /** Llamadas sin respuesta (null o error). */
  unanswered: number;
  /** Filas que el juez no alcanzó a mirar por su tope (auditoría 21-10). */
  dropped?: number;
  /** Lotes del juez que no respondieron mientras otros sí. */
  failedChunks?: number;
};

export type CompetitorJudgeTally = Record<string, CompetitorJudgeTallyEntry>;

const EMPTY_TALLY_ENTRY: CompetitorJudgeTallyEntry = { calls: 0, offered: 0, judged: 0, selected: 0, unanswered: 0 };

/**
 * El mismo juez, anotando por fuente lo que juzgó. El acumulador es de la corrida
 * (uno por llamada a la capa gratuita); cada anotación reemplaza la entrada.
 */
export function tallyCompetitorJudge(
  tally: CompetitorJudgeTally,
  source: string,
  judge: CompetitorJudgeFn,
): CompetitorJudgeFn {
  const record = (offered: number, outcome: CompetitorJudgeOutcome | null) => {
    const prev = tally[source] ?? EMPTY_TALLY_ENTRY;
    tally[source] = {
      calls: prev.calls + 1,
      offered: prev.offered + offered,
      judged: prev.judged + (outcome?.judged ?? 0),
      selected: prev.selected + (outcome?.competitors.length ?? 0),
      unanswered: prev.unanswered + (outcome ? 0 : 1),
    };
    // Sólo cuando hubo algo que no se miró: la forma de siempre no cambia.
    const dropped = (prev.dropped ?? 0) + (outcome?.dropped ?? 0);
    const failedChunks = (prev.failedChunks ?? 0) + (outcome?.failedChunks ?? 0);
    if (dropped > 0) tally[source] = { ...tally[source], dropped };
    if (failedChunks > 0) tally[source] = { ...tally[source], failedChunks };
  };
  return async (input) => {
    try {
      const outcome = await judge(input);
      record(input.items.length, outcome);
      return outcome;
    } catch (err) {
      record(input.items.length, null);
      throw err;
    }
  };
}

/**
 * Auditoría 16-10 (K): la capa gratuita anota `competitor_selection.judged` con lo
 * que la puerta aceptó (`gate.acceptedCompanies.length`), no con lo que el juez
 * miró (sin la referencia ni competidores de UBITS, con el tope de lotes y sin los
 * lotes caídos). Se corrige aquí con el `judged` real del juez; lo aceptado por la
 * puerta queda en `accepted_by_gate` y lo ofrecido tras el filtro en `offered`.
 */
export function withRealCompetitorJudgedCount(
  telemetry: Record<string, unknown>,
  tally: CompetitorJudgeTally,
): Record<string, unknown> {
  const selection = telemetry.competitor_selection;
  if (!selection || typeof selection !== 'object') return telemetry;
  const previous = selection as Record<string, unknown>;
  const free = tally.free_layer ?? EMPTY_TALLY_ENTRY;
  return {
    ...telemetry,
    competitor_selection: {
      ...previous,
      accepted_by_gate: previous.judged ?? null,
      offered: free.offered,
      judged: free.judged,
    },
  };
}
