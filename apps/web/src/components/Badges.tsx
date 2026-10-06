import type { ProcessingMode, Status } from '@vanillate/core';

import type { Messages } from '@/i18n/messages.ts';

/** Status is always shown in words (never color alone), so Experimental can't pass for Stable. */
export function StatusBadge({ status, t }: { status: Status; t: Pick<Messages, 'status'> }) {
  return <span className={`badge badge--${status}`}>{t.status[status]}</span>;
}

export function ModeBadge({ mode, t }: { mode: ProcessingMode; t: Pick<Messages, 'mode'> }) {
  return <span className="badge badge--mode">{t.mode[mode]}</span>;
}
