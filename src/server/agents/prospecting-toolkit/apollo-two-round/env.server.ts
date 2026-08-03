/**
 * env.server.ts — Único lector de entorno de la modalidad de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 2.
 *
 * Se aísla aquí a propósito: el resto del paquete es puro y su suite corre sin
 * tocar `process.env`. Este archivo no hace más que leer los valores crudos y
 * pasárselos al parser puro; toda la validación (trim, entero, negativos, topes,
 * defaults conservadores) vive en `config.ts` y se testea allí.
 *
 * Server-only. No importar desde componentes de cliente.
 */

import {
  resolveApolloTwoRoundConfig,
  APOLLO_TWO_ROUND_ENV_KEYS,
  type ApolloTwoRoundConfigResolution,
  type ApolloTwoRoundDiscoveryConfig,
} from './config';

/** Resuelve la configuración efectiva desde el entorno. */
export function resolveApolloTwoRoundConfigFromEnv(): ApolloTwoRoundConfigResolution {
  return resolveApolloTwoRoundConfig({
    targetEligibleCompanies: process.env[APOLLO_TWO_ROUND_ENV_KEYS.targetEligibleCompanies],
    maxRounds: process.env[APOLLO_TWO_ROUND_ENV_KEYS.maxRounds],
    maxResultsPerRound: process.env[APOLLO_TWO_ROUND_ENV_KEYS.maxResultsPerRound],
    maxRawResultsPerRun: process.env[APOLLO_TWO_ROUND_ENV_KEYS.maxRawResultsPerRun],
    maxEnrichmentsPerRun: process.env[APOLLO_TWO_ROUND_ENV_KEYS.maxEnrichmentsPerRun],
  });
}

/** Sólo la configuración, para los llamadores que no necesitan el origen. */
export function resolveApolloTwoRoundConfigValues(): ApolloTwoRoundDiscoveryConfig {
  return resolveApolloTwoRoundConfigFromEnv().config;
}

// El diagnóstico sanitizado se construye en el punto de uso con
// `toApolloTwoRoundConfigDiagnostics(resolveApolloTwoRoundConfigFromEnv())`. Un
// tercer envoltorio aquí no tenía ningún consumidor y sólo añadía un nombre más
// para la misma composición.
