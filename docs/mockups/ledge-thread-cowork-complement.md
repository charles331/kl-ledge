# Fil « Cowork » : complément (issues #41 et #39, 2026-11-27)

Ce document complète la maquette `ledge-thread-cowork.html`, que je reconstruis avec `node docs/mockups/thread-cowork/build.mjs`.
Les captures `ledge-thread-cowork-cplt-*.png` montrent chaque état en clair et en sombre ; `ida-voix` montre le texte dicté dans
le champ.
Tout ce document est **à valider par jde**. Ce qu'il a déjà tranché ne se rediscute pas ici.

**Registre** : je retiens le vouvoiement, comme le fil et le champ de réponse du Desktop d'aujourd'hui (« Vous », « attend
votre accord », « Répondez librement… ») et comme la maquette. L'île est la seule à tutoyer.

## 1. Le réglage « Échanges passés »

Capture : `cplt-reglages-*`.

Réglages › Général, juste sous « Vue par défaut d'une session ». Ces deux réglages décident de la façon dont une session se
présente.

- Libellé : **Échanges passés** · *Past exchanges*
- Légende : « Dans le fil d'une session, un échange terminé garde sa demande et sa réponse en vue ; le travail entre les deux
  se replie sous « Travail ». Le dernier échange reste ouvert. »
  · *In a session's thread, a finished exchange keeps its request and its answer in sight; the work between them folds under
  “Work”. The last exchange stays open.*
- Choix : **Repliés** (par défaut) · **Ouverts** · *Folded · Open*
- Message après enregistrement : « Échanges passés : repliés » / « … : ouverts » · *Past exchanges: folded / open*

Choix S1, la place du réglage : **A (recommandé, dessiné)** Réglages › Général, sous « Vue par défaut d'une session ».
**B** Réglages › Espace de travail, dans une nouvelle carte « Fil des sessions » à côté de « Terminaux ».

## 2. La dictée (#41 et #39, un seul mécanisme)

Elle vit dans le champ de réponse des sessions seulement (choix A de jde, 10:06). La technique est fixée par dev-back.
Captures : `ida-voix-*`, `cplt-zoom-voix-*`.

**Ce qui change par rapport à la maquette de direction.** Le bouton ouvre la saisie vocale de Windows (Win+H). Windows
affiche alors sa propre fenêtre d'écoute et ses propres messages d'erreur. Ledge ne sait ni si elle écoute, ni si elle est
désactivée. J'ai donc retiré de la maquette l'état « dictée en cours » que Ledge dessinait : le bouton corail avec une onde,
et le champ qui disait « Je vous écoute… ».

Les réponses à ce que #39 demandait de montrer :
- **Le bouton** : à gauche du bouton rond, dans la rangée du bas du champ.
  - Infobulle : « Dicter (Win+H) · saisie vocale de Windows » · *Dictate (Win+H) · Windows voice typing*.
  - Le clic envoie Win+H au champ, qui garde le focus.
- **Le raccourci** : Win+H, celui de Windows. Il marche déjà dans le champ qui a le focus. Pas de raccourci propre à Ledge.
- **Dictée en cours** : c'est la fenêtre de Windows qui le montre (le cadre pointillé de la capture marque sa place, ce n'est
  pas un dessin de Ledge). Le bouton de Ledge ne change pas d'aspect.
- **Pour l'arrêter** : un second clic sur le bouton, Win+H, ou la fenêtre de Windows (qui s'arrête aussi seule après un
  silence).
- **Indisponible ou désactivée** (paramètres de confidentialité vocale) : c'est Windows qui le dit, dans sa fenêtre, avec ses
  textes. Ledge ne dit « indisponible » que hors de l'application Desktop (aperçu web, build e2e) : le bouton est alors grisé,
  avec l'infobulle « La dictée n'est disponible que dans Ledge Desktop. » · *Dictation is only available in Ledge Desktop.*
