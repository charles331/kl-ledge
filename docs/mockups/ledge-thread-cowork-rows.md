# Fil « Cowork » : les lignes hors maquette (#41, 2026-11-27)

**Validé par jde le 2026-11-27** (13:36, ligne de queue qitem-20261127133106), avec une retouche : sur la page d'un sous-agent, la note qui remplace le champ montre le logo plat du fournisseur au lieu de la mascotte. Il complète `ledge-thread-cowork.html` et son complément (`ledge-thread-cowork-complement.md`).

jde a choisi A le 2026-11-27 : avant la fusion, aligner sur le nouveau fil ce que la maquette ne dessinait pas. Cela touche :
- les messages entre agents ;
- les avis automatiques ;
- les lignes OpenRig ;
- les tâches confiées.

Le reste ne change pas : les cartes elles-mêmes, aucun texte nouveau.

La maquette `ledge-thread-cowork-rows.html` est **le vrai code de `feat/thread-cowork`** (747048b3), dans une session d'exemple (Kai), avec la feuille `thread-cowork-rows/rows.css` posée par-dessus. La barre bascule entre **Avant** (tel que c'est codé) et **Après**, sombre ou clair, en session large ou en deux groupes.

Captures : `ledge-thread-cowork-rows-{avant,apres}-{dark,light}.png` (début du fil), `-fin-` (fin du fil), `-etroit-` (deux groupes), `-zoom-` (×2).

## La règle

1. **Pas de marge d'icônes.** L'icône dans la marge à gauche de la colonne (enveloppe, OpenRig, tâche) disparaît. La carte dit déjà ce qu'elle est : sa ligne d'en-tête (« Avis automatique », « Tâche », « Ligne confiée par… », « De … »), sa bordure, son côté. La carte commence au bord de la colonne, comme le texte de l'agent.
2. **L'heure sous la carte**, comme sous les bulles et les textes de l'agent : à gauche pour ce qui arrive (message reçu, avis, ligne OpenRig, tâche), à droite pour un message envoyé par l'agent. La colonne d'heures à droite disparaît.
3. **Rien d'autre ne bouge** :
   - les cartes gardent leur contenu, leurs couleurs et leurs liens (« Ouvrir Nova », « Voir la tâche », « Message brut », « Suivre à côté », « Replier ») ;
   - un message envoyé reste à droite ;
   - un avis garde son filet à gauche.
   L'en-tête « Échange avec Nova · 2 messages » n'avait pas d'heure ; il n'en a toujours pas.

## Pour l'implémentation (dev-front-2)

Tout tient dans `rows.css`. C'est du CSS seul, sur les lignes `.r` de l'ancien rail quand elles sont dans le fil Cowork (`.cw-turn`) : `.message-row`, `.message-head-row`, `.notice-row`, `.rig-row`, `.task-row`, et `.objective-row` (ajoutée à l'implémentation).

**Spécificité** : dans l'app, les règles doivent passer devant `:root[data-skin="atelier"] .ide-pane .r` (0,3,0, et sa variante `@container`). Préfixe-les par `:root[data-skin="atelier"] .ide-pane`. Dans `rows.css`, c'est le préfixe de bascule `:root[data-rows="apres"]` qui les fait passer devant ; sans préfixe, les cartes s'écrasent dans la colonne de 40 px.

Les règles :
- Une seule colonne : `grid-template-columns: minmax(0, 1fr)`, `row-gap: 4px`, `padding: 0`.
- `.n` : caché.
- `.tm` : en deuxième ligne de la grille, 11 px mono, couleur `--at-ink2`, comme `.cw-time`.
  - Il est à gauche (`justify-self: start`), et à droite pour `.message-row.sent`.
  - Un `.tm` vide est caché.
- `.notice-line` s'étire sur la largeur de la colonne.

Hors de `.cw-turn` (un autre écran qui garde le rail), rien ne change. Le repère « nouveau depuis votre visite » (`.unread-marker`) n'est pas concerné.

À vérifier en implémentant, ce que les données d'exemple ne montrent pas :
- une tâche (`<task-notification>`) qui ouvre un échange : `.task-row`, même règle ;
- une ligne OpenRig illisible ;
- un bloc « Messages bruts » de plusieurs paquets (`PacketRawRow`).
Ces trois cas suivent la même règle : pas d'icône dans la marge, heure sous la carte.
