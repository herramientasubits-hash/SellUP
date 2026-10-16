/**
 * Agente 3 · Primera llamada — lo que SellUp ya sabe de la empresa, como hechos (puro).
 *
 * Paso gratis de la investigación: tamaño e industria de la ficha, la clasificación
 * con cita del Agente 1, las listas curadas donde aparece, el árbol de empresas,
 * el estado en HubSpot y el decisor elegido. Ninguno pasa por un modelo.
 */

import type { ResearchFact, ResearchTopic } from './types';

export interface AccountSnapshot {
  id: string;
  name: string;
  legalName: string | null;
  website: string | null;
  domain: string | null;
  country: string | null;
  countryCode: string | null;
  industry: string | null;
  companySize: string | null;
  taxIdentifier: string | null;
  taxIdentifierType: string | null;
  hubspotCompanyId: string | null;
}

/** Evidencia que el clasificador del Agente 1 ya verificó (cita literal + URL). */
export interface PriorClassificationEvidence {
  sector: { label: string | null; quote: string; sourceUrl: string } | null;
  employeeRange: { min: number; max: number | null; quote: string; sourceUrl: string } | null;
}

export interface CorporateRelation {
  relationType: 'root' | 'group' | 'subsidiary' | 'other_country';
  name: string;
  countryCode: string | null;
}

export type HubSpotRelationStatus =
  | 'customer'
  | 'active_prospect'
  | 'recyclable_prospect'
  | 'ex_customer'
  | 'unknown'
  | 'no_match'
  | 'not_connected';

export interface HubSpotRelation {
  status: HubSpotRelationStatus;
  lifecycleStage: string | null;
  lastActivityDate: string | null;
  numberOfDeals: number | null;
}

export interface DecisionMaker {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
}

export interface InternalContext {
  account: AccountSnapshot;
  classification: PriorClassificationEvidence | null;
  /** Nombres de las listas curadas donde aparece («Merco Empresas 2025»…). */
  curatedLists: string[];
  relations: CorporateRelation[];
  hubspot: HubSpotRelation | null;
  decisionMaker: DecisionMaker | null;
}

const TALENT_LIST = /(merco talento|great place|gptw|mejores empleadores|best places|best workplaces|empleador)/i;

const RELATION_LABELS: Record<CorporateRelation['relationType'], string> = {
  root: 'Empresa de partida',
  group: 'Grupo o matriz',
  subsidiary: 'Filial',
  other_country: 'Misma empresa en otro país',
};

const HUBSPOT_STATEMENTS: Record<HubSpotRelationStatus, string | null> = {
  customer: 'Ya es cliente de UBITS en HubSpot.',
  active_prospect: 'Ya está en un proceso comercial abierto en HubSpot.',
  recyclable_prospect: 'Estuvo en HubSpot y quedó libre para volver a trabajarse.',
  ex_customer: 'Fue cliente de UBITS en el pasado según HubSpot.',
  unknown: 'Aparece en HubSpot, sin estado comercial claro.',
  no_match: 'No aparece en HubSpot: sería un primer contacto.',
  not_connected: null,
};

type Draft = Omit<ResearchFact, 'id'>;

function sellupFact(topic: ResearchTopic, statement: string, sourceLabel: string): Draft {
  return { topic, statement, quote: null, sourceKind: 'sellup', sourceUrl: null, sourceLabel, publishedOn: null };
}

function relationsStatement(relations: readonly CorporateRelation[]): string | null {
  const useful = relations.filter((r) => r.relationType !== 'root').slice(0, 6);
  if (useful.length === 0) return null;
  const parts = useful.map(
    (r) => `${r.name}${r.countryCode ? ` (${r.countryCode})` : ''}: ${RELATION_LABELS[r.relationType].toLowerCase()}`,
  );
  return `Empresas relacionadas en el árbol: ${parts.join('; ')}.`;
}

function hubspotStatement(hubspot: HubSpotRelation): string | null {
  const base = HUBSPOT_STATEMENTS[hubspot.status];
  if (!base) return null;
  const extras: string[] = [];
  if (hubspot.lifecycleStage) extras.push(`etapa «${hubspot.lifecycleStage}»`);
  if (hubspot.lastActivityDate) extras.push(`última actividad ${hubspot.lastActivityDate.slice(0, 10)}`);
  if (hubspot.numberOfDeals && hubspot.numberOfDeals > 0) extras.push(`${hubspot.numberOfDeals} negocio(s) asociados`);
  return extras.length > 0 ? `${base.slice(0, -1)} (${extras.join(', ')}).` : base;
}

