import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeProviderFailure,
  extractProviderDetail,
  httpStatusFromCode,
  providerFailureLogMessage,
} from '../provider-failure';

const CLAUDE_NO_CREDIT_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
  },
});

test('Claude sin saldo (400 con «credit balance») se lee como sin créditos', () => {
  const failure = describeProviderFailure({ providerKey: 'anthropic', errorCode: 'http_400', rawMessage: CLAUDE_NO_CREDIT_BODY });
  assert.equal(failure.kind, 'out_of_credits');
  assert.equal(failure.code, 'credits_exhausted');
  assert.equal(failure.providerName, 'Claude');
  assert.match(failure.message, /Claude se quedó sin créditos/);
  assert.match(failure.detail ?? '', /credit balance is too low/);
  assert.match(providerFailureLogMessage(failure), /Detalle: Your credit balance/);
});

test('un 400 de Claude sin texto de saldo NO se confunde con créditos', () => {
  const failure = describeProviderFailure({
    providerKey: 'anthropic',
    errorCode: 'http_400',
    rawMessage: '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: field required"}}',
  });
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.code, 'http_400');
  assert.equal(failure.detail, 'max_tokens: field required');
});

test('el código ya normalizado basta aunque no haya texto', () => {
  assert.equal(describeProviderFailure({ providerKey: 'anthropic', errorCode: 'credits_exhausted' }).kind, 'out_of_credits');
});

test('Tavily 432/433 = sin créditos; 401 = llave rechazada', () => {
  assert.equal(describeProviderFailure({ providerKey: 'tavily', errorCode: 'tavily_http_432' }).kind, 'out_of_credits');
  assert.equal(describeProviderFailure({ providerKey: 'tavily', errorCode: 'tavily_http_433' }).kind, 'out_of_credits');
  const auth = describeProviderFailure({ providerKey: 'tavily', errorCode: 'tavily_http_401' });
  assert.equal(auth.kind, 'invalid_credentials');
  assert.match(auth.message, /Tavily rechazó la llave/);
});

test('Apollo y Lusha: 402 o texto de créditos = sin créditos', () => {
  assert.equal(describeProviderFailure({ providerKey: 'lusha', httpStatus: 402 }).kind, 'out_of_credits');
  assert.equal(
    describeProviderFailure({ providerKey: 'apollo', errorCode: 'apollo_http_422', rawMessage: 'Insufficient credits to complete this request' }).kind,
    'out_of_credits',
  );
  assert.equal(
    describeProviderFailure({ providerKey: 'lusha', httpStatus: 403, rawMessage: 'You have reached your plan limit' }).kind,
    'out_of_credits',
  );
  assert.equal(describeProviderFailure({ providerKey: 'lusha', httpStatus: 403, rawMessage: 'Forbidden' }).kind, 'invalid_credentials');
});

test('429, 5xx/529 y timeout se dicen claro', () => {
  assert.equal(describeProviderFailure({ providerKey: 'anthropic', errorCode: 'rate_limited' }).kind, 'rate_limited');
  assert.equal(describeProviderFailure({ providerKey: 'anthropic', errorCode: 'http_529' }).kind, 'provider_unavailable');
  assert.equal(describeProviderFailure({ providerKey: 'apollo', errorCode: 'timeout' }).kind, 'timeout');
  assert.match(describeProviderFailure({ providerKey: 'apollo', errorCode: 'timeout' }).message, /Apollo tardó demasiado/);
});

test('proveedor desconocido: nombre legible y código original', () => {
  const failure = describeProviderFailure({ providerKey: 'sunat_ruc', errorCode: 'weird_thing' });
  assert.equal(failure.providerName, 'Sunat');
  assert.equal(failure.code, 'weird_thing');
  assert.match(failure.message, /Sunat devolvió un error \(weird_thing\)/);
});

test('httpStatusFromCode y extractProviderDetail', () => {
  assert.equal(httpStatusFromCode('http_400'), 400);
  assert.equal(httpStatusFromCode('tavily_http_432'), 432);
  assert.equal(httpStatusFromCode('timeout'), null);
  assert.equal(extractProviderDetail('{"message":"Plan limit"}'), 'Plan limit');
  assert.equal(extractProviderDetail('{"errors":[{"detail":"No credits"}]}'), 'No credits');
  assert.equal(extractProviderDetail('{"error":"cortado'), '{"error":"cortado');
  assert.equal(extractProviderDetail(''), null);
});

test('providerFailureNotice: prioriza sin créditos y calla si no hubo falla del proveedor', async () => {
  const { providerFailureNotice } = await import('../provider-failure');
  assert.equal(providerFailureNotice([null, 'http_400']), null);
  assert.match(providerFailureNotice(['timeout', 'credits_exhausted']) ?? '', /Claude se quedó sin créditos/);
  assert.match(providerFailureNotice(['rate_limited']) ?? '', /demasiadas consultas/);
});

test('registro de uso: un error queda con su frase y sin créditos con su código', async () => {
  const { providerFailureColumns } = await import('../logging');
  const credit = providerFailureColumns({
    provider_key: 'anthropic',
    status: 'error',
    error_code: 'http_400',
    error_message: CLAUDE_NO_CREDIT_BODY,
  });
  assert.equal(credit.error_code, 'credits_exhausted');
  assert.match(credit.error_message ?? '', /^Claude se quedó sin créditos.*Detalle: Your credit balance/);

  const noMessage = providerFailureColumns({ provider_key: 'anthropic', status: 'error', error_code: 'credits_exhausted' });
  assert.match(noMessage.error_message ?? '', /Claude se quedó sin créditos/);

  const other = providerFailureColumns({ provider_key: 'apollo', status: 'error', error_code: 'HTTP_422', error_message: 'Bad filter' });
  assert.equal(other.error_code, 'HTTP_422');
  assert.match(other.error_message ?? '', /Apollo devolvió un error \(HTTP_422\)\. Detalle: Bad filter/);

  const ok = providerFailureColumns({ provider_key: 'apollo', status: 'success', error_code: undefined, error_message: undefined });
  assert.deepEqual(ok, { error_code: null, error_message: null });
});
