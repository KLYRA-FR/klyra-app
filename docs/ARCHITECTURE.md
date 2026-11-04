# Architecture

Carte vérifiée sur le commit `0e332d9` (04/11/2026). À revoir quand un dossier de premier niveau change, ou quand `package.json` ou `convex/schema.ts` changent en profondeur. Pour les règles d'une zone : `docs/consignes/`.

## Les pièces

| Pièce | Dossier | Rôle |
|---|---|---|
| Process principal | `electron/` | Fenêtre, fichiers, IPC, lancement des agents, routines, Coffre, journal super-agent |
| Écrans | `src/` | Next.js 16 en export statique, chargé par Electron. Pages dans `src/app/`, composants dans `src/components/`, logique dans `src/lib/`, modèle dans `src/types/` |
| Pont entre les deux | `electron/preload.ts`, `src/lib/bridge.ts` | L'écran passe par `window.klyra` |
| Données d'équipe | `convex/` | Comptes, équipe, Bibliothèque, artefacts et documents partagés, rappels, téléphone |
| Serveur d'un VPS | `serveur/` | Agents, routines et fichiers à distance, livrés en `.mjs` |
| Site vitrine | `site/` | Next.js à part, landing et changelog |
| Modèles d'agents | `agents-equipe/` | Fiches facultatives, proposées par la Bibliothèque |
| Outillage | `scripts/`, `.github/workflows/` | Tests, génération, CI et publication |

## Où vivent les données

- **Sur le poste** (`userData`) : `conversations.json`, `equipe/*.md`, `mes-agents.json`, `consommation.jsonl`, `superagent.sqlite`, `coffre.json`.
- **Dans Convex** : ce qui est partagé volontairement. Rien du journal super-agent.
- **Sur un VPS** : les sessions et les fichiers de l'utilisateur `klyra`.

## Fichiers générés, à ne pas éditer

| Fichier | Source | Commande |
|---|---|---|
| Une partie de `serveur/*.mjs` | Modules purs d'`electron/` | `node scripts/serveur-genere.mjs` (liste dans son en-tête) |
| `src/data/agent-templates.generated.ts` | `agents-equipe/*.md` | `pnpm agents:equipe` |
| `convex/_generated/` | `convex/` | Convex |

## CI et publication

| Workflow | Quand | Effet |
|---|---|---|
| `verification.yml` | PR vers `main` | Lint, build, types et tests sur Ubuntu, Mac et Windows. Ne publie rien |
| `app.yml` | Push sur `main` | Build Mac et Windows, déploiement Convex, version dans `KLYRA-FR/klyra-app-versions` |
| `app-web.yml` | Push sur `main` | App web du téléphone, en ligne sur Vercel (`docs/APP-WEB.md`) |
| `verification-mac.yml`, `verification-ordinateur-mac.yml` | PR selon les fichiers touchés | Signature et Computer Use sous Mac |

## Pour aller plus loin

`docs/SERVEUR-VPS.md`, `docs/CONVEX-PLAN.md`, `docs/ROUTINES.md`, `docs/SUPERAGENT.md`, `docs/COMPOSIO.md`, `docs/APP-WEB.md`.
