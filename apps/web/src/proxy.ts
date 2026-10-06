/**
 * Locale routing: every page lives under `/<locale>/…`. Requests without a locale prefix are
 * redirected to the visitor's saved language (cookie), else their browser language, else
 * English — straight to the localized URL (`/convert/jpg-to-png` → `/id/convert/jpg-ke-png`).
 * API routes, Next.js assets and files with an extension are not touched.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isLocale, LOCALE_COOKIE, localizePath, negotiateLocale } from './i18n/config.ts';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isLocale(pathname.split('/')[1])) return NextResponse.next();
  const locale = negotiateLocale(
    request.headers.get('accept-language'),
    request.cookies.get(LOCALE_COOKIE)?.value,
  );
  const url = request.nextUrl.clone();
  url.pathname = localizePath(pathname, locale);
  const response = NextResponse.redirect(url, 307);
  response.headers.set('Vary', 'Accept-Language, Cookie');
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)'],
};
