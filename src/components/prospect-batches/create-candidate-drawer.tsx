'use client';

import * as React from 'react';
import { Plus, Loader2, Building2, Globe, Briefcase, Hash, FileText, Zap } from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { createProspectCandidate } from '@/modules/prospect-batches/actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  COMPANY_SIZES,
  TAX_IDENTIFIER_TYPE_LABELS,
  CANDIDATE_SOURCE_LABELS,
  type TaxIdentifierType,
  type CandidateSourcePrimary,
} from '@/modules/prospect-batches/types';
import { Section, Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';

interface CreateCandidateDrawerProps {
  batchId?: string;
  triggerText?: string;
  triggerVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
}

const EMPTY = {
  name: '',
  legal_name: '',
  website: '',
  country_code: '',
  city: '',
  region: '',
  industry: '',
  company_size: '',
  tax_identifier: '',
  tax_identifier_type: '' as TaxIdentifierType | '',
  source_primary: 'manual' as CandidateSourcePrimary,
  review_notes: '',
};

export function CreateCandidateDrawer({
  batchId,
  triggerText,
  triggerVariant = 'outline',
}: CreateCandidateDrawerProps) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleClose() {
    setOpen(false);
    setForm({ ...EMPTY });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('El nombre de la empresa es obligatorio');
      return;
    }
    setSaving(true);
    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.country_code);
      await createProspectCandidate({
        batch_id: batchId,
        name: form.name.trim(),
        legal_name: form.legal_name.trim() || undefined,
        website: form.website.trim() || undefined,
        country: country?.name,
        country_code: form.country_code || undefined,
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        industry: form.industry || undefined,
        company_size: form.company_size || undefined,
        tax_identifier: form.tax_identifier.trim() || undefined,
        tax_identifier_type: (form.tax_identifier_type as TaxIdentifierType) || undefined,
        source_primary: form.source_primary,
        review_notes: form.review_notes.trim() || undefined,
      });
      toast.success('Empresa candidata agregada');
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al agregar empresa candidata');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      trigger={
        <Button onClick={() => setOpen(true)} variant={triggerVariant} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {triggerText ?? 'Agregar empresa candidata'}
        </Button>
      }
      title="Nueva empresa candidata"
      description="Agrega una empresa candidata manualmente. Deberá ser aprobada antes de convertirse en prospecto."
      icon={<Building2 className="h-4 w-4 text-su-brand" />}
      size="xl"
      actions={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            form="create-candidate-form"
            type="submit"
            size="sm"
            disabled={saving}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Agregar candidato
          </Button>
        </div>
      }
    >
      <form
        id="create-candidate-form"
        onSubmit={handleSubmit}
        className="space-y-8"
      >
        {/* Empresa */}
        <Section icon={Building2} label="Empresa">
          <Field label="Nombre de la empresa" required>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ej. Acme Corp"
              disabled={saving}
              autoFocus
            />
          </Field>
          <Field label="Razón social">
            <Input
              value={form.legal_name}
              onChange={(e) => set('legal_name', e.target.value)}
              placeholder="Nombre legal completo"
              disabled={saving}
            />
          </Field>
          <Field label="Sitio web">
            <Input
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://acme.com"
              disabled={saving}
            />
          </Field>
        </Section>

        {/* Ubicación */}
        <Section icon={Globe} label="Ubicación">
          <Row>
            <Field label="País">
              <Select
                value={form.country_code}
                onValueChange={(v) => set('country_code', v ?? '')}
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {LATAM_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {getFlagEmoji(c.code)} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ciudad">
              <Input
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Bogotá"
                disabled={saving}
              />
            </Field>
          </Row>
          <Field label="Región / Dpto.">
            <Input
              value={form.region}
              onChange={(e) => set('region', e.target.value)}
              placeholder="Cundinamarca"
              disabled={saving}
            />
          </Field>
        </Section>

        {/* Perfil de empresa */}
        <Section icon={Briefcase} label="Perfil de empresa">
          <Row>
            <Field label="Industria">
              <Select
                value={form.industry}
                onValueChange={(v) => set('industry', v ?? '')}
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((ind) => (
                    <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tamaño">
              <Select
                value={form.company_size}
                onValueChange={(v) => set('company_size', v ?? '')}
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Empleados" />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Row>
        </Section>

        {/* Identificador fiscal */}
        <Section icon={Hash} label="Identificador fiscal">
          <Row>
            <Field label="Tipo">
              <Select
                value={form.tax_identifier_type}
                onValueChange={(v) => set('tax_identifier_type', (v ?? '') as TaxIdentifierType)}
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TAX_IDENTIFIER_TYPE_LABELS) as [TaxIdentifierType, string][]).map(
                    ([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Número">
              <Input
                value={form.tax_identifier}
                onChange={(e) => set('tax_identifier', e.target.value)}
                placeholder="Ej. 900123456-1"
                disabled={saving}
              />
            </Field>
          </Row>
        </Section>

        {/* Fuente y notas */}
        <Section icon={FileText} label="Fuente y notas">
          <Field label="Fuente principal">
            <Select
              value={form.source_primary}
              onValueChange={(v) => set('source_primary', (v ?? 'manual') as CandidateSourcePrimary)}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(CANDIDATE_SOURCE_LABELS) as [CandidateSourcePrimary, string][]).map(
                  ([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notas de revisión">
            <Textarea
              value={form.review_notes}
              onChange={(e) => set('review_notes', e.target.value)}
              placeholder="Observaciones sobre este candidato..."
              rows={3}
              disabled={saving}
            />
          </Field>
        </Section>
      </form>
    </DrawerShell>
  );
}
