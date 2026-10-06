/**
 * Translation dictionaries. All UI text lives in `messages/<locale>.json`; components never
 * hard-code text. Adding a language means adding a dictionary (a test checks key parity).
 */
import type { Locale } from './config.ts';
import en from './messages/en.json';
import id from './messages/id.json';

export type Messages = typeof en;

const DICTIONARIES: Record<Locale, Messages> = { en, id };

export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale];
}

export { format, type Vars } from './format.ts';
