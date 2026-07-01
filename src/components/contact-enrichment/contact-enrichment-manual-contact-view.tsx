'use client';

import * as React from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createManualContactFromEnrichmentEmptyState } from '@/modules/contact-enrichment/manual-contact-from-enrichment';
import { validateManualContactInput } from '@/modules/contact-enrichment/manual-contact-from-enrichment-core';

// ── Types ──────────────────────────────────────────────────────────────────

interface Props {
  accountId: string;
  runId: string;
  companyName?: string | null;
  companyDomain?: string | null;
  onCancel: () => void;
  onSuccess: (contactId: string, fullName: string) => void;
}

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string };

// ── Form view ──────────────────────────────────────────────────────────────

export function ContactEnrichmentManualContactView({
  accountId,
  runId,
  companyName,
  companyDomain,
  onCancel,
  onSuccess,
}: Props) {
  const [fullName, setFullName] = React.useState('');
  const [jobTitle, setJobTitle] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [linkedinUrl, setLinkedinUrl] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [formState, setFormState] = React.useState<FormState>({ status: 'idle' });
  const [fieldErrors, setFieldErrors] = React.useState<string[]>([]);

  const isSubmitting = formState.status === 'submitting';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const clientValidation = validateManualContactInput({
      full_name: fullName,
      job_title: jobTitle || null,
      email: email || null,
      phone: phone || null,
      linkedin_url: linkedinUrl || null,
    });

    if (!clientValidation.valid) {
      setFieldErrors(clientValidation.errors);
      return;
    }

    setFieldErrors([]);
    setFormState({ status: 'submitting' });

    const result = await createManualContactFromEnrichmentEmptyState({
      account_id: accountId,
      full_name: fullName,
      job_title: jobTitle || null,
      email: email || null,
      phone: phone || null,
      linkedin_url: linkedinUrl || null,
      notes: notes || null,
      contact_enrichment_run_id: runId,
      company_name: companyName ?? null,
      company_domain: companyDomain ?? null,
    });

    if (result.ok) {
      onSuccess(result.contactId, fullName);
    } else {
      setFormState({ status: 'error', message: result.message });
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          disabled={isSubmitting}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Volver al resultado
        </button>
      </div>

      <div className="flex items-center gap-2 border-t border-border/50 pt-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-su-brand-soft">
          <UserPlus className="h-3.5 w-3.5 text-su-brand" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Crear contacto manualmente</p>
          {companyName && (
            <p className="text-xs text-muted-foreground">
              Se asociará a{' '}
              <span className="font-medium text-foreground">{companyName}</span>
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ce-manual-full-name" className="text-xs font-medium">
            Nombre completo <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ce-manual-full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ana Martínez"
            disabled={isSubmitting}
            className="h-9 text-sm"
            autoComplete="off"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ce-manual-job-title" className="text-xs font-medium">
            Cargo
          </Label>
          <Input
            id="ce-manual-job-title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="VP de Talento Humano"
            disabled={isSubmitting}
            className="h-9 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ce-manual-email" className="text-xs font-medium">
            Email
          </Label>
          <Input
            id="ce-manual-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ana@empresa.com"
            disabled={isSubmitting}
            className="h-9 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ce-manual-phone" className="text-xs font-medium">
            Teléfono
          </Label>
          <Input
            id="ce-manual-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+57 300 000 0000"
            disabled={isSubmitting}
            className="h-9 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ce-manual-linkedin" className="text-xs font-medium">
            LinkedIn
          </Label>
          <Input
            id="ce-manual-linkedin"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/ana-martinez"
            disabled={isSubmitting}
            className="h-9 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ce-manual-notes" className="text-xs font-medium">
            Notas
          </Label>
          <Textarea
            id="ce-manual-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contexto adicional sobre este contacto…"
            disabled={isSubmitting}
            className="min-h-[64px] resize-none text-sm"
          />
        </div>

        {fieldErrors.length > 0 && (
          <ul className="space-y-0.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            {fieldErrors.map((err) => (
              <li key={err} className="text-xs text-destructive">
                {err}
              </li>
            ))}
          </ul>
        )}

        {formState.status === 'error' && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {formState.message}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          <span className="text-destructive">*</span> obligatorio · Se requiere al menos cargo,
          email, teléfono o LinkedIn además del nombre.
        </p>

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Guardando…
              </>
            ) : (
              'Guardar contacto'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Success view (inline, dentro del drawer) ───────────────────────────────

interface SuccessViewProps {
  contactId: string;
  fullName: string;
  onCreateAnother: () => void;
  onBack: () => void;
}

export function ContactEnrichmentManualContactSuccessView({
  contactId,
  fullName,
  onCreateAnother,
  onBack,
}: SuccessViewProps) {
  return (
    <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Contacto creado</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{fullName}</span> fue guardado como
            contacto oficial.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" className="w-full gap-2" asChild>
          <a href={`/contacts?highlight=${contactId}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Ver contacto
          </a>
        </Button>
        <Button variant="outline" size="sm" className="w-full" onClick={onCreateAnother}>
          Crear otro contacto
        </Button>
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onBack}>
          Volver al resultado
        </Button>
      </div>
    </div>
  );
}
