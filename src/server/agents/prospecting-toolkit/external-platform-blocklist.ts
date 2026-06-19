/**
 * External Platform Blocklist — Hito 16AB.43.30
 *
 * Bloquea fuentes externas que no representan sitios propios de empresas
 * candidatas: medios editoriales, foros, marketplaces, directorios, sitios
 * de reseñas, redes sociales, plataformas educativas, repositorios de
 * código, etc.
 *
 * Sin IA. Sin llamadas externas. Determinístico.
 *
 * Se ejecuta ANTES del business-fit gate y ANTES del target cap.
 */

export type ExternalPlatformType =
  | 'editorial_media'
  | 'forum_or_community'
  | 'marketplace'
  | 'directory'
  | 'review_site'
  | 'social_network'
  | 'glossary_or_educational_content'
  | 'code_repository'
  | 'unknown_external_platform';

export type ExternalPlatformGateResult = {
  allowed: boolean;
  platformType?: ExternalPlatformType;
  reason?: string;
  matchedDomain?: string;
};

// ─── Blocklist: dominio → tipo de plataforma externa ──────────────────────────

type BlocklistEntry = {
  domain: string;
  type: ExternalPlatformType;
  /** When set, only block if the URL path matches this pattern. */
  pathPattern?: string;
};

const EXTERNAL_PLATFORM_BLOCKLIST: BlocklistEntry[] = [
  // Editorial media
  { domain: 'computerweekly.com', type: 'editorial_media' },
  { domain: 'infoworld.com', type: 'editorial_media' },
  { domain: 'techcrunch.com', type: 'editorial_media' },
  { domain: 'cnet.com', type: 'editorial_media' },
  { domain: 'zdnet.com', type: 'editorial_media' },
  { domain: 'theregister.com', type: 'editorial_media' },
  { domain: 'theverge.com', type: 'editorial_media' },
  { domain: 'wired.com', type: 'editorial_media' },
  { domain: 'forbes.com', type: 'editorial_media' },
  { domain: 'bloomberg.com', type: 'editorial_media' },
  { domain: 'reuters.com', type: 'editorial_media' },
  { domain: 'elcolombiano.com', type: 'editorial_media' },
  { domain: 'eltiempo.com', type: 'editorial_media' },
  { domain: 'elespectador.com', type: 'editorial_media' },
  { domain: 'portafolio.co', type: 'editorial_media' },
  { domain: 'semana.com', type: 'editorial_media' },
  { domain: 'larepublica.co', type: 'editorial_media' },
  { domain: 'enter.co', type: 'editorial_media' },

  // Forums / communities
  { domain: 'reddit.com', type: 'forum_or_community' },
  { domain: 'quora.com', type: 'forum_or_community' },
  { domain: 'stackoverflow.com', type: 'forum_or_community' },
  { domain: 'stackexchange.com', type: 'forum_or_community' },
  { domain: 'dev.to', type: 'forum_or_community' },

  // Marketplaces
  { domain: 'b2bmarketplace.procolombia.co', type: 'marketplace' },

  // Review sites
  { domain: 'g2.com', type: 'review_site' },
  { domain: 'capterra.com', type: 'review_site' },
  { domain: 'capterra.co', type: 'review_site' },
  { domain: 'softwareadvice.com', type: 'review_site' },
  { domain: 'getapp.com', type: 'review_site' },
  { domain: 'sourceforge.net', type: 'review_site' },
  { domain: 'trustradius.com', type: 'review_site' },
  { domain: 'clutch.co', type: 'review_site' },
  { domain: 'goodfirms.co', type: 'review_site' },

  // Social networks
  { domain: 'linkedin.com', type: 'social_network' },
  { domain: 'facebook.com', type: 'social_network' },
  { domain: 'instagram.com', type: 'social_network' },
  { domain: 'youtube.com', type: 'social_network' },
  { domain: 'x.com', type: 'social_network' },
  { domain: 'twitter.com', type: 'social_network' },
  { domain: 'tiktok.com', type: 'social_network' },

  // Directories
  { domain: 'elioplus.com', type: 'directory' },
  { domain: 'crn.com', type: 'directory' },
  { domain: 'idc.com', type: 'directory' },
  { domain: 'partnerstack.com', type: 'directory' },
  { domain: 'producthunt.com', type: 'directory' },
  { domain: 'alternativeto.net', type: 'directory' },
  { domain: 'techbehemoths.com', type: 'directory' },
  { domain: 'sortlist.com', type: 'directory' },
  { domain: 'designrush.com', type: 'directory' },
  { domain: 'guiatic.com', type: 'directory' },
  { domain: 'catalogodesoftware.com', type: 'directory' },
  { domain: 'comparasoftware.com', type: 'directory' },
  { domain: 'softwareworld.co', type: 'directory' },
  { domain: 'crozdesk.com', type: 'directory' },

  // Glossary / educational content with path condition
  { domain: 'creatio.com', type: 'glossary_or_educational_content', pathPattern: '/glossary/' },
  { domain: 'creatio.com', type: 'glossary_or_educational_content', pathPattern: '/es/glossary/' },
  { domain: 'creatio.com', type: 'glossary_or_educational_content', pathPattern: '/glosario/' },

  // Code repositories
  { domain: 'github.com', type: 'code_repository' },
  { domain: 'gitlab.com', type: 'code_repository' },
  { domain: 'bitbucket.org', type: 'code_repository' },

  // Medium / blogging platforms
  { domain: 'medium.com', type: 'editorial_media' },
  { domain: 'substack.com', type: 'editorial_media' },
];

