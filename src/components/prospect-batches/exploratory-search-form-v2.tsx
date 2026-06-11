'use client';

import * as React from 'react';
import { Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { AIButton } from '@/components/ai/ai-button';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { MultiSelect } from '@/components/forms/multi-select';
import { Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { validateExploratorySearch } from '@/modules/industry-catalog/action';
import {
  EXPLORATORY_SEARCH_LIMITS,
  normalizeCriteria,
} from '@/modules/industry-catalog/schema';
import { detectIncompatibleSubindustries } from '@/modules/industry-catalog/catalog-utils';
import type {
  ActiveIndustryCatalog,
  ExploratorySearchValidationResult,
} from '@/modules/industry-catalog/types';

// ── Props ─────────────────────────────────────────────────────────────────────

type ExploratorySearchFormV2Props = {
  catalog: ActiveIndustryCatalog;
  onClose: () => void;
};

// ── Form state ────────────────────────────────────────────────────────────────

type FormState = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  additionalCriteria: string;
  requestedCount: number;
};

const EMPTY_FORM: FormState = {
  countryCode: '',
  industryId: '',
  subindustryIds: [],
  additionalCriteria: '',
  requestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ExploratorySearchFormV2({
  catalog,
  onClose,
}: ExploratorySearchFormV2Props) {
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<ExploratorySearchValidationResult | null>(null);
  const [countryChangeMsg, setCountryChangeMsg] = React.useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  // ── Derived: filtered options ──────────────────────────────────────────────

  const industryOptions = catalog.industries.map((ind) => ({
    value: ind.id,
    label: ind.name,
    description: ind.description ?? undefined,
  }));

  const subindustryOptions = React.useMemo(() => {
    if (!form.industryId) return [];
    return catalog.subindustries
      .filter((s) => {
        if (s.industryId !== form.industryId) return false;
        if (!form.countryCode) return true;
        return s.applicableCountries === null || s.applicableCountries.includes(form.countryCode);
      })
      .map((s) => ({
        value: s.id,
        label: s.name,
        description: s.description ?? undefined,
      }));
  }, [form.industryId, form.countryCode, catalog.subindustries]);

  const noSubindustriesAvailable =
    !!form.industryId && subindustryOptions.length === 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleCountryChange(code: string | null) {
    setCountryChangeMsg(null);
    if (!code) {
      set('countryCode', '');
      return;
    }

    // Detect which current subindustry selections become incompatible
    const incompatibleIds = detectIncompatibleSubindustries(
      form.subindustryIds,
      catalog.subindustries,
      code,
    );

    if (incompatibleIds.length > 0) {
      const nextIds = form.subindustryIds.filter((id) => !incompatibleIds.includes(id));
      setForm((prev) => ({ ...prev, countryCode: code, subindustryIds: nextIds }));
      setCountryChangeMsg(
        'Se eliminaron subindustrias que no están disponibles para el nuevo país.',
      );
    } else {
      set('countryCode', code);
    }
  }

  function handleIndustryChange(id: string) {
    setForm((prev) => ({ ...prev, industryId: id, subindustryIds: [] }));
  }

  function handleMaxSubindustriesReached() {
    toast.warning(
      `Puedes seleccionar hasta ${EXPLORATORY_SEARCH_LIMITS.subindustries.max} subindustrias.`,
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);

    // Client-side quick check
    const trimmedCriteria = form.additionalCriteria.trim();
    if (trimmedCriteria.length > EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars) {
      toast.error(
        `El criterio específico puede tener máximo ${EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars} caracteres.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await validateExploratorySearch({
        countryCode: form.countryCode,
        industryId: form.industryId,
        subindustryIds: form.subindustryIds,
        additionalCriteriaRaw: trimmedCriteria === '' ? null : trimmedCriteria,
        requestedCount: form.requestedCount,
        catalogVersion: catalog.version,
      });
      setResult(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al validar la búsqueda.');
    } finally {
      setSubmitting(false);
    }
  }

  const criteriaLength = form.additionalCriteria.length;
  const criteriaOverLimit =
    criteriaLength > EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars;

  const canSubmit =
    !!form.countryCode &&
    !!form.industryId &&
    !submitting &&
    !criteriaOverLimit;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <form id="exploratory-search-v2-form" onSubmit={handleSubmit} className="space-y-6">

      {/* Country change notification */}
      {countryChangeMsg && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">{countryChangeMsg}</AlertDescription>
        </Alert>
      )}

      {/* Segmentation */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Segmentación"
          description="Define el mercado objetivo de la búsqueda."
        />

        {/* Country */}
        <Field label="País" required>
          <Select
            value={form.countryCode}
            onValueChange={handleCountryChange}
            disabled={submitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Seleccionar país" />
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

        {/* Industry */}
        <Field label="Industria" required>
          <SearchableSelect
            options={industryOptions}
            value={form.industryId}
            onValueChange={handleIndustryChange}
            placeholder="Seleccionar industria"
            searchPlaceholder="Buscar industria..."
            emptyMessage="No se encontraron industrias."
            disabled={submitting}
          />
        </Field>

        {/* Subindustries */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              Subindustrias
            </Label>
            <span className="text-xs text-muted-foreground">
              {form.subindustryIds.length}/{EXPLORATORY_SEARCH_LIMITS.subindustries.max}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Selecciona hasta {EXPLORATORY_SEARCH_LIMITS.subindustries.max} para enfocar mejor la búsqueda.
          </p>
          <MultiSelect
            options={subindustryOptions}
            value={form.subindustryIds}
            onValueChange={(ids) => set('subindustryIds', ids)}
            placeholder={
              !form.industryId
                ? 'Primero selecciona una industria'
                : 'Seleccionar subindustrias'
            }
            searchPlaceholder="Buscar subindustria..."
            emptyMessage={
              noSubindustriesAvailable
                ? 'No hay subindustrias disponibles para esta combinación.'
                : 'No se encontraron resultados.'
            }
            disabled={submitting || !form.industryId}
            maxSelections={EXPLORATORY_SEARCH_LIMITS.subindustries.max}
            onMaxSelectionsReached={handleMaxSubindustriesReached}
          />
          {noSubindustriesAvailable && (
            <p className="text-xs text-muted-foreground">
              No hay subindustrias disponibles para esta combinación.
            </p>
          )}
        </div>
      </SurfaceCard>

      {/* Additional criteria */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Criterio específico"
          description="Opcional. Características adicionales que debe cumplir la empresa."
        />
        <div className="space-y-1.5">
          <Textarea
            id="additional-criteria"
            placeholder="Ejemplo: empresas con operación regional, equipos distribuidos y señales de crecimiento."
            value={form.additionalCriteria}
            onChange={(e) => set('additionalCriteria', e.target.value)}
            disabled={submitting}
            rows={3}
            className="resize-none"
            aria-label="¿Qué características adicionales quieres encontrar?"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              No se enviará todavía a ningún modelo de IA.
            </p>
            <span
              className={`text-xs font-mono ${
                criteriaOverLimit
                  ? 'text-destructive font-semibold'
                  : 'text-muted-foreground'
              }`}
            >
              {criteriaLength}/{EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars}
            </span>
          </div>
          {criteriaOverLimit && (
            <p className="text-xs text-destructive">
              El criterio específico puede tener máximo{' '}
              {EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars} caracteres.
            </p>
          )}
        </div>
      </SurfaceCard>

      {/* Employee size — informational only */}
      <SurfaceCard>
        <SurfaceCardHeader title="Tamaño mínimo" />
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
          <span className="text-sm font-medium text-foreground">Más de 200 empleados</span>
          <span className="text-xs text-muted-foreground">Fijo</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Buscaremos empresas cuya entidad local en el país seleccionado supere este tamaño.
        </p>
      </SurfaceCard>

      {/* Requested count */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Cantidad de empresas"
          description="Número de empresas candidatas a buscar."
        />
        <Field label="Cantidad">
          <Select
            value={String(form.requestedCount)}
            onValueChange={(v) =>
              set('requestedCount', parseInt(v ?? '') || EXPLORATORY_SEARCH_LIMITS.requestedCount.default)
            }
            disabled={submitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPLORATORY_SEARCH_LIMITS.requestedCount.options.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} empresas
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </SurfaceCard>

      {/* Live summary */}
      <SearchSummaryCard
        catalog={catalog}
        form={form}
      />

      {/* Validation result */}
      {result && (
        <ValidationResultCard result={result} />
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <AIButton
          form="exploratory-search-v2-form"
          type="submit"
          size="sm"
          disabled={!canSubmit}
          loading={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Validando…
            </>
          ) : (
            'Validar búsqueda'
          )}
        </AIButton>
      </div>
    </form>
  );
}

// ── Live summary card ─────────────────────────────────────────────────────────

type SearchSummaryCardProps = {
  catalog: ActiveIndustryCatalog;
  form: FormState;
};

function SearchSummaryCard({ catalog, form }: SearchSummaryCardProps) {
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);
  const industryEntry = catalog.industries.find((i) => i.id === form.industryId);
  const selectedSubs = catalog.subindustries.filter((s) =>
    form.subindustryIds.includes(s.id),
  );

  const normalizedCriteria = normalizeCriteria(form.additionalCriteria);

  return (
    <SurfaceCard elevated>
      <SurfaceCardHeader
        title="Resumen de búsqueda"
        description="Actualiza en tiempo real conforme configuras los campos."
      />
      <dl className="space-y-2 text-sm">
        <Row>
          <dt className="text-muted-foreground shrink-0">País</dt>
          <dd className="font-medium text-foreground text-right">
            {countryEntry ? `${getFlagEmoji(form.countryCode)} ${countryEntry.name}` : '—'}
          </dd>
        </Row>
        <Row>
          <dt className="text-muted-foreground shrink-0">Industria</dt>
          <dd className="font-medium text-foreground text-right">
            {industryEntry?.name ?? '—'}
          </dd>
        </Row>
        <Row>
          <dt className="text-muted-foreground shrink-0">Subindustrias</dt>
          <dd className="font-medium text-foreground text-right">
            {selectedSubs.length > 0
              ? selectedSubs.map((s) => s.name).join(', ')
              : '—'}
          </dd>
        </Row>
        <Row>
          <dt className="text-muted-foreground shrink-0">Tamaño</dt>
          <dd className="font-medium text-foreground text-right">
            {'>200 empleados'}
          </dd>
        </Row>
        <Row>
          <dt className="text-muted-foreground shrink-0">Cantidad</dt>
          <dd className="font-medium text-foreground text-right">
            {form.requestedCount} empresas
          </dd>
        </Row>
        {normalizedCriteria && (
          <div className="pt-1">
            <dt className="text-muted-foreground text-xs mb-1">Criterio específico</dt>
            <dd className="text-xs text-foreground leading-relaxed line-clamp-3">
              {normalizedCriteria}
            </dd>
          </div>
        )}
      </dl>
    </SurfaceCard>
  );
}

// ── Validation result card ────────────────────────────────────────────────────

function ValidationResultCard({ result }: { result: ExploratorySearchValidationResult }) {
  if (result.valid && result.preview) {
    return (
      <Alert variant="success" className="animate-su-fade-in">
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription className="text-xs space-y-1">
          <p className="font-semibold">
            Configuración validada. La generación de prospectos todavía no se ejecutó.
          </p>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))}
        </AlertDescription>
      </Alert>
    );
  }

  const allFieldErrors = Object.values(result.fieldErrors).flat();

  return (
    <Alert variant="destructive" className="animate-su-fade-in">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="text-xs space-y-1">
        <p className="font-semibold">Revisa los campos señalados antes de continuar.</p>
        {allFieldErrors.map((msg, i) => (
          <p key={i}>· {msg}</p>
        ))}
        {result.warnings.map((w, i) => (
          <p key={`w-${i}`} className="text-amber-600 dark:text-amber-400">
            {w}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}
