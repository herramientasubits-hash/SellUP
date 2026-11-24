/**
 * Prod 24-11 (EC, 732bc372) — AYMESA S.A. es cliente en HubSpot y el buscador gratuito
 * la dejó en «Por revisar» (también 3 de Colombia desde el 19-11). El escritor calculaba
 * `duplicate` para los clientes pero insertaba siempre `needs_review`. Guarda estática.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const WRITER = readFileSync('src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts', 'utf8');

describe('buscador gratuito — un cliente de HubSpot no entra a «Por revisar»', () => {
  it('un cliente se resuelve como `duplicate`', () => {
    assert.match(
      WRITER,
      /function resolveCandidateStatus\(hubspotMatchStatus: HubspotMatchStatus\): string \{\s*if \(hubspotMatchStatus === 'exact_match_customer'\) return 'duplicate';/,
    );
  });

  it('la fila se inserta con ese estado, no con `needs_review` forzado', () => {
    assert.match(WRITER, /status: p\.candidateStatus,/);
    assert.doesNotMatch(WRITER, /status: 'needs_review', \/\/ Forced to review state/);
  });
});
