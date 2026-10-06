/**
 * GET /api/v1/conversions — offered conversions of this deployment (public, cacheable): pair,
 * status, processing modes and limitations.
 */
import { siteRegistry } from '@/server/site.ts';

export const dynamic = 'force-static';

export function GET(): Response {
  const conversions = siteRegistry()
    .offeredConversions()
    .map((conversion) => ({
      from: conversion.from,
      to: conversion.to,
      status: conversion.status,
      modes: conversion.modes,
      indexable: conversion.indexable,
      limitations: conversion.limitations,
    }));
  return Response.json({ conversions });
}
