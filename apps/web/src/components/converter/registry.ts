/**
 * The registry in the browser: compiled from the same catalog as the server, with the same
 * deployment environment, so the widget offers exactly what the pages describe.
 */
import { getRegistry, type Registry } from '@vanillate/core';

export function clientRegistry(serverProcessing: boolean): Registry {
  return getRegistry(serverProcessing ? {} : { disabledModes: ['server'] });
}
