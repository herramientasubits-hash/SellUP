// ============================================================
// Asistente de Slack — firma de Slack (puro).
// Cada evento llega firmado con el Signing Secret de la app: HMAC-SHA256 de
// `v0:<timestamp>:<cuerpo>`. Sin firma válida, o con más de 5 minutos de
// antigüedad (repetición), no se atiende.
// https://api.slack.com/authentication/verifying-requests-from-slack
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

export interface SlackSignatureInput {
  signingSecret: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  nowSeconds: number;
}

export function computeSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

/** `true` sólo si la firma es de Slack y el mensaje es reciente. */
export function isValidSlackSignature(input: SlackSignatureInput): boolean {
  const secret = input.signingSecret?.trim();
  const timestamp = input.timestamp?.trim();
  const signature = input.signature?.trim();
  if (!secret || !timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(input.nowSeconds - Number(timestamp)) > SLACK_SIGNATURE_MAX_AGE_SECONDS) return false;

  const expected = Buffer.from(computeSlackSignature(secret, timestamp, input.rawBody));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
