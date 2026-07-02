// Agente 2A — Company Consistency Checker
// Hito 17A.9G — Evalúa si un candidato Apollo pertenece a la empresa seleccionada.
// Función pura: sin red, sin DB. Segura para tests unitarios.

export type CompanyConsistencyStatus =
  | 'match'
  | 'possible_mismatch'
  | 'possible_related_domain'
  | 'unknown';

export interface CompanyConsistencyResult {
  status: CompanyConsistencyStatus;
  email_domain: string | null;
  expected_domain: string | null;
  organization_name: string | null;
  organization_domain: string | null;
  signals: string[];
  review_required: boolean;
  explanation: string;
}

export interface CompanyConsistencyInput {
  email: string | null | undefined;
  apolloOrganizationName: string | null | undefined;
  apolloOrganizationWebsiteUrl: string | null | undefined;
  companyDomain: string | null | undefined;
  companyName: string | null | undefined;
}

// ── Dominios de correo genérico (señal neutral) ────────────────
// Emails con estos dominios no indican pertenencia a ninguna empresa.

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'yahoo.es',
  'yahoo.com.mx',
  'yahoo.com.co',
  'outlook.com',
  'hotmail.com',
  'hotmail.es',
  'live.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'mail.com',
  'gmx.com',
  'yandex.com',
  'zoho.com',
  'tutanota.com',
  'fastmail.com',
  'hey.com',
]);

// ── Normalización de dominios ──────────────────────────────────

/** Extrae y normaliza un dominio desde una URL o string de dominio. */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  // Intentar parsear como URL si tiene protocolo.
  try {
    const withProto = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const url = new URL(withProto);
    const host = url.hostname.replace(/^www\./, '');
    return host.length > 0 ? host : null;
  } catch {
    // Si no es una URL válida, tratarlo como dominio plano.
    const plain = trimmed.split('/')[0].replace(/^www\./, '');
    return plain.length > 0 ? plain : null;
  }
}

/** Extrae el dominio del email (parte después de @). */
export function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;
  const idx = email.lastIndexOf('@');
  if (idx < 0) return null;
  const domain = email.slice(idx + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}

// ── Normalización de nombre de empresa ────────────────────────

