'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { SendHorizonal } from '@/icons';
import { Button } from '@/components/ui/button';
import { resendSlackInvitation } from '@/modules/access/actions';
import { SLACK_INVITE_OUTCOME_COPY } from '@/modules/access/slack-invitation-message';

interface PreapprovalSlackResendButtonProps {
  preapprovalId: string;
  email: string;
}

/** Vuelve a mandarle por Slack la invitación a quien todavía no ha entrado (dueña 11-11). */
export function PreapprovalSlackResendButton({ preapprovalId, email }: PreapprovalSlackResendButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleResend() {
    setLoading(true);
    const result = await resendSlackInvitation(preapprovalId);
    setLoading(false);
    if (!result.success || !result.slackInvite) {
      toast.error('No pudimos reenviar la invitación', { description: result.error });
      return;
    }
    if (result.slackInvite === 'sent') {
      toast.success(`Invitación reenviada a ${email}`, { description: SLACK_INVITE_OUTCOME_COPY.sent });
    } else {
      toast.warning(`No se reenvió a ${email}`, { description: SLACK_INVITE_OUTCOME_COPY[result.slackInvite] });
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label={`Reenviar invitación por Slack a ${email}`}
      title="Reenviar invitación por Slack"
      disabled={loading}
      onClick={handleResend}
    >
      <SendHorizonal aria-hidden="true" />
    </Button>
  );
}