/**
 * Hechos internos estables de la empresa (van a la ficha), en el orden en que se
 * muestran. Los IDs se ponen al armar la ficha. El decisor y HubSpot van aparte
 * (`buildRequestFacts`).
 */
export function buildInternalFacts(context: InternalContext): Draft[] {
  const { account, classification } = context;
  const facts: Draft[] = [];

  if (classification?.sector) {
    facts.push({
      topic: 'business',
      statement: classification.sector.label
        ? `A qué se dedica (sector ${classification.sector.label}), según su fuente.`
        : 'A qué se dedica, según su fuente.',
      quote: classification.sector.quote,
      sourceKind: 'sellup',
      sourceUrl: classification.sector.sourceUrl,
      sourceLabel: 'Clasificación verificada del Agente 1',
      publishedOn: null,
    });
  } else if (account.industry) {
    facts.push(sellupFact('business', `Industria registrada: ${account.industry}.`, 'Ficha de SellUp'));
  }

  if (classification?.employeeRange) {
    const { min, max } = classification.employeeRange;
    facts.push({
      topic: 'size_presence',
      statement: max ? `Tiene entre ${min} y ${max} empleados según su fuente.` : `Tiene más de ${min} empleados según su fuente.`,
      quote: classification.employeeRange.quote,
      sourceKind: 'sellup',
      sourceUrl: classification.employeeRange.sourceUrl,
      sourceLabel: 'Clasificación verificada del Agente 1',
      publishedOn: null,
    });
  } else if (account.companySize) {
    facts.push(sellupFact('size_presence', `Tamaño registrado: ${account.companySize}.`, 'Ficha de SellUp'));
  }

  if (account.country) {
    facts.push(sellupFact('size_presence', `País principal: ${account.country}.`, 'Ficha de SellUp'));
  }

  const relations = relationsStatement(context.relations);
  if (relations) facts.push(sellupFact('size_presence', relations, 'Árbol de empresas del Agente 1'));

  for (const label of context.curatedLists.slice(0, 4)) {
    facts.push({
      topic: TALENT_LIST.test(label) ? 'talent' : 'size_presence',
      statement: `Aparece en la lista «${label}».`,
      quote: null,
      sourceKind: 'curated_list',
      sourceUrl: null,
      sourceLabel: label,
      publishedOn: null,
    });
  }

  return facts;
}

/**
 * Hechos de ESTA solicitud: el decisor elegido y el estado de HubSpot de hoy. No se
 * guardan en la ficha (que vale 30 días y es de toda la empresa): se añaden al
 * redactar cada paquete, así otro decisor no hereda el anterior y HubSpot nunca
 * queda viejo.
 */
export function buildRequestFacts(context: Pick<InternalContext, 'hubspot' | 'decisionMaker'>): Draft[] {
  const facts: Draft[] = [];
  if (context.hubspot) {
    const statement = hubspotStatement(context.hubspot);
    if (statement) facts.push(sellupFact('ubits_relation', statement, 'HubSpot'));
  }
  if (context.decisionMaker) {
    const dm = context.decisionMaker;
    const role = [dm.title, dm.department].filter(Boolean).join(' · ');
    facts.push(
      sellupFact('decision_maker', role ? `Decisor elegido: ${dm.name}, ${role}.` : `Decisor elegido: ${dm.name}.`, 'Contactos de SellUp'),
    );
  }
  return facts;
}

/** ¿El estado en HubSpot pide avisar antes de tratarla como llamada en frío? */
export function hubspotWarning(hubspot: HubSpotRelation | null): string | null {
  if (!hubspot) return null;
  if (hubspot.status === 'customer') return 'Esta empresa ya es cliente: no la trates como llamada en frío.';
  if (hubspot.status === 'active_prospect') {
    return 'Esta empresa tiene un proceso comercial abierto en HubSpot: confirma con su responsable antes de llamar.';
  }
  return null;
}
