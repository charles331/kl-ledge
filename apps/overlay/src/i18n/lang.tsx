import { createI18n } from '@ledge/ui/i18n/lang';
import { LANGS, MESSAGES, type Lang, type Messages } from './messages';

/** The language is Desktop's choice (`desktop.lang`): the island shares its origin and reads it. It draws no mascot. */
const i18n = createI18n<Lang, Messages>({ langs: LANGS, messages: MESSAGES, fallback: 'fr', prefix: 'desktop' });
export const { loadLang, saveLang, setFallbackLang, LangProvider, useI18n, messagesFor } = i18n;
export type { Lang, Messages };
