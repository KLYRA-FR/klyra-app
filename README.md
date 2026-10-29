# KLYRA — app de bureau

L’outil interne du studio : un chat façon Messages avec des rôles (Principal, Dev, UX/UI, DA), les projets, les fichiers. App de bureau Mac (Electron), parce qu’elle doit piloter des outils en local (terminaux, Claude Code).

> **Phase actuelle : front en noir et blanc, données factices.** Le back (comptes, base de données, vrais agents) viendra ensuite.

Maquettes : Figma, section « App KLYRA — wireframes desktop ».

## Lancer l’app

```bash
pnpm install
pnpm desktop        # l’app de bureau, avec rechargement à chaud
pnpm dev            # la même interface dans le navigateur : http://localhost:3100
```

Version finale (sans serveur de dev) :

```bash
pnpm start:desktop
```

## Vérifier avant de livrer

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm test:smoke     # ouvre la version finale sans fenêtre et vérifie qu’elle s’affiche
```

## Contribuer et publier

Une branche par sujet, une pull request, la vérification verte, puis la fusion : voir [docs/CONTRIBUER.md](docs/CONTRIBUER.md). **Chaque fusion sur `main` publie une version pour tous les utilisateurs**, dans [KLYRA-FR/klyra-app-versions](https://github.com/KLYRA-FR/klyra-app-versions/releases/latest) : c’est là qu’on télécharge l’app, et là que les apps installées trouvent leurs mises à jour.

## Où sont les choses

| Dossier | Contenu |
|---|---|
| `electron/` | Process principal : la fenêtre, le chargement de l’app |
| `src/app/` | Les pages (une par écran) |
| `src/components/` | Les composants de l’app (chat, aperçu, barre latérale…), qui assemblent `klyra-ui` |
| `src/types/domain.ts` | Le modèle de données : rôles, projets, chats, messages |
| `src/data/mock.ts` | Les données factices, à la forme exacte des futures données |
| `src/lib/workspace.tsx` | L’état de l’app et les hooks de lecture. **Le seul fichier à changer pour brancher le back.** |

## Avancement

- [x] Fondations : Electron + Next.js + `klyra-ui` en noir et blanc
- [x] Barre latérale (navigation, projets, chats récents)
- [x] Conversation : fil multi-rôles, tâches, options, journal de travail, aperçu du site
- [ ] Accueil
- [ ] Projets et fiche projet
- [ ] Équipe et attribution des rôles
- [ ] Fichiers (façon Finder)
- [ ] Mémoire du projet
- [ ] Palette ⌘K
