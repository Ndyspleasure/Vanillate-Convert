import Link from 'next/link';

import { paths } from '@vanillate/core';

import type { Locale } from '@/i18n/config.ts';
import type { Messages } from '@/i18n/messages.ts';

export function Footer({ locale, t }: { locale: Locale; t: Messages }) {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <span className="muted">{t.footer.rights}</span>
        <nav aria-label={t.footer.rights}>
          <Link href={paths.convertIndex(locale)}>{t.footer.conversions}</Link>
          <Link href={paths.formats(locale)}>{t.footer.formats}</Link>
          <Link href={paths.tools(locale)}>{t.footer.tools}</Link>
          <Link href={paths.privacy(locale)}>{t.footer.privacy}</Link>
          <Link href={paths.about(locale)}>{t.footer.about}</Link>
        </nav>
      </div>
    </footer>
  );
}
