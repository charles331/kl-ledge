// The « past exchanges » setting (issue #41, « Still to settle »), drawn in Settings › General under « Vue par défaut d'une
// session »: the build adds it to Desktop's General.tsx. It drives the same choice as the bar above the window.
import { useSyncExternalStore, type JSX } from 'react';
import { Row, Segmented } from '../../../apps/desktop/src/settings/controls';
import { getPast, setPast, subscribeVariant, type Past } from './variant';

const LABEL = 'Échanges passés';

export function PastRow({ saved }: { saved(text: string): void }): JSX.Element {
  const past = useSyncExternalStore(subscribeVariant, getPast, getPast);
  return (
    <Row label={LABEL} hint="Dans le fil d’une session, un échange terminé garde sa demande et sa réponse en vue ; le travail entre les deux se replie sous « Travail ». Le dernier échange reste ouvert.">
      {describedBy => (
        <Segmented<Past> label={LABEL} value={past} describedBy={describedBy}
          onChange={v => { setPast(v); saved(v === 'folded' ? 'Échanges passés : repliés' : 'Échanges passés : ouverts'); }}
          options={[{ value: 'folded', label: 'Repliés' }, { value: 'open', label: 'Ouverts' }]} />
      )}
    </Row>
  );
}
