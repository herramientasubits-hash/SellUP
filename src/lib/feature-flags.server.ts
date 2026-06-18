// Server-only: this module reads process.env and must never be imported from
// client components. The values are resolved at request time by server
// components and server actions, then sent to the client as plain booleans.

/**
 * Returns true when ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION is "true"
 * (case-insensitive, leading/trailing whitespace ignored).
 */
export function isProspectChatWizardExecutionEnabled(): boolean {
  return (
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION?.trim().toLowerCase() ===
    'true'
  );
}