- **Le texte dicté arrive dans le champ et y reste**, pour relecture ; rien ne part seul. Entrée l'envoie.
- **Champ fermé** (pas de note, chiffres seulement, carte `ask`) : le bouton est grisé, comme Envoyer (déjà dans l'issue).
- **Pas de champ** (vue Terminal, page d'un sous-agent, hors ligne, lecture seule, siège OMP) : pas de bouton.

## 3. L'aparté /btw : les états que la maquette ne dessinait pas

Captures : `cplt-aparte-attente-*`, `cplt-aparte-echec-*`.

- **En attente**, environ 4 s : la carte d'aparté avec la question, puis « Nova répond en aparté… » qui scintille.
  · *Nova is answering aside…*
- **Réponse illisible** : « Ledge n'a pas pu lire la réponse : elle est dans le terminal de Nova. » · *Ledge could not read
  the answer: it is in Nova's terminal.* Lien « Voir la vue Terminal » · *Open the Terminal view*.

## 4. Les textes de la maquette, à mettre dans les deux catalogues

| Où | FR | EN | Statut |
|---|---|---|---|
| Repli d'un échange passé | Travail | Work | maquette |
| Résumé, cartes | Progression · Fichiers modifiés · Sous-agents | Progress · Changed files · Subagents | maquette |
| Résumé (aria) | Résumé de la session | Session summary | maquette |
| Pied du fil | {nom} réfléchit… | {name} is thinking… | maquette |
| Pied du fil, en attente | textes actuels `thread.waits` + `resumes` | idem | repris |
| Pied du fil, action en cours | verbe actuel + cible + durée | idem | repris |
| Décision sur la bulle | Autorisé · Toujours autorisé · Refusé · Répondu dans le terminal | Allowed · Always allowed · Denied · Answered in the terminal | maquette (voir D1) |
| Bouton rond | Envoyer · Interrompre {nom} · Demander en aparté | Send · Interrupt {name} · Ask aside | maquette |
| Bouton rond, OMP | `reply.stop(n)` « Arrêter {nom} », `reply.stopping` « Arrêt demandé… » | idem | repris |
| Rangée du bas, /btw | **btw** En aparté : {nom} répond sans s'interrompre, hors du fil | **btw** Aside: {name} answers without stopping, outside the thread | maquette |
| Carte d'aparté | En aparté · hors du fil, {nom} continue son travail | Aside · outside the thread, {name} keeps working | maquette |
| Carte d'aparté, fermer | Fermer l'aparté | Close the aside | maquette |
| Aparté en attente | {nom} répond en aparté… | {name} is answering aside… | **nouveau** |
| Aparté illisible | Ledge n'a pas pu lire la réponse : elle est dans le terminal de {nom}. · Voir la vue Terminal | Ledge could not read the answer: it is in {name}'s terminal. · Open the Terminal view | **nouveau** |
| Micro | Dicter (Win+H) · saisie vocale de Windows | Dictate (Win+H) · Windows voice typing | maquette, « (Win+H) » **nouveau** |
| Micro hors de Desktop | La dictée n'est disponible que dans Ledge Desktop. | Dictation is only available in Ledge Desktop. | **nouveau** |
| Champ en dictée | ~~Je vous écoute…~~ / ~~Arrêter la dictée~~ | — | **retirés** (Ledge ne sait pas qu'elle écoute) |
| Réglage | (voir 1) | (see 1) | **nouveau** |

Choix D1, le mot de la décision : **A (recommandé, celui de la maquette)** « Autorisé », le mot du bouton Autoriser.
**B** « Accordé », le mot du catalogue d'aujourd'hui (`thread.decided.accept`).

## 5. Les états que l'implémentation devra trancher (mes recommandations)

- **/btw tapé pendant une demande en attente** : le champ sert alors de note de refus. Recommandé : /btw n'est pas pris comme
  un aparté et le cadre ne passe pas en pointillés. Le texte partirait comme une note : la rangée du bas le dit avec la
  légende de refus d'aujourd'hui (« Entrée refuse avec ce message »). Rien de nouveau à écrire.
- **/btw sur un autre harnais** : réglé par jde (Claude Code seulement). Le texte part comme un message ordinaire.
- **Plusieurs apartés** : ils s'empilent sous le fil, du plus ancien au plus récent ; chacun se ferme par ×. Ils ne survivent
  pas à la fermeture de l'onglet (ils sont hors du fil).
- **Dictée et /btw ensemble** : la rangée du bas dit « btw » dès que le texte dicté commence par /btw.
- **Dictée pendant que l'agent travaille** : permise ; le texte reste dans le champ et Entrée l'envoie « après ce tour »,
  comme aujourd'hui.
- **Vue étroite** (sans résumé) : le bouton micro et le bouton rond restent ; la rangée du bas se tronque à gauche, comme
  dans `zoom-saisie-etroit`.
