# Rig OpenRig `ledge-dev`

L'équipe d'agents qui développe Ledge, versionnée avec le code.

## Les sièges

| Siège | Runtime · modèle | Rôle |
|---|---|---|
| `pilot-lead@ledge-dev` | Claude Code · Opus 5.5 | Ton interlocuteur. Découpe l'objectif, applique « maquette d'abord », route, suit, rend compte. |
| `design-ux@ledge-dev` | Claude Code · Opus 5.5 | Maquettes HTML dans `docs/mockups/` (clair/sombre, états, FR/EN, captures) avant tout front-end. |
| `dev-front@ledge-dev` | Claude Code · Opus 5.5 | Desktop, île, mobile, `packages/ui`, rendu TUI — à partir d'une maquette validée. |
| `dev-back@ledge-dev` | Claude Code · Opus 5.5 | Daemon/CLI, protocole, fleet, seal, relais, Rust. |
| `review-qa@ledge-dev` | Codex · gpt-6.1-terra | Revue indépendante du diff, tests, écrans comparés à la maquette (Playwright). |

## Le flux

```
toi ──objectif──▶ lead ──écran ?──▶ ux ──maquette──▶ lead ──▶ toi (validation)
                   │                                          │
                   │                         validée ─────────┘
                   ├──────────────▶ dev-front ──▶ review-qa ──▶ dev-front ──▶ lead ──▶ toi
                   └──────────────▶ dev-back  ──▶ review-qa ──▶ dev-back  ──▶ lead ──▶ toi
```

Règles complètes : [`CULTURE.md`](CULTURE.md). Chaque dev travaille dans son propre worktree
(`../ledge-worktrees/<siège>-<sujet>`), jamais dans ta copie principale, celle d'où tu lances l'équipe. Rien n'est poussé sans ton accord.

## Lancer

```
rig daemon start             # si le daemon est arrêté
rig up openrig/rig.yaml      # les sièges démarrent dans la copie qui contient cette spec
rig up ledge-dev --cwd .     # depuis la bibliothèque OpenRig : --cwd donne la copie, ici le dossier courant
```

Puis parle au lead : `rig send pilot-lead@ledge-dev "<ton objectif>"`, ou dans son terminal. Revenir à une équipe
arrêtée : `rig up ledge-dev --existing`.

## Fichiers

- `rig.yaml` — topologie (pods, sièges, liens). `cwd: ".."` : les sièges démarrent à la racine de la copie qui contient
  la spec, où qu'elle soit. La copie de bibliothèque d'OpenRig n'a pas de dépôt autour d'elle : lance-la avec `--cwd`.
  `managed_blocks` met les blocs d'OpenRig des sièges Claude dans `CLAUDE.local.md`, ignoré par git.
- `CULTURE.md` — règles communes à toute l'équipe.
- `agents/<rôle>/` — spec et consignes de rôle de chaque agent ; `agents/developer` sert aux deux devs.
- `guidance/scope-*.md` — le périmètre propre à chaque dev.
- `agents/shared/` — plugin `openrig-core` de l'installation du daemon et fragments runtime copiés d'OpenRig 0.7.7.

Modifier un rôle ne change pas un siège déjà lancé : relancer ce siège (`rig seat launch <siège> --fresh --stop
--reason "..."`) ou toute l'équipe.