function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null;
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function namesAreSimilar(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Coincidencia parcial: uno contiene al otro (mínimo 4 chars para evitar falsos positivos).
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

// ── Evaluación de consistencia ─────────────────────────────────

/**
 * Evalúa si un candidato Apollo es consistente con la empresa seleccionada.
 *
 * No bloquea candidatos. Solo agrega metadata de señal para revisión humana.
 * Señales evaluadas:
 *  A. Dominio del email del candidato vs dominio de la empresa.
 *  B. Dominio de la organización Apollo vs dominio de la empresa.
 *  C. Nombre de la organización Apollo vs nombre de la empresa.
 */
export function checkCompanyConsistency(
  input: CompanyConsistencyInput,
): CompanyConsistencyResult {
  const { email, apolloOrganizationName, apolloOrganizationWebsiteUrl, companyDomain, companyName } =
    input;

  const expectedDomain = normalizeDomain(companyDomain);
  const emailDomain = extractEmailDomain(email);
  const apolloOrgDomain = normalizeDomain(apolloOrganizationWebsiteUrl);
  const normApolloOrgName = normalizeCompanyName(apolloOrganizationName);
  const normCompanyName = normalizeCompanyName(companyName);

  const signals: string[] = [];
  let matchCount = 0;
  let mismatchCount = 0;

  // A. Señal de dominio de email.
  if (emailDomain) {
    const isGeneric = GENERIC_EMAIL_DOMAINS.has(emailDomain);
    if (isGeneric) {
      signals.push('email_domain_is_generic');
    } else if (expectedDomain) {
      if (emailDomain === expectedDomain) {
        signals.push('email_domain_matches_company_domain');
        matchCount += 1;
      } else {
        signals.push('email_domain_differs_from_company_domain');
        mismatchCount += 1;
      }
    }
  }

  // B. Señal de dominio de organización Apollo.
  if (apolloOrgDomain && expectedDomain) {
    if (apolloOrgDomain === expectedDomain) {
      signals.push('apollo_organization_domain_matches');
      matchCount += 1;
    } else {
      signals.push('apollo_organization_domain_differs');
      mismatchCount += 1;
    }
  }

  // C. Señal de nombre de organización Apollo.
  if (normApolloOrgName && normCompanyName) {
    if (namesAreSimilar(normApolloOrgName, normCompanyName)) {
      signals.push('apollo_organization_name_matches');
      matchCount += 1;
    } else {
      signals.push('apollo_organization_name_differs');
      mismatchCount += 1;
    }
  }

  // Determinar status y review_required.
  const status = resolveStatus({ signals, matchCount, mismatchCount, normApolloOrgName, normCompanyName });
  const review_required = status === 'possible_mismatch' || status === 'possible_related_domain';
  const explanation = buildExplanation(status, { emailDomain, expectedDomain, apolloOrgDomain });

  return {
    status,
    email_domain: emailDomain,
    expected_domain: expectedDomain,
    organization_name: apolloOrganizationName?.trim() ?? null,
    organization_domain: apolloOrgDomain,
    signals,
    review_required,
    explanation,
  };
}

function resolveStatus(ctx: {
  signals: string[];
  matchCount: number;
  mismatchCount: number;
  normApolloOrgName: string | null;
  normCompanyName: string | null;
}): CompanyConsistencyStatus {
  const { signals, matchCount, mismatchCount, normApolloOrgName, normCompanyName } = ctx;

  const onlyGenericEmail =
    signals.length === 1 && signals[0] === 'email_domain_is_generic';
  const noSignals = signals.length === 0;

  if (noSignals || onlyGenericEmail) return 'unknown';
  if (matchCount > 0 && mismatchCount === 0) return 'match';
  if (mismatchCount === 0) return 'unknown';

  // Hay señal de mismatch. ¿Los nombres parecen relacionados (sin motor complejo)?
  // Si el nombre de la org Apollo es similar al nombre de la empresa, podría ser
  // una filial o marca relacionada. Marcamos possible_related_domain para no alarmar.
  if (normApolloOrgName && normCompanyName && namesAreSimilar(normApolloOrgName, normCompanyName)) {
    return 'possible_related_domain';
  }

  return 'possible_mismatch';
}

function buildExplanation(
  status: CompanyConsistencyStatus,
  ctx: {
    emailDomain: string | null;
    expectedDomain: string | null;
    apolloOrgDomain: string | null;
  },
): string {
  switch (status) {
    case 'match':
      return 'Las señales disponibles son consistentes con la empresa seleccionada.';
    case 'possible_mismatch': {
      const parts: string[] = [];
      if (ctx.emailDomain && ctx.expectedDomain && ctx.emailDomain !== ctx.expectedDomain) {
        parts.push(`El dominio del correo (${ctx.emailDomain}) no coincide con el de la empresa (${ctx.expectedDomain}).`);
      }
      if (ctx.apolloOrgDomain && ctx.expectedDomain && ctx.apolloOrgDomain !== ctx.expectedDomain) {
        parts.push(`El dominio de la organización Apollo (${ctx.apolloOrgDomain}) difiere del de la empresa (${ctx.expectedDomain}).`);
      }
      return parts.length > 0
        ? parts.join(' ')
        : 'El candidato podría no pertenecer a la empresa seleccionada.';
    }
    case 'possible_related_domain':
      return 'El dominio no coincide exactamente, pero el nombre de la organización parece relacionado con la empresa seleccionada. Podría ser una filial o marca del grupo.';
    case 'unknown':
      return 'No hay señales suficientes para determinar la consistencia con la empresa seleccionada.';
  }
}
