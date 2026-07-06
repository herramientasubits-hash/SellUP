/**
 * Tests — LushaCredentialDiagnosticCard helpers (Agente 2A · 17B.4Q)
 *
 * Verifica funciones puras del componente de diagnóstico Lusha.
 * Sin React rendering. Sin red. Sin llamadas Lusha.
 *
 * 1.  stageColor: resolved_from_vault → 'green'
 * 2.  stageColor: resolved_from_env_fallback → 'amber'
 * 3.  stageColor: env_check → 'red'
 * 4.  stageColor: admin_client → 'red'
 * 5.  stageColor: vault_rpc → 'red'
 * 6.  stageColor: secret_missing → 'red'
 * 7.  stageColor: secret_empty → 'red'
 * 8.  stageColor: failed → 'red'
 * 9.  stageLabel: resolved_from_vault contiene 'Supabase Vault'
 * 10. stageLabel: resolved_from_env_fallback contiene 'variable de entorno'
 * 11. stageLabel: env_check contiene 'Variables de entorno'
 * 12. stageLabel: admin_client contiene 'cliente admin'
 * 13. stageLabel: vault_rpc contiene 'get_vault_secret_decrypted'
 * 14. stageLabel: secret_missing contiene 'Vault'
 * 15. stageLabel: secret_empty contiene 'vacío'
 * 16. GUARDRAIL: resolved_from_vault label no contiene ningún fake secret
 * 17. GUARDRAIL: resolved_from_vault label no contiene fake service role key
 * 18. Disclaimer text contiene 'no consume créditos'
 * 19. Wizard condition: solo monta card cuando provider=lusha (condición booleana)
 * 20. Wizard condition: NO monta card cuando provider=apollo
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  stageColor,
  stageLabel,
  LUSHA_DIAG_DISCLAIMER,
} from '../lusha-credential-diagnostic-card';

// ── Fake secrets (never real values) ──────────────────────────────────────────

const FAKE_SECRET = 'sk_lusha_SUPERSECRET_DO_NOT_EXPOSE';
const FAKE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiJ9.FAKE_SERVICE_ROLE.SIGNATURE';

// ── stageColor ─────────────────────────────────────────────────────────────────

describe('stageColor', () => {
  it('1. resolved_from_vault → green', () => {
    assert.equal(stageColor('resolved_from_vault'), 'green');
  });

  it('2. resolved_from_env_fallback → amber', () => {
    assert.equal(stageColor('resolved_from_env_fallback'), 'amber');
  });

  it('3. env_check → red', () => {
    assert.equal(stageColor('env_check'), 'red');
  });

  it('4. admin_client → red', () => {
    assert.equal(stageColor('admin_client'), 'red');
  });

  it('5. vault_rpc → red', () => {
    assert.equal(stageColor('vault_rpc'), 'red');
  });

  it('6. secret_missing → red', () => {
    assert.equal(stageColor('secret_missing'), 'red');
  });

  it('7. secret_empty → red', () => {
    assert.equal(stageColor('secret_empty'), 'red');
  });

  it('8. failed → red', () => {
    assert.equal(stageColor('failed'), 'red');
  });
});

// ── stageLabel ─────────────────────────────────────────────────────────────────

describe('stageLabel', () => {
  it('9. resolved_from_vault mentions Supabase Vault', () => {
    assert.ok(stageLabel('resolved_from_vault').includes('Supabase Vault'));
  });

  it('10. resolved_from_env_fallback mentions variable de entorno', () => {
    assert.ok(stageLabel('resolved_from_env_fallback').includes('variable de entorno'));
  });

  it('11. env_check mentions Variables de entorno', () => {
    assert.ok(stageLabel('env_check').toLowerCase().includes('variables de entorno'));
  });

  it('12. admin_client mentions cliente admin', () => {
    assert.ok(stageLabel('admin_client').toLowerCase().includes('cliente admin'));
  });

  it('13. vault_rpc mentions get_vault_secret_decrypted', () => {
    assert.ok(stageLabel('vault_rpc').includes('get_vault_secret_decrypted'));
  });

  it('14. secret_missing mentions Vault', () => {
    assert.ok(stageLabel('secret_missing').includes('Vault'));
  });

  it('15. secret_empty mentions vacío', () => {
    assert.ok(stageLabel('secret_empty').includes('vacío'));
  });
});

// ── Guardrails: labels never leak secrets ──────────────────────────────────────

describe('stageLabel secret guardrails', () => {
  const allLabels = (
    [
      'env_check',
      'admin_client',
      'vault_rpc',
      'secret_missing',
      'secret_empty',
      'resolved_from_vault',
      'resolved_from_env_fallback',
      'failed',
    ] as const
  ).map(stageLabel);

  it('16. no stage label contains fake secret value', () => {
    for (const label of allLabels) {
      assert.equal(
        label.includes(FAKE_SECRET),
        false,
        `Stage label leaked fake secret: "${label}"`,
      );
    }
  });

  it('17. no stage label contains fake service role key', () => {
    for (const label of allLabels) {
      assert.equal(
        label.includes(FAKE_SERVICE_ROLE),
        false,
        `Stage label leaked fake service role: "${label}"`,
      );
    }
  });
});

// ── Disclaimer ─────────────────────────────────────────────────────────────────

describe('LUSHA_DIAG_DISCLAIMER', () => {
  it('18. disclaimer confirms no credits are consumed', () => {
    assert.ok(LUSHA_DIAG_DISCLAIMER.includes('no consume créditos'));
  });
});

// ── Wizard mount condition (pure boolean logic) ────────────────────────────────

describe('wizard mount condition', () => {
  function shouldMountDiagCard(lushaEnabled: boolean, selectedProvider: string): boolean {
    return lushaEnabled && selectedProvider === 'lusha';
  }

  it('19. mounts card when lushaEnabled=true and provider=lusha', () => {
    assert.equal(shouldMountDiagCard(true, 'lusha'), true);
  });

  it('20. does NOT mount card when provider=apollo', () => {
    assert.equal(shouldMountDiagCard(true, 'apollo'), false);
  });

  it('does NOT mount card when lushaEnabled=false', () => {
    assert.equal(shouldMountDiagCard(false, 'lusha'), false);
  });
});
