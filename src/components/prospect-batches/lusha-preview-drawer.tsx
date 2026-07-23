'use client';

/**
 * Lusha Read-Only Preview Drawer — Q3F-5BB.3
 *
 * Previsualización read-only de empresas desde Lusha dentro del flujo del
 * Agente 1. Reglas de seguridad respetadas en la UI:
 *   - NO auto-run: la búsqueda solo corre en `handlePreview` (onClick del botón).
 *     No hay ningún useEffect que dispare la server action.
 *   - NO acciones de persistencia (crear prospecto / aprobar / HubSpot / enrich).
 *   - Copy explícito de read-only y de costo (hasta 1 crédito).
 *   - searchText vive en una sección avanzada/opcional con advertencia.
 */

import * as React from 'react';
import {
  Search,
  Loader2,
  Building2,
  Info,
  TriangleAlert,
  CheckCircle2,
  XCircle,
  Settings2,
  ExternalLink,
} from 'lucide-react';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  getLushaSectorOptions,
  resolveLushaSectorOption,
} from '@/server/prospect-batches/lusha-sector-mapping';
import {
  LUSHA_PREVIEW_SIZE_BANDS,
  LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY,
  type LushaPreviewCompany,
} from '@/server/prospect-batches/lusha-preview';
import {
  previewLushaCompaniesAction,
  type PreviewLushaCompaniesActionResult,
} from '@/modules/prospect-batches/lusha-preview-actions';

// ── Copy (exportado para tests de contrato de UI) ─────────────────────────────

export const LUSHA_PREVIEW_READONLY_NOTICE =
  'Preview read-only. Estos resultados todavía no se guardan en SellUp.';
export const LUSHA_PREVIEW_COST_NOTICE =
  'Esta búsqueda consulta Lusha y puede consumir hasta 1 crédito. No guarda resultados en SellUp.';
export const LUSHA_PREVIEW_SEARCHTEXT_WARNING =
  'El criterio avanzado puede reducir mucho los resultados. Úsalo solo cuando quieras una búsqueda muy específica.';
export const LUSHA_PREVIEW_NOT_SAVED_FOOTER =
  'Resultados no guardados. En un siguiente paso se podrá enviar a revisión humana.';

const SUB_INDUSTRY_NONE = '__none__';

