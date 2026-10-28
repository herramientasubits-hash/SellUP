'use client';

/**
 * «Asociar a una empresa» del contacto encontrado por LinkedIn (F2).
 *
 * Obligatorio antes de crear el candidato: el run nace con la cuenta de esta empresa. Dos
 * caminos en el mismo diálogo, los dos con el buscador compartido de «Reasignar empresa»:
 *   - «Por Company ID de HubSpot»: lectura por ID de #587;
 *   - «Buscar empresa»: nombre o dominio, precargado con lo que trajo el proveedor.
 * Al elegir, se recalcula la consistencia con la empresa del proveedor y se avisa si no coincide
 * (posible cambio de trabajo). Crear el candidato no llama a ningún proveedor.
 */

import * as React from 'react';
import { Loader2, Search } from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/forms/field';
import { SegmentedControl } from '@/components/selection/segmented-control';
import { ModalShell } from '@/components/shared/modal-shell';
import { createLinkedinContactCandidateAction } from '@/modules/contact-enrichment/linkedin-contact-search-actions';
import {
  evaluateLinkedinCompanyConsistency,
  type LinkedinSearchPreview,
} from '@/modules/contact-enrichment/linkedin-contact-search-core';
import { CompanySearchResults, useCompanySearch } from './company-search-picker';

type CompanyPickMode = 'hubspot_id' | 'search';

export const LINKEDIN_COMPANY_MODE_OPTIONS = [
  { value: 'hubspot_id', label: 'Por Company ID de HubSpot' },
  { value: 'search', label: 'Buscar empresa' },
];

export const LINKEDIN_COMPANY_MISMATCH_TITLE = 'La empresa no coincide con la del proveedor';

interface LinkedinCandidateCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: LinkedinSearchPreview;
  token: string;
  onCreated: (message: string) => void;
}

// Nota: quien lo monta lo remonta (prop `key`) en cada apertura.

export function LinkedinCandidateCompanyDialog({
  open,
  onOpenChange,
  preview,
  token,
  onCreated,
}: LinkedinCandidateCompanyDialogProps) {
  const [mode, setMode] = React.useState<CompanyPickMode>(preview.suggestedCompanyQuery ? 'search' : 'hubspot_id');
  const [hubspotId, setHubspotId] = React.useState('');
  const [query, setQuery] = React.useState(preview.suggestedCompanyQuery);
  const companySearch = useCompanySearch();
  const { searching, selected, error, setError } = companySearch;
  const [submitting, setSubmitting] = React.useState(false);
  const busy = searching || submitting;

  const consistency = selected
    ? evaluateLinkedinCompanyConsistency(
        {
          email: preview.email,
          providerCompanyName: preview.providerCompanyName,
          providerCompanyDomain: preview.providerCompanyDomain,
          providerCompanyWebsiteUrl: null,
        },
        selected,
      )
    : null;

  async function handleSearch(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (mode === 'hubspot_id') {
      const id = hubspotId.replace(/\s+/g, '');
      if (!/^\d+$/.test(id)) {
        setError('El Company ID de HubSpot sólo tiene números.');
        return;
      }
      await companySearch.search(id, { hubspotCompanyId: id });
      return;
    }
    if (!query.trim()) return;
    await companySearch.search(query);
  }

  async function handleCreate() {
    if (!selected || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createLinkedinContactCandidateAction(token, selected);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onCreated(res.message);
      onOpenChange(false);
    } catch {
      setError('No pudimos crear el candidato. Intenta de nuevo.');
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
      title="Asociar a una empresa"
      description={
        <>
          Elige la empresa de <strong>{preview.fullName}</strong>. Es obligatoria: el candidato se crea con
          esta empresa.
        </>
      }
      actions={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={!selected || busy} data-testid="linkedin-create-candidate">
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Crear candidato
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="linkedin-company-dialog">
        <SegmentedControl
          options={LINKEDIN_COMPANY_MODE_OPTIONS}
          value={mode}
          onChange={(value) => {
            setMode(value as CompanyPickMode);
            companySearch.reset();
          }}
          disabled={busy}
          ariaLabel="Cómo elegir la empresa"
          fullWidth
        />

        <form onSubmit={handleSearch} className="flex items-end gap-2">
          {mode === 'hubspot_id' ? (
            <Field label="Company ID de HubSpot" className="flex-1">
              <Input
                value={hubspotId}
                onChange={(e) => setHubspotId(e.target.value)}
                placeholder="Ej.: 65498491"
                inputMode="numeric"
                disabled={submitting}
                autoFocus
              />
            </Field>
          ) : (
            <Field label="Empresa" className="flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre o dominio de la empresa"
                disabled={submitting}
                autoFocus
              />
            </Field>
          )}
          <Button
            type="submit"
            variant="outline"
            disabled={busy || (mode === 'hubspot_id' ? !hubspotId.trim() : !query.trim())}
          >
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            Buscar
          </Button>
        </form>

        <CompanySearchResults
          state={companySearch}
          query={mode === 'hubspot_id' ? hubspotId : query}
          disabled={submitting}
          hubspotSelectionNote="Esta empresa aún no tiene cuenta en SellUp: se vinculará a la cuenta existente con el mismo dominio o se creará una cuenta nueva al crear el candidato."
        />

        {consistency?.status === 'possible_mismatch' && (
          <Alert data-testid="linkedin-company-mismatch">
            <AlertTitle>{LINKEDIN_COMPANY_MISMATCH_TITLE}</AlertTitle>
            <AlertDescription>
              <p>
                Según {preview.provider === 'apollo' ? 'Apollo' : 'Lusha'}, trabaja en{' '}
                {preview.providerCompanyName ?? preview.providerCompanyDomain ?? 'otra empresa'}. Puede haber
                cambiado de trabajo: revisa antes de crear el candidato.
              </p>
            </AlertDescription>
          </Alert>
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
