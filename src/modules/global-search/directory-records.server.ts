/**
 * Empresas y contactos de SellUp en la búsqueda general, desde cualquier pantalla y por todos
 * los criterios (dueña 25-11; ver `search-criteria.ts`). Sólo lectura.
 *
 * Lee con el cliente de servicio —hay que saber si existe aunque lo lleve otra persona— y
 * aplica la misma regla de alcance que las listas y que la presencia de HubSpot
 * (`currentScopeUserIds`): lo que quien busca puede abrir sale con su enlace; lo demás sale
 * como «En SellUp la lleva …», sin enlace ni datos de contacto. Las empresas archivadas sólo
 * las ve un administrador (para restaurarlas).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { anyInScope, currentScopeUserIds } from '@/modules/access/record-scope.server';
import { loadDirectoryNames } from '@/modules/access/user-directory.server';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import {
  DIRECTORY_DB_ROWS,
  accountMatchRank,
  accountOrFilter,
  contactMatchRank,
  contactOrFilter,
  otherOwnerNote,
  rankMatches,
  type DirectoryAccountRow,
  type DirectoryContactRow,
} from './directory-search-core';
import { parseSearchCriteria } from './search-criteria';
import { SELLUP_RECORDS_PER_KIND, type SellUpRecordHit } from './types';

const ACCOUNT_COLUMNS =
  'id, name, legal_name, domain, website, industry, country, tax_identifier, hubspot_company_id, owner_id, created_by, archived_at';
const CONTACT_COLUMNS =
  'id, full_name, email, phone, mobile_phone, job_title, hubspot_contact_id, account:accounts(id, name, owner_id, created_by, archived_at)';

function compact(values: ReadonlyArray<string | null | undefined>): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

async function ownerNames(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  try {
    return await loadDirectoryNames(ids);
  } catch {
    return new Map();
  }
}

/**
 * `query`: lo escrito ya limpio para un filtro (sin comodines ni comas); `rawQuery`: tal cual,
 * para leer el criterio (un correo con «_» sigue siendo un correo).
 */

/** Empresas de SellUp (aprobadas) que coinciden con lo escrito. */
export async function accountDirectoryHits(query: string, rawQuery: string = query): Promise<SellUpRecordHit[]> {
  const criteria = parseSearchCriteria(rawQuery);
  const [isAdmin, scopeIds] = await Promise.all([isCurrentUserAdmin().catch(() => false), currentScopeUserIds()]);
  const { data, error } = await createSupabaseAdminClient()
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .or(accountOrFilter(criteria, query))
    .order('created_at', { ascending: false })
    .limit(DIRECTORY_DB_ROWS);
  if (error) throw new Error(`accountDirectoryHits: ${error.message}`);

  // Archivadas (dueña 25-11: todos archivan y restauran lo de su alcance): cada quien ve las
  // suyas para poder restaurarlas; las de fuera de su alcance no aparecen.
  const visible = ((data ?? []) as unknown as DirectoryAccountRow[]).filter(
    (r) => r.archived_at === null || isAdmin || anyInScope(scopeIds, [r.owner_id, r.created_by]),
  );
  const rows = rankMatches(visible, (r) => accountMatchRank(r, criteria), SELLUP_RECORDS_PER_KIND);
  const names = await ownerNames(rows.map((r) => r.owner_id));
  return rows.map((row) => {
    const archived = row.archived_at !== null;
    const meta = compact([archived ? 'Archivada' : null, row.industry, row.country]);
    if (!isAdmin && !anyInScope(scopeIds, [row.owner_id, row.created_by])) {
      return {
        kind: 'account' as const,
        id: row.id,
        title: row.name,
        meta: [...meta, otherOwnerNote(row.owner_id ? names.get(row.owner_id) : null)],
        keywords: compact([row.domain]),
        locked: true,
      };
    }
    return {
      kind: 'account' as const,
      id: row.id,
      title: row.name,
      meta,
      keywords: compact([row.domain, row.website, row.tax_identifier, row.hubspot_company_id]),
    };
  });
}

/** Contactos de SellUp (aprobados) que coinciden con lo escrito. Van con su empresa. */
export async function contactDirectoryHits(query: string, rawQuery: string = query): Promise<SellUpRecordHit[]> {
  const criteria = parseSearchCriteria(rawQuery);
  const { data, error } = await createSupabaseAdminClient()
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .is('archived_at', null)
    .or(contactOrFilter(criteria, query))
    .order('created_at', { ascending: false })
    .limit(DIRECTORY_DB_ROWS);
  if (error) throw new Error(`contactDirectoryHits: ${error.message}`);

  // Los contactos de una empresa archivada no están en la lista de Contactos.
  const live = ((data ?? []) as unknown as DirectoryContactRow[]).filter((r) => r.account && r.account.archived_at === null);
  const rows = rankMatches(live, (r) => contactMatchRank(r, criteria), SELLUP_RECORDS_PER_KIND);
  const [scopeIds, names] = await Promise.all([currentScopeUserIds(), ownerNames(rows.map((r) => r.account?.owner_id ?? null))]);
  return rows.map((row) => {
    const account = row.account;
    if (!anyInScope(scopeIds, [account?.owner_id, account?.created_by])) {
      return {
        kind: 'contact' as const,
        id: row.id,
        title: row.full_name,
        meta: compact([account?.name, otherOwnerNote(account?.owner_id ? names.get(account.owner_id) : null)]),
        keywords: [],
        locked: true,
      };
    }
    return {
      kind: 'contact' as const,
      id: row.id,
      title: row.full_name,
      meta: compact([row.job_title, account?.name]),
      keywords: compact([row.email, row.phone, row.mobile_phone, row.hubspot_contact_id]),
    };
  });
}
