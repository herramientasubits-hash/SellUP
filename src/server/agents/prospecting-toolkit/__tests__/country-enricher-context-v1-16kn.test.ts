/**
 * Tests — getCountryEnricherContext — v1.16K-N pre-pilot hardening
 *
 * Verifica:
 * - CO retorna Colombia/NIT/RUES con country_context_source = 'explicit_country'
 * - MX retorna México/RFC sin Colombia/NIT/RUES
 * - CL retorna Chile/RUT
 * - PE retorna Perú/RUC/SUNAT
 * - EC retorna Ecuador/RUC/SRI
 * - null/undefined/unknown retorna genérico sin Colombia/NIT/RUES
 *
 * Sin Supabase. Sin LLM. Sin Tavily.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getCountryEnricherContext } from '../official-candidate-enricher';

describe('getCountryEnricherContext — explicit countries', () => {
  it('CO returns Colombia/NIT/RUES', () => {
    const ctx = getCountryEnricherContext('CO');
    assert.equal(ctx.countryTerm, 'Colombia');
    assert.equal(ctx.taxIdLabel, 'NIT');
    assert.equal(ctx.registryLabel, 'RUES');
    assert.equal(ctx.country_context_source, 'explicit_country');
  });

  it('MX returns México/RFC/DENUE — does not contain Colombia/NIT/RUES', () => {
    const ctx = getCountryEnricherContext('MX');
    assert.equal(ctx.countryTerm, 'México');
    assert.equal(ctx.taxIdLabel, 'RFC');
    assert.ok(ctx.registryLabel.includes('DENUE') || ctx.registryLabel.includes('SAT'));
    assert.equal(ctx.country_context_source, 'explicit_country');
    assert.notEqual(ctx.countryTerm, 'Colombia');
    assert.notEqual(ctx.taxIdLabel, 'NIT');
    assert.notEqual(ctx.registryLabel, 'RUES');
  });

  it('CL returns Chile/RUT', () => {
    const ctx = getCountryEnricherContext('CL');
    assert.equal(ctx.countryTerm, 'Chile');
    assert.equal(ctx.taxIdLabel, 'RUT');
    assert.equal(ctx.country_context_source, 'explicit_country');
  });

  it('PE returns Perú/RUC/SUNAT', () => {
    const ctx = getCountryEnricherContext('PE');
    assert.equal(ctx.countryTerm, 'Perú');
    assert.equal(ctx.taxIdLabel, 'RUC');
    assert.ok(ctx.registryLabel.includes('SUNAT'));
    assert.equal(ctx.country_context_source, 'explicit_country');
  });

  it('EC returns Ecuador/RUC/SRI', () => {
    const ctx = getCountryEnricherContext('EC');
    assert.equal(ctx.countryTerm, 'Ecuador');
    assert.equal(ctx.taxIdLabel, 'RUC');
    assert.ok(ctx.registryLabel.includes('SRI'));
    assert.equal(ctx.country_context_source, 'explicit_country');
  });
});

describe('getCountryEnricherContext — generic fallback (P1-1)', () => {
  it('null returns generic — does NOT contain Colombia/NIT/RUES', () => {
    const ctx = getCountryEnricherContext(null);
    assert.notEqual(ctx.countryTerm, 'Colombia');
    assert.notEqual(ctx.taxIdLabel, 'NIT');
    assert.notEqual(ctx.registryLabel, 'RUES');
    assert.equal(ctx.country_context_source, 'generic_fallback');
  });

  it('undefined returns generic — does NOT contain Colombia/NIT/RUES', () => {
    const ctx = getCountryEnricherContext(undefined);
    assert.notEqual(ctx.countryTerm, 'Colombia');
    assert.notEqual(ctx.taxIdLabel, 'NIT');
    assert.notEqual(ctx.registryLabel, 'RUES');
    assert.equal(ctx.country_context_source, 'generic_fallback');
  });

  it('unknown code returns generic — does NOT contain Colombia/NIT/RUES', () => {
    const ctx = getCountryEnricherContext('BR');
    assert.notEqual(ctx.countryTerm, 'Colombia');
    assert.notEqual(ctx.taxIdLabel, 'NIT');
    assert.notEqual(ctx.registryLabel, 'RUES');
    assert.equal(ctx.country_context_source, 'generic_fallback');
    assert.equal(ctx.unsupported_country_code, 'BR');
  });

  it('null: countryTerm is "país no especificado"', () => {
    const ctx = getCountryEnricherContext(null);
    assert.equal(ctx.countryTerm, 'país no especificado');
  });

  it('null: taxIdLabel is "identificador fiscal"', () => {
    const ctx = getCountryEnricherContext(null);
    assert.equal(ctx.taxIdLabel, 'identificador fiscal');
  });

  it('null: registryLabel is "registro oficial"', () => {
    const ctx = getCountryEnricherContext(null);
    assert.equal(ctx.registryLabel, 'registro oficial');
  });
});
