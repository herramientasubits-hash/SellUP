'use client';

// ── Import Classification Correction Panel — Hito 16AB.40 ─────────────────────
// Manual correction panel for a single row. Allows changing industry/subindustry
// via SearchableSelect. Revalidates in backend after correction.

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/forms/searchable-select';
import type {
  ImportClassificationPreviewRow,
  ManualClassificationCorrection,
  CatalogVersionState,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { CLASSIFICATION_STATUS_MAP } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Catalog item type (from loadImportCatalog) ────────────────────────────────

type CatalogIndustry = {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  subindustries: CatalogSubindustry[];
};

type CatalogSubindustry = {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  countries?: string[];
};

// ── Props ─────────────────────────────────────────────────────────────────────

type CorrectionPanelProps = {
  row: ImportClassificationPreviewRow;
  catalog: {
    industries: CatalogIndustry[];
  };
  catalogVersion: CatalogVersionState;
  onCorrect: (correction: ManualClassificationCorrection) => Promise<void>;
  onClose: () => void;
};

// ── Main component ────────────────────────────────────────────────────────────

export function ImportClassificationCorrectionPanel({
  row,
  catalog,
  catalogVersion,
  onCorrect,
  onClose,
}: CorrectionPanelProps) {
  const [selectedIndustryId, setSelectedIndustryId] = React.useState<string>(
    row.industryCanonicalId ?? '',
  );
  const [selectedSubindustryId, setSelectedSubindustryId] = React.useState<string>(
    row.subindustryCanonicalId ?? '',
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [validationMessage, setValidationMessage] = React.useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // ── Derived data ───────────────────────────────────────────────────────────

  const selectedIndustry = React.useMemo(
    () => catalog.industries.find((i) => i.id === selectedIndustryId) ?? null,
    [catalog.industries, selectedIndustryId],
  );

  const availableSubindustries = React.useMemo(() => {
    if (!selectedIndustry) return [];
    let filtered = selectedIndustry.subindustries.filter((s) => {
      if (!s.countries || s.countries.length === 0) return true;
      return row.countryCode ? s.countries.includes(row.countryCode) : true;
    });
    return filtered;
  }, [selectedIndustry, row.countryCode]);

  // Reset subindustry when industry changes
  React.useEffect(() => {
    if (selectedIndustry && selectedSubindustryId) {
      const stillValid = availableSubindustries.some((s) => s.id === selectedSubindustryId);
      if (!stillValid) {
        setSelectedSubindustryId('');
      }
    }
  }, [selectedIndustryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Industry select options ────────────────────────────────────────────────

  const industryOptions = React.useMemo(
    () =>
      catalog.industries.map((i) => ({
        value: i.id,
        label: i.name,
      })),
    [catalog.industries],
  );

  const subindustryOptions = React.useMemo(
    () =>
      availableSubindustries.map((s) => ({
        value: s.id,
        label: s.name,
      })),
    [availableSubindustries],
  );

  // ── Save handler ───────────────────────────────────────────────────────────

  const handleSave = React.useCallback(async () => {
    if (!selectedIndustryId) {
      setValidationMessage({ type: 'error', text: 'Debes seleccionar una industria.' });
      return;
    }

    setIsSaving(true);
    setValidationMessage(null);

    try {
      await onCorrect({
        rowNumber: row.rowNumber,
        industryId: selectedIndustryId,
        subindustryId: selectedSubindustryId || null,
        catalogVersion: catalogVersion.version,
      });
      setValidationMessage({ type: 'success', text: 'Corrección aplicada.' });
    } catch (err) {
      setValidationMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al aplicar corrección',
      });
    } finally {
      setIsSaving(false);
    }
  }, [selectedIndustryId, selectedSubindustryId, row.rowNumber, catalogVersion.version, onCorrect]);

  // ── Reset to automatic ─────────────────────────────────────────────────────

  const handleReset = React.useCallback(() => {
    setSelectedIndustryId(row.industryCanonicalId ?? '');
    setSelectedSubindustryId(row.subindustryCanonicalId ?? '');
    setValidationMessage(null);
  }, [row.industryCanonicalId, row.subindustryCanonicalId]);

  // ── Status info ────────────────────────────────────────────────────────────

  const statusConfig = CLASSIFICATION_STATUS_MAP[row.validationStatus];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            Corregir clasificación — Fila {row.rowNumber}
          </h4>
          <p className="text-xs text-muted-foreground">{row.companyName}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
          aria-label="Cerrar panel de corrección"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Current classification */}
      <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Clasificación actual
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground">Industria</p>
            <p className="text-xs font-medium text-foreground">
              {row.industryCanonicalName ?? row.industryOriginalValue ?? '—'}
            </p>
            {row.industryOriginalValue && row.industryCanonicalName &&
              row.industryOriginalValue !== row.industryCanonicalName && (
                <p className="text-[10px] text-muted-foreground">
                  Original: <span className="italic">{row.industryOriginalValue}</span>
                </p>
              )}
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Subindustria</p>
            <p className="text-xs font-medium text-foreground">
              {row.subindustryCanonicalName ?? row.subindustryOriginalValue ?? '—'}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={statusConfig.variant === 'success' ? 'secondary' : statusConfig.variant === 'warning' ? 'default' : 'destructive'} className="text-[10px]">
            {statusConfig.label}
          </Badge>
          {row.correctionSource && (
            <Badge variant="outline" className="text-[10px]">
              Corrección: {row.correctionSource}
            </Badge>
          )}
        </div>
      </div>

      {/* Warnings */}
      {row.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">
              Advertencias
            </p>
          </div>
          <ul className="space-y-0.5">
            {row.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-700">
                {w.message ?? 'Advertencia'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Correction form */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Corrección manual
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor="correction-industry">
            Industria
          </label>
          <SearchableSelect
            options={industryOptions}
            value={selectedIndustryId}
            onValueChange={setSelectedIndustryId}
            placeholder="Seleccionar industria..."
            searchPlaceholder="Buscar industria..."
            emptyMessage="No se encontraron industrias"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor="correction-subindustry">
            Subindustria
          </label>
          <SearchableSelect
            options={subindustryOptions}
            value={selectedSubindustryId}
            onValueChange={setSelectedSubindustryId}
            placeholder={selectedIndustry ? 'Seleccionar subindustria...' : 'Primero selecciona una industria'}
            searchPlaceholder="Buscar subindustria..."
            emptyMessage="No se encontraron subindustries para esta industria y país"
            disabled={!selectedIndustry}
          />
        </div>
      </div>

      {/* Validation message */}
      {validationMessage && (
        <div
          className={`rounded-xl border p-3 ${
            validationMessage.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : validationMessage.type === 'warning'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-destructive/30 bg-destructive/5'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {validationMessage.type === 'success' ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            ) : validationMessage.type === 'warning' ? (
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            ) : (
              <Info className="h-3 w-3 text-destructive" />
            )}
            <p className="text-xs text-foreground">{validationMessage.text}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="h-8 text-xs"
        >
          Restablecer
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !selectedIndustryId}
          className="h-8 text-xs bg-su-brand text-white hover:bg-su-brand/90"
        >
          {isSaving ? 'Aplicando...' : 'Aplicar corrección'}
        </Button>
      </div>
    </div>
  );
}
