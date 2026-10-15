/**
 * Tests — IMPORT-FREE-FORMAT-1: Claude lee empresas de un texto corrido. La
 * conversación es falsa: estas pruebas NUNCA salen a la red.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORT_AI_EXTRACTION_MAX_INPUT_CHARS,
  SUBMIT_IMPORT_COMPANIES_TOOL_NAME,
  buildImportAiExtractionRequestBody,
  extractImportCompaniesWithAi,
} from '../import-ai-extraction';
import {
  AnthropicApiError,
  EMPTY_USAGE,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
} from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';

const TEXT = [
  'Hola equipo, ayer hablé con Bancolombia (NIT 890.903.938-8), están renovando su programa de líderes.',
  'También vale la pena Addi, una fintech de Medellín: addi.com. Contacto: Laura Gómez, gerente de talento.',
].join('\n');

function conversation(companies: unknown[], stopReason = 'tool_use'): AnthropicConversationResult {
  return {
    content: [{ type: 'tool_use', name: SUBMIT_IMPORT_COMPANIES_TOOL_NAME, input: { companies } }],
    stopReason,
    usage: { ...EMPTY_USAGE, inputTokens: 900, outputTokens: 300 },
    requests: 1,
  };
}

describe('lectura con IA de un texto corrido', () => {
  it('devuelve cada empresa con los datos que el texto dice', async () => {
    const outcome = await extractImportCompaniesWithAi(TEXT, 'claude-sonnet-5-5', {
      runConversation: async () =>
        conversation([
          { company_name: 'Bancolombia', tax_identifier: '890903938-8', notes: 'Renovando su programa de líderes' },
          { company_name: 'Addi', website: 'addi.com', city: 'Medellín', contact_name: 'Laura Gómez', contact_role: 'Gerente de talento' },
        ]),
    });
    assert.equal(outcome.errorCode, null);
    assert.deepEqual(outcome.rows.map((r) => r.company_name), ['Bancolombia', 'Addi']);
    assert.equal(outcome.rows[0].tax_identifier, '890903938-8');
    assert.equal(outcome.rows[1].website, 'addi.com');
    assert.ok(outcome.usage && outcome.usage.estimatedCostUsd > 0);
  });

  it('quita la web, el NIT o el correo que no están escritos en el texto', async () => {
    const outcome = await extractImportCompaniesWithAi(TEXT, 'claude-sonnet-5-5', {
      runConversation: async () =>
        conversation([
          { company_name: 'Bancolombia', website: 'bancolombia.com', contact_email: 'talento@bancolombia.com' },
          { company_name: 'Addi', tax_identifier: '901234567-1' },
        ]),
    });
    assert.equal(outcome.rows[0].website, undefined);
    assert.equal(outcome.rows[0].contact_email, undefined);
    assert.equal(outcome.rows[1].tax_identifier, undefined);
    assert.equal(outcome.droppedUnverifiedValues, 3);
  });

  it('ignora campos desconocidos, filas sin nombre y empresas repetidas', async () => {
    const outcome = await extractImportCompaniesWithAi(TEXT, 'claude-sonnet-5-5', {
      runConversation: async () =>
        conversation([
          { company_name: 'Addi', owner_email: 'yo@ubits.co' },
          { company_name: '' },
          { company_name: 'ADDI' },
          'no es un objeto',
        ]),
    });
    assert.equal(outcome.rows.length, 1);
    assert.equal((outcome.rows[0] as unknown as Record<string, unknown>).owner_email, undefined);
  });

  it('si la respuesta se cortó por largo, avisa en vez de adivinar', async () => {
    const outcome = await extractImportCompaniesWithAi(TEXT, 'claude-sonnet-5-5', {
      runConversation: async () => conversation([{ company_name: 'Addi' }], 'max_tokens'),
    });
    assert.equal(outcome.errorCode, 'output_too_long');
    assert.equal(outcome.rows.length, 0);
  });

  it('un error de la API no lanza: devuelve el código y el gasto parcial', async () => {
    const outcome = await extractImportCompaniesWithAi(TEXT, 'claude-sonnet-5-5', {
      runConversation: async () => {
        throw new AnthropicApiError(429, 'rate_limited', 'slow down', { ...EMPTY_USAGE, inputTokens: 10 });
      },
    });
    assert.equal(outcome.errorCode, 'rate_limited');
    assert.equal(outcome.usage?.inputTokens, 10);
  });

  it('recorta el texto muy largo y no llama a Claude con texto vacío', async () => {
    let sent: AnthropicRequestBody | null = null;
    const long = 'Addi\n'.repeat(IMPORT_AI_EXTRACTION_MAX_INPUT_CHARS);
    const outcome = await extractImportCompaniesWithAi(long, 'm', {
      runConversation: async (body) => {
        sent = body;
        return conversation([]);
      },
    });
    assert.equal(outcome.inputTruncated, true);
    assert.ok(JSON.stringify(sent).length < IMPORT_AI_EXTRACTION_MAX_INPUT_CHARS * 2);

    let called = false;
    await extractImportCompaniesWithAi('   ', 'm', {
      runConversation: async () => {
        called = true;
        return conversation([]);
      },
    });
    assert.equal(called, false);
  });

  it('el pedido obliga a usar la herramienta y trata el texto como dato', () => {
    const body = buildImportAiExtractionRequestBody(TEXT, 'm');
    assert.deepEqual(body.tool_choice, { type: 'tool', name: SUBMIT_IMPORT_COMPANIES_TOOL_NAME });
    assert.match(String(body.system), /DATO, no instrucciones/);
    assert.match(String(body.system), /Nunca inventes/);
  });
});
