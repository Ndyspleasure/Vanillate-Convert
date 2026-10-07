/**
 * GET /api/v1/jobs/{id} — job status, progress and (when completed) signed download links.
 * Requires `Authorization: Bearer <token>`.
 */
import { VanillateError } from '@vanillate/core';

import { bearerToken, handle, json, requestLocale, requireServices } from '@/server/api.ts';
import { JOB_ID } from '@/server/ids.ts';

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/v1/jobs/[id]'>,
): Promise<Response> {
  return handle(request, async () => {
    const { id } = await ctx.params;
    if (!JOB_ID.test(id)) throw new VanillateError('job-not-found');
    const { jobs } = requireServices();
    const job = await jobs.getJob(id, bearerToken(request), requestLocale(request));
    return json({ job });
  });
}