const ISSUE_LABELS: Record<string, string> = {
  missing_domain: 'Sin dominio',
  country_mismatch: 'País no coincide',
  industry_mismatch: 'Industria no coincide',
  industry_unknown: 'Industria desconocida',
  employees_out_of_range: 'Empleados fuera de rango',
  duplicate_domain: 'Dominio duplicado',
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** Firma inyectable de la server action (permite spies en tests). */
export type RunLushaPreview = (
  input: {
    countryCode: string;
    sectorKey: string;
    subIndustryId?: number | null;
    sizeBandKey?: string | null;
    searchText?: string | null;
  },
) => Promise<PreviewLushaCompaniesActionResult>;

type PanelStatus = 'idle' | 'loading' | 'done';

const SECTOR_OPTIONS = getLushaSectorOptions();

// ── Inner panel (render directo, testeable sin portal) ────────────────────────

export interface LushaPreviewPanelProps {
  /** Inyectable para tests. Por defecto usa la server action real. */
  runPreview?: RunLushaPreview;
}

export function LushaPreviewPanel({ runPreview = previewLushaCompaniesAction }: LushaPreviewPanelProps) {
  const [countryCode, setCountryCode] = React.useState('CO');
  const [sectorKey, setSectorKey] = React.useState<string>(SECTOR_OPTIONS[0]?.key ?? '');
  const [subIndustry, setSubIndustry] = React.useState<string>(SUB_INDUSTRY_NONE);
  const [sizeBandKey, setSizeBandKey] = React.useState<string>(LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY);
  const [searchText, setSearchText] = React.useState('');
  const [status, setStatus] = React.useState<PanelStatus>('idle');
  const [result, setResult] = React.useState<PreviewLushaCompaniesActionResult | null>(null);

  const sectorOption = resolveLushaSectorOption(sectorKey);
  const subIndustryOptions = sectorOption?.subIndustries ?? [];

  function handleSectorChange(value: string | null) {
    setSectorKey(value ?? '');
    setSubIndustry(SUB_INDUSTRY_NONE); // reset: la sub-industria depende del sector
  }

  // IMPORTANTE: única vía de ejecución. Invocada solo por el onClick del botón.
  async function handlePreview() {
    if (status === 'loading' || !sectorKey || !countryCode) return;
    setStatus('loading');
    setResult(null);
    try {
      const res = await runPreview({
        countryCode,
        sectorKey,
        subIndustryId: subIndustry === SUB_INDUSTRY_NONE ? null : Number(subIndustry),
        sizeBandKey,
        searchText: searchText.trim().length > 0 ? searchText.trim() : null,
      });
      setResult(res);
    } catch (err) {
      setResult({
        ok: false,
        status: 'error',
        error: err instanceof Error ? err.message : 'Error inesperado al consultar Lusha.',
      });
    } finally {
      setStatus('done');
    }
  }

  const canSubmit = !!countryCode && !!sectorKey && status !== 'loading';

  return (
    <div className="space-y-6" data-testid="lusha-preview-panel">
      {/* Aviso read-only permanente */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs" data-testid="lusha-preview-readonly-notice">
          {LUSHA_PREVIEW_READONLY_NOTICE}
        </AlertDescription>
      </Alert>

      {/* Filtros */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Criterios de búsqueda"
          description="Fuente: Lusha · previsualización read-only."
        />
        <div className="space-y-5">
          <Row>
            <Field label="País" required>
              <Select value={countryCode} onValueChange={(v) => setCountryCode(v ?? '')} disabled={status === 'loading'}>
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
            <Field label="Sector" required>
              <Select value={sectorKey} onValueChange={handleSectorChange} disabled={status === 'loading'}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar sector" />
                </SelectTrigger>
                <SelectContent>
                  {SECTOR_OPTIONS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Row>
          <Row>
            <Field label="Subindustria (opcional)">
              <Select value={subIndustry} onValueChange={(v) => setSubIndustry(v ?? SUB_INDUSTRY_NONE)} disabled={status === 'loading'}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Todas las subindustrias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SUB_INDUSTRY_NONE}>Todas las subindustrias</SelectItem>
                  {subIndustryOptions.map((sub) => (
                    <SelectItem key={sub.id} value={String(sub.id)}>
                      {sub.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tamaño">
              <Select value={sizeBandKey} onValueChange={(v) => setSizeBandKey(v ?? LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY)} disabled={status === 'loading'}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LUSHA_PREVIEW_SIZE_BANDS.map((band) => (
                    <SelectItem key={band.key} value={band.key}>
                      {band.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Row>

          {/* Criterio avanzado — searchText (oculto/colapsable + advertencia) */}
          <Accordion>
            <AccordionItem value="advanced" className="border-none">
              <AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 hover:no-underline hover:text-muted-foreground/80">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5" />
                  Criterio avanzado (opcional)
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-1" data-testid="lusha-preview-advanced">
                  <Label htmlFor="lusha-preview-search-text" className="text-xs font-medium text-muted-foreground">
                    Búsqueda libre
                  </Label>
                  <Input
                    id="lusha-preview-search-text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Ej. telemedicina"
                    disabled={status === 'loading'}
                    maxLength={120}
                  />
                  <Alert variant="warning">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {LUSHA_PREVIEW_SEARCHTEXT_WARNING}
                    </AlertDescription>
                  </Alert>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SurfaceCard>

      {/* Aviso de costo + botón explícito */}
      <div className="space-y-3">
        <Alert variant="warning">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs" data-testid="lusha-preview-cost-notice">
            {LUSHA_PREVIEW_COST_NOTICE}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          size="sm"
          className="gap-2"
          disabled={!canSubmit}
          onClick={handlePreview}
          data-testid="lusha-preview-run"
        >
          {status === 'loading' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Consultando Lusha…
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              Previsualizar en Lusha
            </>
          )}
        </Button>
      </div>

      {/* Resultado */}
      {status === 'done' && result && <PreviewResult result={result} />}
    </div>
  );
}

// ── Result rendering ──────────────────────────────────────────────────────────

function PreviewResult({ result }: { result: PreviewLushaCompaniesActionResult }) {
  if (!result.ok) {
    const isRate = result.status === 'rate_limited';
    return (
      <Alert variant={isRate ? 'warning' : 'destructive'}>
        {isRate ? <TriangleAlert className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        <AlertDescription className="text-xs">
          {result.error}
        </AlertDescription>
      </Alert>
    );
  }

  const { results, billing, requestSummary, status } = result;

  return (
    <div className="space-y-4 animate-su-fade-in">
      <SurfaceCard elevated>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-su-brand" />
            <span className="font-semibold text-foreground">
              {status === 'empty' ? 'Sin resultados' : `${results.length} empresa${results.length !== 1 ? 's' : ''}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="rounded-full">
              Créditos: {billing.creditsCharged ?? '—'} / máx {billing.expectedMaxCredits}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {requestSummary.sector ?? '—'} · {requestSummary.country ?? '—'}
            </Badge>
          </div>
        </div>
      </SurfaceCard>

      {status === 'empty' ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Lusha no devolvió empresas para estos criterios. Prueba con otro sector, subindustria o tamaño.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-2">
          {results.map((company, i) => (
            <PreviewCompanyCard key={company.providerCompanyId ?? `${company.domain ?? 'row'}-${i}`} company={company} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed" data-testid="lusha-preview-not-saved">
        {LUSHA_PREVIEW_NOT_SAVED_FOOTER}
      </p>
    </div>
  );
}

function PreviewCompanyCard({ company }: { company: LushaPreviewCompany }) {
  const employees =
    company.employeesExact ??
    (company.employeesMin !== null || company.employeesMax !== null
      ? `${company.employeesMin ?? '?'}–${company.employeesMax ?? '?'}`
      : '—');

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{company.name ?? 'Empresa sin nombre'}</span>
            {company.passesGate ? (
              <Badge variant="secondary" className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Pasa
              </Badge>
            ) : (
              <Badge variant="secondary" className="rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <TriangleAlert className="h-3 w-3" />
                No pasa
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{company.domain ?? 'sin dominio'}</span>
            <span>· {company.country ?? '—'}</span>
            <span>· {company.industry ?? 'industria n/d'}</span>
            <span>· {typeof employees === 'number' ? `${employees} empl.` : `${employees} empl.`}</span>
            {company.linkedinUrl && (
              <a
                href={company.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-su-brand hover:underline"
              >
                LinkedIn
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {company.issues.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {company.issues.map((issue) => (
                <Badge key={issue} variant="outline" className="rounded-full text-[10px] text-muted-foreground">
                  {ISSUE_LABELS[issue] ?? issue}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className="text-lg font-bold text-foreground">{company.score}</span>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Score</p>
        </div>
      </div>
    </SurfaceCard>
  );
}

// ── Note (Q3F-5BB.3C) ──────────────────────────────────────────────────────────
// The standalone `LushaPreviewDrawer` was removed. Lusha preview now renders
// INSIDE the "Generar con IA" wizard via `GenerationSourceSection`, which reuses
// the `LushaPreviewPanel` exported above. No separate Prospectos action remains.
