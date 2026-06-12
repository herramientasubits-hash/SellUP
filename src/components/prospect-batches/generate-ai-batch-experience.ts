import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

// ── Experience contract ────────────────────────────────────────────────────────
// Single source of truth for which experience renders inside the drawer.
// Resolved server-side in page.tsx and passed as a serializable prop.

export type GenerateProspectsExperience =
  | 'legacy'
  | 'exploratory_form_v2'
  | 'chat_wizard';

// ── Precedence (matches AGENTS.md / spec 16AB.35.2) ──────────────────────────
// ENABLE_PROSPECT_CHAT_WIZARD=true → chat_wizard
// flag off + ENABLE_EXPLORATORY_SEARCH_FORM_V2=true → exploratory_form_v2
// both off → legacy
// Catalog must load successfully; failure falls through to the next option.

export function resolveGenerateProspectsExperience(
  chatWizardEnabled: boolean,
  v2Enabled: boolean,
  catalog: ActiveIndustryCatalog | null,
): GenerateProspectsExperience {
  if (chatWizardEnabled && catalog !== null) return 'chat_wizard';
  if (v2Enabled && catalog !== null) return 'exploratory_form_v2';
  return 'legacy';
}
