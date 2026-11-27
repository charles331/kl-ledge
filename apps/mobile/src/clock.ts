import { locale } from './copy';

/** A moment as the phone says it, « 14:02 » in the app's language; '' when there is none. */
export const clock = (iso: string | null): string => iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
