/**
 * Pipeline — suma el Agente 3 al recorrido de una empresa (puro).
 *
 * Con el agente encendido, las etapas «Inteligencia de cuenta» y «Preparación y
 * contacto» dejan de ser «Próximamente»: se vuelven etapas con agente. Una etapa sin nada
 * hecho se pinta como invitación a activarla; con algo hecho, como una tarjeta con su
 * resumen. Apagado, el recorrido queda EXACTAMENTE como lo armó `buildAccountJourney`.
 */

import { buildFirstCallEvents } from '@/modules/speech/first-call-activity';
import { isBriefFresh } from '@/modules/speech/first-call-state';
import { RESEARCH_TOPICS, RESEARCH_TOPIC_LABELS, type FirstCallPack, type ResearchBrief } from '@/server/agents/first-call/types';
import { ubitsProductName, ubitsProductNames } from '@/server/agents/first-call/ubits-messaging-library';
import type { AccountJourney, JourneyEvent, JourneyFirstCall, JourneyStage, PipelineStageId } from './types';

/** Las dos etapas que cubre el Agente 3. */
export const FIRST_CALL_STAGE_IDS: readonly PipelineStageId[] = ['inteligencia', 'preparacion'];

export function isFirstCallStage(stageId: PipelineStageId | null | undefined): boolean {
  return !!stageId && FIRST_CALL_STAGE_IDS.includes(stageId);
}

/** Hipótesis que se enseñan en la etapa (el resto, en la ficha de la empresa). */
const HYPOTHESES_SHOWN = 2;

/** Rótulo del agente en las etapas que cubre. */
export const FIRST_CALL_AGENT_LABEL = 'Agente 3';

export interface FirstCallJourneySource {
  enabled: boolean;
  brief: ResearchBrief | null;
  packs: readonly FirstCallPack[];
}

/** `null` cuando el agente está apagado: el recorrido no cambia. */
export function toJourneyFirstCall(
  source: FirstCallJourneySource,
  contacts: ReadonlyArray<{ id: string; name: string; title: string | null }>,
  nowMs: number,
): JourneyFirstCall | null {
  if (!source.enabled) return null;
  const brief = source.brief;
  return {
    freshBrief: isBriefFresh(brief, nowMs),
    brief:
      brief && brief.status !== 'running'
        ? {
            status: brief.status,
            summary: brief.summary,
            completedAt: brief.completedAt,
            factsCount: brief.facts.filter((fact) => fact.sourceKind !== 'sellup').length,
            sourcesCount: brief.sources.length,
            topics: RESEARCH_TOPICS.map((topic) => ({
              label: RESEARCH_TOPIC_LABELS[topic],
              count: brief.facts.filter((fact) => fact.topic === topic && fact.sourceKind !== 'sellup').length,
            })).filter((t) => t.count > 0),
            hypotheses: brief.hypotheses.slice(0, HYPOTHESES_SHOWN).map((h) => ({ text: h.text, productName: ubitsProductName(h.productKey) })),
            gapsCount: brief.gaps.length,
            expiresAt: brief.expiresAt,
          }
        : null,
    packs: source.packs
      .filter((pack): pack is FirstCallPack & { status: 'draft' | 'needs_review' | 'used' } =>
        pack.status === 'draft' || pack.status === 'needs_review' || pack.status === 'used',
      )
      .map((pack) => ({
        id: pack.id,
        contactId: pack.contactId,
        targetName: pack.targetName,
        targetTitle: pack.targetTitle,
        channel: pack.channel,
        status: pack.status,
        createdAt: pack.createdAt,
        usedAt: pack.usedAt,
        productNames: ubitsProductNames(pack.productFocus),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    contacts: [...contacts],
  };
}

function liveStage(entry: JourneyStage, firstCall: JourneyFirstCall): JourneyStage {
  const isResearch = entry.stage.id === 'inteligencia';
  const latestPackAt = firstCall.packs[0]?.createdAt ?? null;
  return {
    ...entry,
    // Con agente: deja de ser «Próximamente» y su etiqueta es la del agente.
    stage: { ...entry.stage, phase: 'hecho', agent: FIRST_CALL_AGENT_LABEL, plannedText: null },
    notStarted: isResearch ? firstCall.brief === null : firstCall.packs.length === 0,
    milestoneAt: isResearch
      ? (firstCall.brief?.completedAt ?? entry.milestoneAt)
      : (latestPackAt ?? entry.milestoneAt),
  };
}

/**
 * Suma el agente al recorrido y a su historial. `events` son los del agente
 * (`buildFirstCallEvents`), que se mezclan con los que ya había.
 */
export function applyFirstCallToJourney(
  journey: AccountJourney,
  firstCall: JourneyFirstCall | null,
  events: ReadonlyArray<ReturnType<typeof buildFirstCallEvents>[number]> = [],
): AccountJourney {
  if (!firstCall) return journey;
  const agentEvents: JourneyEvent[] = events.map((event) => ({
    id: `agent3-${event.id}`,
    kind: 'run',
    at: event.at,
    title: event.title,
    description: event.description,
    tone: event.tone,
  }));
  return {
    ...journey,
    agent3: firstCall,
    stages: journey.stages.map((entry) => (isFirstCallStage(entry.stage.id) ? liveStage(entry, firstCall) : entry)),
    history: [...journey.history, ...agentEvents].sort((a, b) => b.at.localeCompare(a.at)),
  };
}
