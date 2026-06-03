import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  normalizeCompanyName,
  normalizeDomain,
} from '@/server/agents/prospecting-toolkit/normalization';

interface CheckItem {
  index: number;
  company_name: string;
  country_code?: string | null;
  domain?: string | null;
  website?: string | null;
  tax_identifier?: string | null;
}

interface DuplicateResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json() as { items?: CheckItem[] };
    const items: CheckItem[] = body.items ?? [];

    const results: DuplicateResult[] = items.map((item) => ({
      index: item.index,
      duplicate_status: 'no_match' as const,
    }));

    if (items.length === 0) return NextResponse.json(results);

    const [{ data: existingCandidates }, { data: existingAccounts }] = await Promise.all([
      supabase
        .from('prospect_candidates')
        .select('normalized_name, country_code, domain, tax_identifier')
        .not('status', 'eq', 'discarded'),
      supabase
        .from('accounts')
        .select('normalized_name, country_code, domain, tax_identifier')
        .is('deleted_at', null),
    ]);

    const candidates = existingCandidates ?? [];
    const accounts = existingAccounts ?? [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.company_name) {
        results[i].duplicate_status = 'insufficient_data';
        continue;
      }

      const normalizedName = normalizeCompanyName(item.company_name);
      const itemDomain =
        normalizeDomain(item.domain ?? '') ??
        normalizeDomain(item.website ?? '');

      let found: 'possible_duplicate' | 'exact_duplicate' | null = null;
      let reason: string | undefined;

      if (item.tax_identifier) {
        const taxMatch = [
          ...candidates.filter((c) => c.tax_identifier === item.tax_identifier),
          ...accounts.filter((a) => a.tax_identifier === item.tax_identifier),
        ];
        if (taxMatch.length > 0) { found = 'exact_duplicate'; reason = 'Mismo identificador fiscal'; }
      }

      if (itemDomain && !found) {
        const domainMatch = [
          ...candidates.filter((c) => c.domain === itemDomain),
          ...accounts.filter((a) => a.domain === itemDomain),
        ];
        if (domainMatch.length > 0) { found = 'exact_duplicate'; reason = 'Mismo dominio web'; }
      }

      if (!found && normalizedName.length >= 3) {
        const nameMatches = [
          ...candidates.filter(
            (c) =>
              c.normalized_name === normalizedName &&
              (!item.country_code || !c.country_code || c.country_code === item.country_code)
          ),
          ...accounts.filter(
            (a) =>
              a.normalized_name === normalizedName &&
              (!item.country_code || !a.country_code || a.country_code === item.country_code)
          ),
        ];
        if (nameMatches.length > 0) { found = 'possible_duplicate'; reason = 'Nombre similar en el mismo país'; }
      }

      if (found) {
        results[i].duplicate_status = found;
        results[i].reason = reason;
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error('[check-duplicates] Error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
