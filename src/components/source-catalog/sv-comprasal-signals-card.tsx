/**
 * Read-only signals card for COMPRASAL El Salvador (sv_comprasal).
 *
 * Displays weak signal summary from source_company_signals.
 * sv_comprasal is a weak B2G procurement signal — NOT a legal registry,
 * NOT a tax authority, does NOT validate NIT/NRC.
 * No post-approval. No automatic matching. Human review required.
 *
 * Guardrails (display only — no I/O, no secret access):
 *   noComprasalApiRuntime    : never fetches from comprasal.gob.sv at render time
 *   noRawDataDisplay         : never shows raw_data fields
 *   noTaxIdDisplay           : never shows NIT / NRC fields
 *   noPostApprovalClaim      : does not claim post-approval is active
 *   noAutoMatchingClaim      : does not claim automatic matching exists
 *   noValidatedCopy          : never uses "validado", "verificado", "identidad fiscal"
 *   noConnectedCopy          : never uses "conectado" for operational flow
 *
 * Hito: Centroamérica.7E.3
 */

import { formatInAppZone } from '@/lib/format-date';
import type { SvComprasalSignalsSummary } from '@/server/services/sv-comprasal-signals-summary';
import { Landmark } from "@/icons";
import { Badge } from '@/components/ui/badge';
import {
  CoverageBullet,
  CoverageBulletList,
  CoverageCard,
  CoverageCardError,
  CoverageFieldGroup,
  CoverageFieldRow,
  CoverageSection,
  CoverageSignalSummary,
  CoverageSourceReason,
  CoverageStatusNotice,
} from '@/components/source-catalog/coverage-card';

// ─── Pure display helpers (exported for unit tests) ──────────────────────────

export function formatSvTotalSignals(count: number): string {
  if (count === 0) return 'Sin señales persistidas';
  return `${count.toLocaleString('es-SV')} señales persistidas`;
}

export function formatSvSourceYears(years: number[]): string {
  if (!years || years.length === 0) return 'No disponible';
  return years.join(', ');
}

export function formatSvLatestImportedAt(iso: string | null): string {
  if (!iso) return 'No disponible';
  try {
    return formatInAppZone(iso, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }, 'es-SV');
  } catch {
    return iso;
  }
}

export function isSvFiscalSource(summary: SvComprasalSignalsSummary): boolean {
  return summary.isFiscalSource;
}

export function isSvPostApprovalConnected(summary: SvComprasalSignalsSummary): boolean {
  return summary.postApprovalConnected;
}

export function isSvAutoMatchingEnabled(summary: SvComprasalSignalsSummary): boolean {
  return summary.automaticMatchingEnabled;
}

// ─── Main card ───────────────────────────────────────────────────────────────

interface SvComprasalSignalsCardProps {
  summary?: SvComprasalSignalsSummary;
  error?: boolean;
}

const CARD_TITLE = 'Señales COMPRASAL El Salvador';

export function SvComprasalSignalsCard({ summary, error }: SvComprasalSignalsCardProps) {
  if (error || !summary) {
    return (
      <CoverageCardError
        icon={Landmark}
        title={CARD_TITLE}
        message="No se pudo cargar el resumen de señales. Revisa la configuración del servicio."
      />
    );
  }

  const hasSignals = summary.totalSignals > 0;

  return (
    <CoverageCard icon={Landmark} title={CARD_TITLE}>
      <CoverageSignalSummary title="Tipo de señal">
        <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
          <Badge variant="warning">Señal débil</Badge>
          <Badge variant="neutral">Solo nombre</Badge>
          <Badge variant="neutral">Revisión humana requerida</Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          COMPRASAL aporta señales comerciales B2G de proveedores adjudicados en compras públicas
          de El Salvador, pero no expone NIT ni NRC. Estas señales requieren revisión humana
          antes de asociarse a una cuenta.
        </p>
      </CoverageSignalSummary>

      <CoverageFieldGroup title="Señales persistidas">
        <CoverageFieldRow label="Total de señales" value={formatSvTotalSignals(summary.totalSignals)} />
        <CoverageFieldRow label="Años cubiertos" value={formatSvSourceYears(summary.sourceYears)} />
        <CoverageFieldRow label="Última importación" value={formatSvLatestImportedAt(summary.latestImportedAt)} />
        <CoverageFieldRow label="País" value="El Salvador (SV)" />
        <CoverageFieldRow label="Tipo de señal" value="Procurement B2G" />
        <CoverageFieldRow
          label="Fuente del indicador"
          value={summary.dataSource === 'live_database' ? 'base de datos en vivo' : 'fallback auditado'}
        />
      </CoverageFieldGroup>

      <CoverageFieldGroup title="Clasificación de señal">
        <CoverageFieldRow label="Fuerza de señal" value="Débil — solo por nombre (weak_name_only)" />
        <CoverageFieldRow label="Modo de matching" value="Revisión manual requerida (name_only_review_required)" />
        <CoverageFieldRow label="Revisión humana" value="Sí — obligatoria antes de asociar" />
        <CoverageFieldRow label="Fuente fiscal / tributaria" value="No — no es fuente fiscal" />
        <CoverageFieldRow label="Valida NIT El Salvador" value="No — no expone NIT" />
        <CoverageFieldRow label="Valida NRC El Salvador" value="No — no expone NRC" />
        <CoverageFieldRow label="Reemplaza Ministerio de Hacienda" value="No" />
        <CoverageFieldRow label="Reemplaza CNR / Registro de Comercio" value="No" />
        <CoverageFieldRow label="Post-approval conectado" value="No — no conectada a flujos automáticos" />
        <CoverageFieldRow label="Matching automático" value="No — requiere revisión humana" />
      </CoverageFieldGroup>

      <CoverageSection title="Limitaciones">
        <CoverageBulletList>
          <CoverageBullet>No valida NIT ni NRC. No expone identificadores fiscales públicos.</CoverageBullet>
          <CoverageBullet>No reemplaza Ministerio de Hacienda El Salvador.</CoverageBullet>
          <CoverageBullet>No reemplaza CNR / Registro de Comercio de El Salvador.</CoverageBullet>
          <CoverageBullet>No es fuente legal ni tributaria.</CoverageBullet>
          <CoverageBullet>No conectada a post-approval automático.</CoverageBullet>
          <CoverageBullet>No permite matching automático por nombre.</CoverageBullet>
          <CoverageBullet>Usar como contexto comercial, no como validación legal ni fiscal.</CoverageBullet>
        </CoverageBulletList>
      </CoverageSection>

      <CoverageStatusNotice title="Estado operativo">
        {hasSignals
          ? `${summary.totalSignals} señales comerciales B2G persistidas en Source Company Signals. `
          : 'Sin señales persistidas aún. '}
        No conectada a post-approval automático. La fuente permanece en{' '}
        <span className="font-medium">eligible_not_connected</span>{' '}
        hasta que se operativice un flujo de enriquecimiento con revisión humana.
        {' '}No es fuente legal. No es fuente fiscal. No valida NIT. No valida NRC.
        {' '}No reemplaza Ministerio de Hacienda El Salvador ni CNR.
      </CoverageStatusNotice>

      <CoverageSourceReason reason={summary.dataSourceReason ? 'lectura dinámica no disponible' : null} />
    </CoverageCard>
  );
}
