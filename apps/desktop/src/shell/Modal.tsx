import { createContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';

/** A place beside the dialog's title a form can fill (« Nouvelle session · Pim ✎ », docs/mockups/ledge-sidebar-names.html card 4). */
export const ModalTitleSlot = createContext<HTMLElement | null>(null);

/** The mockup's dialog: a blurred backdrop that closes on its own click, a titled box with « Fermer ».
 *  Focus moves into the box unless a field already took it, and goes back where it was on close. */
export function Modal({ title, onClose, wide = false, className, role = 'dialog', describedBy, icon, children }: { title: string; onClose: () => void; wide?: boolean; className?: string; role?: 'dialog' | 'alertdialog'; describedBy?: string; /** A line icon before the title (« Signaler »'s flag, issue #9). */ icon?: readonly string[]; children: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Captured during render: a child's autoFocus runs in the layout phase, before any effect.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus();
    return () => { if (before?.isConnected) before.focus(); };
  }, [before]);
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={box} className={[wide ? 'modal composer-modal' : 'modal', className].filter(Boolean).join(' ')} role={role} aria-modal="true" aria-labelledby={id} aria-describedby={describedBy} tabIndex={-1}>
        <div className="modal-title">
          <h2 id={id}>{icon && <Icon d={icon} size={15} />}{title}</h2>
          <span className="modal-title-slot" ref={setSlot} />
          <Button variant="ghost" size="icon" aria-label={t.close} onClick={onClose}><Icon d={ICONS.close.d} /></Button>
        </div>
        <ModalTitleSlot.Provider value={slot}>{children}</ModalTitleSlot.Provider>
      </section>
    </div>
  );
}
