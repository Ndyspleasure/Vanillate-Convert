/**
 * POST /api/v1/jobs/{id}/inputs/{inputId}/complete — the client finished uploading a file.
 * The server verifies the stored size and content before the job is queued.
 */
import { VanillateError } from '@vanillate/core';

import { bearerToken, handle, json, requestLocale, requireServices } from '@/server/api.ts';
import { INPUT_ID, JOB_ID } from '@/server/ids.ts';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/jobs/[id]/inputs/[inputId]/complete'>,
): Promise<Response> {
  return handle(request, async () => {
    const { id, inputId } = await ctx.params;
    if (!JOB_ID.test(id)) throw new VanillateError('job-not-found');
    if (!INPUT_ID.test(inputId)) throw new VanillateError('bad-request', { detail: 'input id' });
    const { jobs } = requireServices();
    const job = await jobs.completeUpload(
      id,
      bearerToken(request),
      inputId,
      requestLocale(request),
    );
    return json({ job });
  });
}
