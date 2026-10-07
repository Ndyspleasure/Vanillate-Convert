/**
 * GET /api/v1/health — liveness and server processing capacity (pools and engines on live
 * workers). Used by the UI and uptime monitoring.
 */
import { handle, json } from '@/server/api.ts';
import { getServices } from '@/server/services.ts';

export async function GET(request: Request): Promise<Response> {
  return handle(request, async () => {
    const services = getServices();
    const server = services ? await services.jobs.liveCapabilities() : null;
    return json({ status: 'ok', serverProcessing: server });
  });
}
