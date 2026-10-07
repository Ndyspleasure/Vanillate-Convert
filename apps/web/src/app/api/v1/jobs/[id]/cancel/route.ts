/** POST /api/v1/jobs/{id}/cancel — cancel a job and delete its files. */
import { VanillateError } from '@vanillate/core';

import { bearerToken, handle, json, requestLocale, requireServices } from '@/server/api.ts';
import { JOB_ID } from '@/server/ids.ts';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/v1/jobs/[id]/cancel'>,
): Promise<Response> {
  return handle(request, async () => {
    const { id } = await ctx.params;
    if (!JOB_ID.test(id)) throw new VanillateError('job-not-found');
    const { jobs } = requireServices();
    return json({ job: await jobs.cancelJob(id, bearerToken(request), requestLocale(request)) });
  });
}
