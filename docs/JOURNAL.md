# Journal du projet — app KLYRA

> Historique des décisions et de l’avancement, pour reprendre le travail depuis n’importe quel ordi.
> **À Claude, en début de session : lis ce fichier et `CLAUDE.md` avant toute chose, puis mets à jour ce journal à la fin de chaque session.**

---

## L’objectif

Remplacer VS Code par **notre propre outil** pour travailler avec l’IA, en plus simple :
- un chat façon iMessage (bulles), où l’on parle à des **rôles** : Principal (l’interlocuteur qui répartit le travail), Dev, UX/UI, DA ;
- les chats récents et les projets toujours visibles ;
- l’aperçu du site en direct pendant qu’on « vibe code » ;
- un navigateur de fichiers façon Finder, pour retrouver ses images même mal nommées.

## Décisions prises

| Date | Décision | Pourquoi |
|---|---|---|
| 07/10/2026 | Desktop uniquement, noir et blanc pour l’instant | On valide la structure avant la couleur |
| 08/10/2026 | **App de bureau** (validé par le patron) | Elle doit piloter des terminaux en local (Claude Code, etc.), impossible en web |
| 08/10/2026 | **Electron** plutôt que Tauri | Les terminaux et le SDK Claude sont en JavaScript/Node : tout en TypeScript, pas de Rust |
| 08/10/2026 | Front d’abord, avec des données factices ayant la forme du futur back | On peaufine l’interface directement dans le code, puis on branche le back |
| 08/10/2026 | Une seule police : Google Sans Flex | Règle du design system KLYRA |
| 07/10/2026 | Fichiers façon **Finder** (grille de miniatures à faire défiler + panneau d’infos), **pas** de vue image par image avec des flèches | Beaucoup de captures, on veut scroller et cliquer |
| 07/10/2026 | L’IA renomme et étiquette les fichiers à l’import (on peut annuler) | Les fichiers sont souvent nommés 1, 2, 3… |

## Maquettes (Figma)

Fichier : https://www.figma.com/design/YEmyuRbNcN1t0GkHktxQET/claude

- **Veille** des interfaces de chat IA (Grok Bot, dots d’OpenAI, Meta Muse, Poke, ChatGPT, Claude, Gemini, Perplexity, Vibe, DeepSeek, Claude Cowork, Copilot…) et motifs à retenir : node `478-13`
- **Wireframes desktop** (section complète) : node `480-94`
  - 01 Accueil `481-1161` · 02 Conversation `480-1413` · 03 Projets `482-1305`
  - 04 Fiche projet `483-1458` · 05 Équipe `484-1619` · 06 Attribuer les rôles `484-1903`
  - 07 Fichiers `488-1984` · 08 Mémoire du projet `490-2117` · 09 Palette ⌘K `491-2311`
  - Composant Sidebar `480-360` · icônes et avatars `480-95`

Lien direct vers un écran : `https://www.figma.com/design/YEmyuRbNcN1t0GkHktxQET/claude?node-id=<node>`

## Fonctionnalités définies

- **Rôles** : Principal (orchestre, interlocuteur unique possible), Dev, UX/UI, DA ; création de rôles personnalisés (rédacteur, SEO, QA…).
- **Mode de travail par projet** : « le Principal répartit » ou « je parle à chaque rôle ».
- **Autonomie par rôle** : propose seulement / valide avec moi / livre en autonomie.
- **Dans le fil** : répartition des tâches, livrables à choisir (options), journal de travail (fichiers modifiés), actions (« lance le build »).
- **Aperçu** du site à droite (ordinateur / téléphone), zone modifiée encadrée.
- **Fichiers** : Récents, captures importées automatiquement, dossiers du projet, étiquettes, recherche par description, statut retenu / à valider / écarté, « utilisé dans ».
- **Mémoire du projet** : préférences, décisions, infos projet ; chaque ligne dit d’où elle vient ; modifiable.
- **Palette ⌘K** : fichiers, chats et actions au clavier.

### Idées en attente (pas encore décidées)

- Frise de versions en captures (revenir en arrière d’un clic)
- Boîte « À valider » qui regroupe tout ce qui attend une décision
- Commenter directement sur l’aperçu du site (cliquer un élément et écrire)

## Où on en est

### Fait
- [x] Veille et wireframes Figma (9 écrans)
- [x] Dépôt `pelin-klyra/klyra-app` : Electron + Next.js 16 + `klyra-ui` en noir et blanc
- [x] Modèle de données + données factices + store unique (`src/lib/workspace.tsx`)
- [x] Barre latérale
- [x] Écran de conversation (fil multi-rôles, envoi de message, @mention, réponses simulées, aperçu)

### À faire, dans l’ordre
1. [ ] Accueil
2. [ ] Projets (tableau) et fiche projet
3. [ ] Équipe et fenêtre « Attribuer les rôles »
4. [ ] Fichiers façon Finder
5. [ ] Mémoire du projet
6. [ ] Palette ⌘K
7. [ ] Puis le back : base de données (Neon + Drizzle), comptes, vrais agents (SDK Claude) et terminaux en local
8. [ ] Fichier d’installation .dmg pour l’équipe (compte développeur Apple, 99 $ par an)

### Points ouverts
- **Bleu codé en dur dans `klyra-ui`** (Tabs, certains Badge / Tag / IconButton, Sidebar webapp) : on ne peut pas le passer en gris par le thème. À signaler à Corentin pour qu’il utilise les variables de couleur.
- Les réponses des rôles sont des phrases fixes en attendant les vrais agents.

## Reprendre sur un autre Mac

```bash
gh auth login                       # avec le compte pelin-klyra
gh repo clone pelin-klyra/klyra-app
cd klyra-app
pnpm install
pnpm desktop
```

Puis, dans Claude : « Lis `docs/JOURNAL.md` et `CLAUDE.md`, on continue l’app KLYRA. »

## Historique des sessions

- **07/10/2026** — Veille des interfaces de chat IA, 9 wireframes desktop noir et blanc dans Figma.
- **08/10/2026** — Choix app de bureau (Electron). Création du dépôt, fondations, barre latérale et écran de conversation. Police unique Google Sans Flex.
