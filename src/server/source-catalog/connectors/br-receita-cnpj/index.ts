/**
 * BR Receita CNPJ connector — local/sample parser (BR-SOURCE-2).
 *
 * Pure, offline, synthetic-only. No dataset download/import, no Supabase,
 * no runtime enrichment, no providers, no HubSpot/Slack. See individual
 * modules for the data-contract references.
 */

export * from './br-cnpj';
export * from './br-receita-cnpj-types';
export * from './br-receita-cnpj-snapshot-builder';
export * from './br-receita-cnpj-fixtures';
export * from './br-receita-cnpj-file-reader';
export * from './br-receita-cnpj-manifest';
export * from './br-receita-cnpj-manifest-validator';
