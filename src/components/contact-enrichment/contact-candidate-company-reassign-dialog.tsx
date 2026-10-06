'use client';

/**
 * «Reasignar empresa» (AGENT2A-CANDIDATE-COMPANY-REASSIGN-1).
 *
 * Misma búsqueda que el AGENTE IA: se escribe el nombre, el dominio o el HubSpot ID y se busca
 * en SellUp y HubSpot (`resolveContactEnrichmentCompanyAction` + `buildResolveInput`). El
 * operador elige una empresa y la acción del servidor la vuelve a confirmar por su id antes de
 * asociarla al candidato. No aprueba nada: después de reasignar, «Aprobar» sigue siendo un clic
 * aparte.
 */

import * as React from 'react';
import { Building2, Globe, Loader2, Search } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/forms/field';
import { OptionTile } from '@/components/selection/option-tile';
import { ModalShell } from '@/components/shared/modal-shell';
import { resolveContactEnrichmentCompanyAction } from '@/modules/contact-enrichment/actions';
import { reassignContactCandidateCompanyAction } from '@/modules/contact-enrichment/candidate-company-reassignment-actions';
import type { CompanyReassignmentSelection } from '@/modules/contact-enrichment/candidate-company-reassignment-core';
import type {
  CompanyCandidate,
  PendingContactCandidate,
} from '@/modules/contact-enrichment/types';
import { buildResolveInput } from './contact-enrichment-chat-reducer';

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
export function reassignmentOptionKey(company: CompanyCandidate): string | null {
  if (company.source === 'sellup' && company.sellupAccountId) {
    return `sellup:${company.sellupAccountId}`;
  }
  if (company.source === 'hubspot' && company.hubspotCompanyId) {
    return `hubspot:${company.hubspotCompanyId}`;
  }
  return null;
}

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

function optionDescription(company: CompanyCandidate): string | undefined {
  const parts = [
    company.domain,
    company.country,
    company.hubspotCompanyId ? `HS: ${company.hubspotCompanyId}` : undefined,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : undefined;
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
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [results, setResults] = React.useState<CompanyCandidate[]>([]);
  const [hubspotSkipped, setHubspotSkipped] = React.useState(false);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const busy = searching || submitting;

  async function handleSearch(event?: React.FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setSearching(true);
    setError(null);
    setSelectedKey(null);
    try {
      const res = await resolveContactEnrichmentCompanyAction(buildResolveInput(q));
      if (!res.success || !res.data) {
        setResults([]);
        setError(res.error ?? 'No fue posible buscar la empresa.');
      } else {
        const selectable = res.data.candidates.filter((c) => reassignmentOptionKey(c) !== null);
        setResults(selectable);
        setHubspotSkipped(res.data.skippedHubSpot);
        if (selectable.length === 1) setSelectedKey(reassignmentOptionKey(selectable[0]));
      }
    } catch {
      setResults([]);
      setError('No fue posible buscar la empresa. Intenta de nuevo.');
    } finally {
      setSearched(true);
      setSearching(false);
    }
  }

  async function handleConfirm() {
    const company = results.find((c) => reassignmentOptionKey(c) === selectedKey);
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

        {searching && (
          <p className="text-xs text-muted-foreground">Buscando en SellUp y HubSpot…</p>
        )}

        {!searching && results.length > 0 && (
          <div
            role="radiogroup"
            aria-label="Empresas encontradas"
            className="flex max-h-72 flex-col gap-1.5 overflow-y-auto"
          >
            {results.map((company) => {
              const key = reassignmentOptionKey(company) as string;
              return (
                <OptionTile
                  key={key}
                  option={{
                    value: key,
                    label: company.name,
                    description: optionDescription(company),
                    badge: company.source === 'sellup' ? 'SellUp' : 'HubSpot',
                    icon: company.source === 'sellup' ? Building2 : Globe,
                  }}
                  selected={selectedKey === key}
                  disabled={submitting}
                  onSelect={setSelectedKey}
                />
              );
            })}
          </div>
        )}

        {!searching && searched && results.length === 0 && !error && (
          <p className="text-xs text-muted-foreground">
            No encontramos empresas con «{query.trim()}» en SellUp ni en HubSpot. Prueba con el
            dominio o el HubSpot ID.
          </p>
        )}

        {!searching && searched && hubspotSkipped && (
          <p className="text-xs text-muted-foreground">
            HubSpot no respondió en esta búsqueda: solo se muestran resultados de SellUp.
          </p>
        )}

        {selectedKey?.startsWith('hubspot:') && (
          <p className="text-xs text-muted-foreground">
            Esta empresa aún no tiene cuenta en SellUp: se vinculará a la cuenta existente con el
            mismo dominio o se creará una cuenta nueva al reasignar.
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </ModalShell>
  );
}
