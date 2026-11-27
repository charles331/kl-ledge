import type { CSSProperties, JSX } from 'react';

/** How a session is called on screen (docs/mockups/ledge-sidebar-names.html, card 2): its nickname, then its name in brackets in the
 *  muted colour, « KB Projet 1 (Otto) »; its name alone when it has none. Each app styles the bracket through `nameClassName` (a
 *  class of its own sheet) or `nameStyle` (the island, styled inline). */
export function SessionName({ session, nameClassName = 'sn-name', nameStyle }: {
  session: { name: string; label?: string | undefined }; nameClassName?: string; nameStyle?: CSSProperties;
}): JSX.Element {
  if (!session.label) return <>{session.name}</>;
  return <>{session.label}<span className={nameClassName} {...(nameStyle ? { style: nameStyle } : {})}> ({session.name})</span></>;
}
