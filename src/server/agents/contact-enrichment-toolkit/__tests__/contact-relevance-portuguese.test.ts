// AGENT2-AUDIT-FIXES-1 — cargos en portugués y frases de «Personas» en español.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyContactRelevance, type ContactRelevanceInput } from '../contact-relevance-classifier';

const contact = (title: string): ContactRelevanceInput => ({
  fullName: 'Ana Souza', firstName: 'Ana', lastName: 'Souza', title, headline: null,
  email: 'ana@empresa.com.br', linkedinUrl: null, phone: null,
});

describe('relevancia — portugués y «Personas»', () => {
  for (const title of [
    'Gerente de RH',
    'Diretora de Gestão de Pessoas',
    'Coordenador de Treinamento e Desenvolvimento',
    'Analista de Recrutamento e Seleção',
    'Gerente de Educação Corporativa',
    'Gerente de Gestión de Personas',
    'Subgerente Desarrollo Humano',
  ]) {
    it(`«${title}» es de alta relevancia`, () => {
      assert.equal(classifyContactRelevance(contact(title)).relevanceStatus, 'high_relevance');
    });
  }

  it('«Diretor Geral» es sponsor (media)', () => {
    assert.equal(classifyContactRelevance(contact('Diretor Geral')).relevanceStatus, 'medium_relevance');
  });

  it('«Gerente Banca Personas» (banca minorista) NO es de RR. HH.', () => {
    assert.notEqual(classifyContactRelevance(contact('Gerente Banca Personas')).relevanceStatus, 'high_relevance');
  });

  it('«Gerente de Riscos» no es relevante', () => {
    assert.equal(classifyContactRelevance(contact('Gerente de Riscos')).relevanceStatus, 'not_relevant');
  });
});
