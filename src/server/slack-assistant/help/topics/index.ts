// Guía de uso de SellUp: todas las fichas (una por tema), escritas desde el código.
import type { HelpTopic } from '../types';
import { EMPRESAS_TOPICS } from './empresas';
import { CONTACTOS_RUMBO_TOPICS } from './contactos-rumbo';
import { ADMIN_TOPICS } from './admin';

export const HELP_TOPICS: readonly HelpTopic[] = [...EMPRESAS_TOPICS, ...CONTACTOS_RUMBO_TOPICS, ...ADMIN_TOPICS];
