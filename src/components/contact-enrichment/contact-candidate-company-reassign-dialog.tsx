'use client';

/**
 * «Reasignar empresa» (AGENT2A-CANDIDATE-COMPANY-REASSIGN-1).
 *
 * Misma búsqueda que el AGENTE IA: se escribe el nombre, el dominio o el HubSpot ID y se busca
 * en SellUp y HubSpot (`resolveCompanyViaRoute` + `buildResolveInput`). El
 * operador elige una empresa y la acción del servidor la vuelve a confirmar por su id antes de
 * asociarla al candidato. No aprueba nada: después de reasignar, «Aprobar» sigue siendo un clic
 * aparte.
 *
 * El buscador vive en `company-search-picker.tsx` (F2 lo reutiliza para el contacto encontrado
 * por LinkedIn).
 */

import * as React from 'react';
import { Loader2, Search } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/forms/field';
import { ModalShell } from '@/components/shared/modal-shell';
import { reassignContactCandidateCompanyAction } from '@/modules/contact-enrichment/candidate-company-reassignment-actions';
import type { CompanyReassignmentSelection } from '@/modules/contact-enrichment/candidate-company-reassignment-core';
import type {
  CompanyCandidate,
  PendingContactCandidate,
} from '@/modules/contact-enrichment/types';
import { companyOptionKey, CompanySearchResults, useCompanySearch } from './company-search-picker';

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'yahoo.es',
  'live.com',
  'icloud.com',
]);

/** Sugerencia inicial: el dominio del correo del candidato (si no es genérico) o el nombre de la empresa. */
export function suggestReassignmentQuery(
  candidate: Pick<PendingContactCandidate, 'email' | 'company_name'>,
): string {
  const domain = candidate.email?.split('@')[1]?.trim().toLowerCase();
  if (domain && !GENERIC_EMAIL_DOMAINS.has(domain)) return domain;
  return candidate.company_name?.trim() ?? '';
}

/** Clave estable de una empresa en la lista de resultados. */
export const reassignmentOptionKey = companyOptionKey;

/** Sólo se pueden elegir empresas reales de SellUp o HubSpot, nunca una «manual». */
export function toReassignmentSelection(
  company: CompanyCandidate,
): CompanyReassignmentSelection | null {
  if (company.source === 'sellup' && company.sellupAccountId) {
    return { source: 'sellup', sellupAccountId: company.sellupAccountId };
  }
  if (company.source === 'hubspot' && company.hubspotCompanyId) {
    return { source: 'hubspot', hubspotCompanyId: company.hubspotCompanyId };
  }
  return null;
}

interface ContactCandidateCompanyReassignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: PendingContactCandidate;
  /** Se llama tras una reasignación confirmada por el servidor. */
  onReassigned: (message: string) => void;
}

// Nota: el llamador debe remontar el diálogo (prop `key`) en cada apertura.

export function ContactCandidateCompanyReassignDialog({
  open,
  onOpenChange,
  candidate,
  onReassigned,
}: ContactCandidateCompanyReassignDialogProps) {
  // Cada apertura monta el diálogo con una `key` nueva (la pone la ficha), así que el estado
  // arranca limpio y con la sugerencia del candidato sin un efecto que lo reinicie.
  const [query, setQuery] = React.useState(() => suggestReassignmentQuery(candidate));
  const companySearch = useCompanySearch();
  const { searching, selectedKey, error, setError } = companySearch;
  const [submitting, setSubmitting] = React.useState(false);

  const busy = searching || submitting;

  async function handleSearch(event?: React.FormEvent) {
    event?.preventDefault();
    if (!query.trim() || busy) return;
    await companySearch.search(query);
  }

  async function handleConfirm() {
    const company = companySearch.selected;
    const selection = company ? toReassignmentSelection(company) : null;
    if (!selection || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await reassignContactCandidateCompanyAction(candidate.id, selection);
      if (!res.ok) {
        setError(res.error ?? 'No fue posible reasignar la empresa.');
        return;
      }
      onReassigned(res.message ?? 'Empresa reasignada.');
      onOpenChange(false);
    } catch {
      setError('No fue posible reasignar la empresa. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        onOpenChange(v);
      }}
      size="lg"
      title="Reasignar empresa"
      description={
        <>
          Busca la empresa de <strong>{candidate.full_name || 'este candidato'}</strong> por
          nombre, dominio o HubSpot ID. Se busca en SellUp y HubSpot.
        </>
      }
      actions={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedKey || busy}>
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Reasignar empresa
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <form onSubmit={handleSearch} className="flex items-end gap-2">
          <Field label="Empresa" className="flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Escribe el nombre, dominio o HubSpot ID…"
              disabled={submitting}
              autoFocus
            />
          </Field>
          <Button type="submit" variant="outline" disabled={!query.trim() || busy}>
            {searching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Buscar
          </Button>
        </form>

        <CompanySearchResults
          state={companySearch}
          query={query}
          disabled={submitting}
          hubspotSelectionNote="Esta empresa aún no tiene cuenta en SellUp: se vinculará a la cuenta existente con el mismo dominio o se creará una cuenta nueva al reasignar."
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </ModalShell>
  );
}
