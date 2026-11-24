/**
 * AGENT2A — Dueña 24-11: en «Contactos de una empresa» se pegaba el enlace de una PERSONA y Rumbo
 * buscaba una empresa con ese nombre («Rosario Gómez Yáñez») o con el dominio «app.hubspot.com».
 *
 * Contrato PURO:
 *   - un perfil de LinkedIn de persona (`/in/…`, con tildes codificadas, subdominio de país,
 *     parámetros, formatos viejos `/pub/` y de Sales Navigator) y el enlace de un CONTACTO de
 *     HubSpot se reconocen como persona y se ofrecen buscar como contacto;
 *   - las páginas de empresa de LinkedIn, los enlaces de empresa de HubSpot, nombres, dominios,
 *     correos e IDs sueltos siguen siendo empresa;
 *   - el chat no repite el enlace (dato personal) y el mensaje dice qué se puede hacer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactEnrichmentChatReducer,
  createInitialContactEnrichmentChatState,
  isComposerUnlocked,
  personLinkSource,
  personOfferMessage,
} from '../contact-enrichment-chat-reducer';
import { detectContactSearchInput } from '@/modules/contact-enrichment/contact-search-input';

const LINKEDIN_PEOPLE = [
  'https://www.linkedin.com/in/rosario-gomez-ya%C3%B1ez-1308302a/',
  'linkedin.com/in/rosario-gomez-yañez-1308302a',
  'https://co.linkedin.com/in/ana-perez?trk=public_profile',
  'www.linkedin.com/in/ana-perez/details/experience/',
  'https://www.linkedin.com/pub/ana-perez/1/2/3',
];
const HUBSPOT_PEOPLE = [
  'https://app.hubspot.com/contacts/123456/record/0-1/987654321',
  'https://app.hubspot.com/contacts/123456/contact/987654321/',
];
const COMPANIES = [
  'Bancolombia',
  'bancolombia.com',
  'ana.perez@bancolombia.com.co',
  '65498491',
  'https://www.linkedin.com/company/bancolombia/',
  'https://www.linkedin.com/school/universidad-de-los-andes/',
  'https://app.hubspot.com/contacts/123456/record/0-2/65498491',
];

describe('Enlace de una persona en «Contactos de una empresa» (dueña 24-11)', () => {
  for (const value of LINKEDIN_PEOPLE) {
    it(`perfil de LinkedIn → persona: ${value}`, () => {
      assert.equal(personLinkSource(value), 'linkedin');
      // Y el modo de contacto lo acepta como LinkedIn.
      assert.equal(detectContactSearchInput(value).kind, 'linkedin');
    });
  }

  for (const value of HUBSPOT_PEOPLE) {
    it(`contacto de HubSpot → persona: ${value}`, () => {
      assert.equal(personLinkSource(value), 'hubspot');
      assert.equal(detectContactSearchInput(value).kind, 'hubspot_contact_id');
    });
  }

  for (const value of COMPANIES) {
    it(`empresa sigue siendo empresa: ${value}`, () => {
      assert.equal(personLinkSource(value), null);
    });
  }

  it('el chat no repite el enlace y ofrece buscar a la persona sin perder la caja', () => {
    const raw = LINKEDIN_PEOPLE[0]!;
    const state = contactEnrichmentChatReducer(createInitialContactEnrichmentChatState(), {
      type: 'OFFER_PERSON',
      query: raw,
      canSearch: true,
      source: 'linkedin',
    });
    assert.equal(state.step, 'offer_person');
    assert.deepEqual(state.personOffer, { raw, canSearch: true, source: 'linkedin' });
    assert.equal(state.query, '');
    assert.ok(state.messages.every((m) => !m.content.includes('rosario')), 'no repite el perfil');
    assert.equal(state.messages.at(-2)?.content, 'Perfil de LinkedIn enviado.');
    assert.match(state.messages.at(-1)?.content ?? '', /puedo buscar a esta persona/);
    assert.equal(isComposerUnlocked(state), true, 'se puede escribir la empresa en su lugar');
  });

  it('enlace de contacto de HubSpot: lo dice con sus palabras', () => {
    const state = contactEnrichmentChatReducer(createInitialContactEnrichmentChatState(), {
      type: 'OFFER_PERSON',
      query: HUBSPOT_PEOPLE[0]!,
      canSearch: true,
      source: 'hubspot',
    });
    assert.equal(state.messages.at(-2)?.content, 'Enlace de contacto de HubSpot enviado.');
    assert.match(state.messages.at(-1)?.content ?? '', /es de un contacto de HubSpot, no de una empresa/);
  });

  it('sin la búsqueda por LinkedIn activa: pide la empresa y no ofrece buscar a la persona', () => {
    const copy = personOfferMessage(false, 'linkedin');
    assert.match(copy, /escribe abajo el nombre, el dominio o el HubSpot ID de su empresa/);
    assert.doesNotMatch(copy, /puedo buscar a esta persona/);
  });
});
