'use client';

import { Gauge, PhoneCall, ShieldCheck } from '@/icons';
import { DetailList } from '@/components/shared/detail-list';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { PhoneRevealWaterfallAuditView } from '@/modules/contact-enrichment/phone-reveal-waterfall-core';
import { CandidateDetailItem } from './contact-candidate-detail-sections';
import {
  formatWaterfallLegCredits,
  resolveWaterfallFinalProviderLabel,
  resolveWaterfallLushaSkippedLabel,
  resolveWaterfallOutcomeLabel,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY,
} from './phone-reveal-waterfall-copy';

/**
 * 2b. Auditoría del waterfall de teléfono (AGENT2A-PHONE-WATERFALL-1).
 *
 * SOLO LECTURA de la proyección PII-free de la corrida: qué hizo CADA proveedor
 * y cuánto costó CADA pata por separado — nunca un total mezclado — sin exponer
 * ningún dato personal adicional. El drawer decide si se pinta (flag activo,
 * rol autorizado y corrida existente); esta pieza no decide nada ni llama a
 * ninguna acción.
 */
export function CandidateWaterfallAuditSection({
  audit,
}: {
  audit: PhoneRevealWaterfallAuditView;
}) {
  const apolloOutcomeLabel = resolveWaterfallOutcomeLabel(audit.apolloOutcome);
  const lushaOutcomeLabel = resolveWaterfallOutcomeLabel(audit.lushaOutcome);
  const finalProviderLabel = resolveWaterfallFinalProviderLabel(audit.finalProvider);

  return (
    <DrawerSection
      icon={PhoneCall}
      tone="neutral"
      title="Revelación de teléfono por proveedor"
      hint="Trazabilidad de la última revelación autorizada: qué intentó cada proveedor y cuánto costó cada consulta."
    >
      <DetailList>
        <CandidateDetailItem icon={PhoneCall} label="Apollo">
          <span className="flex flex-col gap-0.5">
            <span>
              {/* En una corrida legacy `apolloAttempted` es false porque
                  Apollo NO corrió bajo esta autorización — pero decir "No
                  intentado" sería falso: se intentó antes. La modalidad es
                  lo que resuelve la ambigüedad, y por eso viaja en la
                  proyección en vez de deducirse del timestamp. */}
              {audit.runMode === 'legacy_lusha_only'
                ? PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY
                : audit.apolloAttempted
                  ? 'Intentado'
                  : 'No intentado'}
              {apolloOutcomeLabel ? ` · ${apolloOutcomeLabel}` : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {/* El costo histórico pertenece a la autorización que lo pagó.
                  Aquí no se muestra ninguna cifra — y nunca un 0, que se
                  leería como "fue gratis". */}
              {audit.runMode === 'legacy_lusha_only'
                ? PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY
                : formatWaterfallLegCredits(audit.apolloCostCredits, audit.apolloCostSource)}
            </span>
          </span>
        </CandidateDetailItem>
        <CandidateDetailItem icon={PhoneCall} label="Lusha">
          <span className="flex flex-col gap-0.5">
            <span>
              {audit.lushaAttempted
                ? `Intentado${lushaOutcomeLabel ? ` · ${lushaOutcomeLabel}` : ''}`
                : (resolveWaterfallLushaSkippedLabel(audit.lushaSkippedReason) ?? 'Pendiente')}
            </span>
            {audit.lushaAttempted && (
              <span className="text-xs text-muted-foreground">
                {formatWaterfallLegCredits(audit.lushaCostCredits, audit.lushaCostSource)}
              </span>
            )}
          </span>
        </CandidateDetailItem>
        <CandidateDetailItem icon={ShieldCheck} label="Proveedor final">
          {finalProviderLabel ? <span>{finalProviderLabel}</span> : null}
        </CandidateDetailItem>
        <CandidateDetailItem icon={Gauge} label="Máximo autorizado">
          <span className="tabular-nums">{audit.maxCreditsAuthorized} créditos</span>
        </CandidateDetailItem>
      </DetailList>
    </DrawerSection>
  );
}
