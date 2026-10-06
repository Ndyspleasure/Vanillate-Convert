/**
 * POST /api/v1/jobs — create a server job. Returns the job, its access token (shown once)
 * and one signed upload request per file.
 */
import { VanillateError } from '@vanillate/core';
import { z } from 'zod';

import { clientKey, handle, json, readJson, requestLocale, requireServices } from '@/server/api.ts';

const option = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);

const createJobSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('conversion'),
      from: z.string().min(1).max(32),
      to: z.string().min(1).max(32),
    }),
    z.strictObject({ kind: z.literal('tool'), toolId: z.string().min(1).max(64) }),
  ]),
  options: z.record(z.string().max(64), option).optional(),
  files: z
    .array(
      z.strictObject({
        name: z.string().max(1000),
        size: z.number().int().nonnegative(),
        format: z.string().min(1).max(32),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request): Promise<Response> {
  return handle(request, async () => {
    const { jobs } = requireServices();
    const parsed = createJobSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new VanillateError('bad-request', { detail: parsed.error.message.slice(0, 500) });
    }
    const result = await jobs.createJob(
      { ...parsed.data, clientKey: await clientKey(request) },
      requestLocale(request),
    );
    return json(result, 201);
  });
}
