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
import {
  getTaxIdentifierRule,
  validateTaxIdentifier,
} from '@/modules/prospect-batches/tax-identifier-rules';

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
  const [taxIdError, setTaxIdError] = React.useState<string | null>(null);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function handleClose() {
    setOpen(false);
    setForm({ ...EMPTY });
    setTaxIdError(null);
  }

  const handleCountryChange = (v: string | null | undefined) => {
    const code = v ?? '';
    set('country_code', code);
    
    // Auto-select type based on country rule
    const rule = getTaxIdentifierRule(code || undefined);
    if (rule) {
      set('tax_identifier_type', rule.label as TaxIdentifierType);
    } else {
      set('tax_identifier_type', '');
    }

    // Validate existing tax identifier under the new country rules
    if (form.tax_identifier.trim()) {
      const res = validateTaxIdentifier(form.tax_identifier, code);
      if (!res.valid) {
        setTaxIdError(res.error ?? 'Identificador fiscal inválido');
      } else {
        setTaxIdError(null);
      }
    } else {
      setTaxIdError(null);
    }
  };

  const handleTaxIdChange = (val: string) => {
    set('tax_identifier', val);
    
    if (!val.trim()) {
      setTaxIdError(null);
      return;
    }
    
    const res = validateTaxIdentifier(val, form.country_code);
    if (!res.valid) {
      setTaxIdError(res.error ?? 'Identificador fiscal inválido');
    } else {
      setTaxIdError(null);
    }
  };

  const handleTaxIdBlur = () => {
    if (!form.tax_identifier.trim()) return;
    const res = validateTaxIdentifier(form.tax_identifier, form.country_code);
    if (res.valid && res.normalized) {
      set('tax_identifier', res.normalized);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('El nombre de la empresa es obligatorio');
      return;
    }

    if (form.tax_identifier.trim()) {
      const res = validateTaxIdentifier(form.tax_identifier, form.country_code);
      if (!res.valid) {
        toast.error(res.error ?? 'Identificador fiscal inválido');
        setTaxIdError(res.error ?? 'Identificador fiscal inválido');
        return;
      }
    }

    setSaving(true);
    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.country_code);
      const normalizedTaxId = form.tax_identifier.trim()
        ? (validateTaxIdentifier(form.tax_identifier, form.country_code).normalized ?? form.tax_identifier.trim())
        : undefined;

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
        tax_identifier: normalizedTaxId,
        tax_identifier_type: (form.tax_identifier_type as TaxIdentifierType) || undefined,
        source_primary: form.source_primary,
        review_notes: form.review_notes.trim() || undefined,
      });
      toast.success('Prospecto creado correctamente');
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
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
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
                onValueChange={(v) => handleCountryChange(v)}
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
        {(() => {
          const rule = getTaxIdentifierRule(form.country_code);
          const hasCountry = !!form.country_code;
          const isDisabled = !hasCountry || !rule;

          let helpText = '';
          if (!hasCountry) {
            helpText = 'Seleccione un país para habilitar la identificación fiscal.';
          } else if (!rule) {
            helpText = 'La validación del identificador fiscal aún no está configurada para este país.';
          } else {
            helpText = rule.helpText;
          }

          return (
            <Section icon={Hash} label="Identificador fiscal">
              <Row>
                <Field label="Tipo">
                  <Select
                    value={form.tax_identifier_type}
                    onValueChange={(v) => set('tax_identifier_type', (v ?? '') as TaxIdentifierType)}
                    disabled={isDisabled || saving}
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
                    onChange={(e) => handleTaxIdChange(e.target.value)}
                    onBlur={handleTaxIdBlur}
                    placeholder={rule?.placeholder ?? 'Seleccione un país'}
                    disabled={isDisabled || saving}
                    className={taxIdError ? 'border-destructive focus-visible:ring-destructive' : ''}
                  />
                </Field>
              </Row>
              <div className="mt-1.5 space-y-1">
                <p className={`text-xs ${!rule ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
                  {helpText}
                </p>
                {taxIdError && (
                  <p className="text-xs text-destructive font-medium animate-su-fade-in">
                    {taxIdError}
                  </p>
                )}
              </div>
            </Section>
          );
        })()}

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
