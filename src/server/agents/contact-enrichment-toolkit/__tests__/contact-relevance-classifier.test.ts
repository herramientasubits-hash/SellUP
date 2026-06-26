/**
 * Tests — Contact Relevance & Quality Classifier (Agente 2A, Hito 17A.3B)
 *
 * Verifica clasificación de relevancia (HR/People/Learning vs sponsor vs ruido)
 * y de calidad mínima (insufficient_data), más la decisión de inserción.
 * Función pura: sin red, sin DB, sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyContactRelevance,
  type ContactRelevanceInput,
} from '../contact-relevance-classifier';

/** Contacto base con calidad suficiente (nombre completo + canal + title). */
function base(overrides: Partial<ContactRelevanceInput> = {}): ContactRelevanceInput {
  return {
    fullName: 'María Pérez',
    firstName: 'María',
    lastName: 'Pérez',
    title: null,
    headline: null,
    email: 'maria@corp.com',
    linkedinUrl: null,
    phone: null,
    ...overrides,
  };
}

describe('classifyContactRelevance — alta relevancia', () => {
  it('Gerente de Talento Humano → high_relevance, insertable', () => {
    const r = classifyContactRelevance(base({ title: 'Gerente de Talento Humano' }));
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.shouldInsertForReview, true);
    assert.equal(r.matchedCategory, 'talent');
    assert.ok(r.matchedKeywords.length > 0);
    assert.deepEqual(r.rejectionReasons, []);
  });

  it('Head of People → high_relevance', () => {
    const r = classifyContactRelevance(base({ title: 'Head of People' }));
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.matchedCategory, 'people');
    assert.equal(r.shouldInsertForReview, true);
  });

  it('Learning & Development Manager → high_relevance', () => {
    const r = classifyContactRelevance(base({ title: 'Learning & Development Manager' }));
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.matchedCategory, 'learning');
    assert.equal(r.shouldInsertForReview, true);
  });

  it('Directora de Recursos Humanos → high_relevance (categoría hr)', () => {
    const r = classifyContactRelevance(base({ title: 'Directora de Recursos Humanos' }));
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.matchedCategory, 'hr');
    assert.equal(r.shouldInsertForReview, true);
  });
});

describe('classifyContactRelevance — media relevancia', () => {
  it('VP Innovación & Sostenibilidad → medium_relevance, insertable', () => {
    const r = classifyContactRelevance(base({ title: 'VP Innovación & Sostenibilidad' }));
    assert.equal(r.relevanceStatus, 'medium_relevance');
    assert.equal(r.matchedCategory, 'executive_sponsor');
    assert.equal(r.shouldInsertForReview, true);
  });
});

describe('classifyContactRelevance — baja / no relevante', () => {
  it('Analista Ciberseguridad → not_relevant, no insertable', () => {
    const r = classifyContactRelevance(base({ title: 'Analista Ciberseguridad' }));
    assert.equal(r.relevanceStatus, 'not_relevant');
    assert.equal(r.shouldInsertForReview, false);
    assert.ok(r.matchedKeywords.includes('ciberseguridad'));
  });

  it('Software Engineer → not_relevant, no insertable', () => {
    const r = classifyContactRelevance(base({ title: 'Software Engineer' }));
    assert.equal(r.relevanceStatus, 'not_relevant');
    assert.equal(r.shouldInsertForReview, false);
  });

  it('Financial Advisor → not_relevant', () => {
    const r = classifyContactRelevance(base({ title: 'Financial Advisor' }));
    assert.equal(r.relevanceStatus, 'not_relevant');
    assert.equal(r.shouldInsertForReview, false);
  });

  it('Analista de Riesgos Gerencia ERM → not_relevant', () => {
    const r = classifyContactRelevance(base({ title: 'Analista de Riesgos Gerencia ERM' }));
    assert.equal(r.relevanceStatus, 'not_relevant');
    assert.equal(r.shouldInsertForReview, false);
  });

  it('cargo neutro sin señal → low_relevance, no insertable', () => {
    const r = classifyContactRelevance(base({ title: 'Gerente Zona Barranquilla' }));
    assert.ok(r.relevanceStatus === 'low_relevance' || r.relevanceStatus === 'not_relevant');
    assert.equal(r.shouldInsertForReview, false);
  });
});

describe('classifyContactRelevance — calidad mínima', () => {
  it('solo primer nombre + sin email/linkedin/phone → insufficient_data, no insertable', () => {
    const r = classifyContactRelevance({
      fullName: 'Mauricio',
      firstName: 'Mauricio',
      lastName: null,
      title: 'VP Corporativo de Auditoría Interna',
      email: null,
      linkedinUrl: null,
      phone: null,
    });
    assert.equal(r.relevanceStatus, 'insufficient_data');
    assert.equal(r.shouldInsertForReview, false);
    assert.ok(r.rejectionReasons.length > 0);
  });

  it('cargo HR perfecto pero sin nombre → insufficient_data (calidad manda)', () => {
    const r = classifyContactRelevance({
      fullName: '',
      title: 'Gerente de Talento Humano',
      email: null,
      linkedinUrl: null,
      phone: null,
    });
    assert.equal(r.relevanceStatus, 'insufficient_data');
    assert.equal(r.shouldInsertForReview, false);
  });

  it('nombre completo + LinkedIn + title HR → insertable', () => {
    const r = classifyContactRelevance({
      fullName: 'Ana López',
      firstName: 'Ana',
      lastName: 'López',
      title: 'HR Business Partner',
      email: null,
      linkedinUrl: 'https://linkedin.com/in/analopez',
      phone: null,
    });
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.shouldInsertForReview, true);
  });

  it('nombre completo + title HR sin ningún canal → insertable (nombre completo basta)', () => {
    const r = classifyContactRelevance({
      fullName: 'Carla Gómez',
      firstName: 'Carla',
      lastName: 'Gómez',
      title: 'Head of People',
      email: null,
      linkedinUrl: null,
      phone: null,
    });
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.shouldInsertForReview, true);
  });

  it('primer nombre solo PERO con email → no es insuficiente por nombre incompleto', () => {
    const r = classifyContactRelevance({
      fullName: 'Mauricio',
      firstName: 'Mauricio',
      lastName: null,
      title: 'Gerente de Gestión Humana',
      email: 'mauricio@corp.com',
      linkedinUrl: null,
      phone: null,
    });
    // Tiene canal → no cae por nombre incompleto; cargo HR → insertable.
    assert.equal(r.relevanceStatus, 'high_relevance');
    assert.equal(r.shouldInsertForReview, true);
  });
});
