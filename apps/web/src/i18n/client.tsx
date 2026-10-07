'use client';

/**
 * Translations for client components. The server layout passes only the sections client
 * components use, so dictionaries are not bundled into client JavaScript.
 */
import { createContext, use, type ReactNode } from 'react';

import type { Locale } from './config.ts';
import type { Messages } from './messages.ts';

export type ClientMessages = Pick<Messages, 'converter' | 'status' | 'mode' | 'error' | 'quality'>;

interface I18nValue {
  locale: Locale;
  t: ClientMessages;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: ClientMessages;
  children: ReactNode;
}) {
  return <I18nContext value={{ locale, t: messages }}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  const value = use(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
