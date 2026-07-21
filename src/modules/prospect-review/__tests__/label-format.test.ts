// Q3F-5AZ.2C — Review queue label helpers (pure).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatSourceLabel, formatClassificationLabel } from '../label-format';

describe('formatSourceLabel', () => {
  it('maps web_ai to a friendly label', () => {
    assert.equal(formatSourceLabel('web_ai'), 'Fuente web / IA');
  });

  it('passes through unknown values', () => {
    assert.equal(formatSourceLabel('apollo'), 'apollo');
  });

  it('renders an em dash for null/empty', () => {
    assert.equal(formatSourceLabel(null), '—');
    assert.equal(formatSourceLabel(''), '—');
    assert.equal(formatSourceLabel(undefined), '—');
  });
});

describe('formatClassificationLabel', () => {
  it('maps derived_status to a friendly label', () => {
    assert.equal(formatClassificationLabel('derived_status'), 'Clasificación automática');
  });

  it('passes through unknown values', () => {
    assert.equal(formatClassificationLabel('official_source'), 'official_source');
  });

  it('renders an em dash for null/empty', () => {
    assert.equal(formatClassificationLabel(null), '—');
    assert.equal(formatClassificationLabel(''), '—');
    assert.equal(formatClassificationLabel(undefined), '—');
  });
});