// ─── Path-based blocking for known editorial/content patterns ──────────────────
// These block any URL whose path matches regardless of domain.
// Only applies when the domain is NOT a known legitimate company domain.

const BLOCKED_PATH_PREFIXES: Array<{ prefix: string; type: ExternalPlatformType }> = [
  { prefix: '/es/cronica/', type: 'editorial_media' },
  { prefix: '/cronica/', type: 'editorial_media' },
  { prefix: '/noticia/', type: 'editorial_media' },
  { prefix: '/noticias/', type: 'editorial_media' },
  { prefix: '/news/', type: 'editorial_media' },
  { prefix: '/articles/', type: 'editorial_media' },
  { prefix: '/glossary/', type: 'glossary_or_educational_content' },
  { prefix: '/glosario/', type: 'glossary_or_educational_content' },
  { prefix: '/es/glossary/', type: 'glossary_or_educational_content' },
  { prefix: '/es/glosario/', type: 'glossary_or_educational_content' },
  { prefix: '/hub/que-es', type: 'glossary_or_educational_content' },
  { prefix: '/forum/', type: 'forum_or_community' },
  { prefix: '/forums/', type: 'forum_or_community' },
  { prefix: '/comments/', type: 'forum_or_community' },
  { prefix: '/marketplace/', type: 'marketplace' },
  { prefix: '/productos/software-servicios-ti/', type: 'marketplace' },
  { prefix: '/directory/', type: 'directory' },
  { prefix: '/partners/', type: 'directory' },
  { prefix: '/channel-partners/', type: 'directory' },
  { prefix: '/reviews/', type: 'review_site' },
  { prefix: '/compare/', type: 'review_site' },
];

// ─── Popular SaaS / tech platforms that should not be treated as candidate companies ──
// These domains appear frequently in search results but are product/service
// platforms, not B2B prospect companies.

const NON_CANDIDATE_PLATFORM_DOMAINS = new Set([
  'canva.com',
  'shopify.com',
  'wix.com',
  'squarespace.com',
  'wordpress.com',
  'weebly.com',
  'hubspot.com',
  'mailchimp.com',
  'salesforce.com',
  'zendesk.com',
  'intercom.com',
  'stripe.com',
  'paypal.com',
  'typeform.com',
  'calendly.com',
  'notion.so',
  'notion.com',
  'miro.com',
  'figma.com',
  'asana.com',
  'trello.com',
  'atlassian.com',
  'clickup.com',
  'monday.com',
  'slack.com',
  'teams.microsoft.com',
  'zoom.us',
  'loom.com',
  'hotjar.com',
]);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function extractPath(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.pathname.toLowerCase();
  } catch {
    return '';
  }
}

function matchDomain(domain: string, entryDomain: string): boolean {
  if (domain === entryDomain) return true;
  if (domain.endsWith(`.${entryDomain}`)) return true;
  return false;
}

// ─── Main gate ─────────────────────────────────────────────────────────────────

/**
 * Evalúa si un URL pertenece a una plataforma externa no persistible.
 *
 * Orden de evaluación:
 *   1. Blocklist exacta de dominios (con path condition opcional)
 *   2. Path prefixes bloqueables (cronica, glossary, marketplace, etc.)
 *   3. Plataformas SaaS/populares que no son empresas candidatas
 */
export function evaluateExternalPlatformGate(
  url: string | null,
  name?: string | null,
): ExternalPlatformGateResult {
  if (!url) {
    return { allowed: true };
  }

  const domain = extractDomain(url);
  if (!domain) {
    return { allowed: true };
  }

  const path = extractPath(url);

  // ── 1. Blocklist exacta ────────────────────────────────────────────────────
  for (const entry of EXTERNAL_PLATFORM_BLOCKLIST) {
    if (matchDomain(domain, entry.domain)) {
      if (entry.pathPattern) {
        if (path.includes(entry.pathPattern)) {
          return {
            allowed: false,
            platformType: entry.type,
            reason: `External platform (${entry.type}): domain=${entry.domain}, path matches "${entry.pathPattern}"`,
            matchedDomain: entry.domain,
          };
        }
        continue;
      }
      return {
        allowed: false,
        platformType: entry.type,
        reason: `External platform (${entry.type}): domain=${entry.domain}`,
        matchedDomain: entry.domain,
      };
    }
  }

  // ── 2. Path prefixes bloqueables ──────────────────────────────────────────
  // Only apply to domains that are not clearly candidate-company domains
  for (const bp of BLOCKED_PATH_PREFIXES) {
    if (path.startsWith(bp.prefix)) {
      return {
        allowed: false,
        platformType: bp.type,
        reason: `Path blocked (${bp.type}): "${path.slice(0, 60)}"`,
        matchedDomain: domain,
      };
    }
  }

  // ── 3. Non-candidate platform domains ──────────────────────────────────────
  if (NON_CANDIDATE_PLATFORM_DOMAINS.has(domain)) {
    return {
      allowed: false,
      platformType: 'unknown_external_platform',
      reason: `Non-candidate platform domain: ${domain}`,
      matchedDomain: domain,
    };
  }

  return { allowed: true };
}
