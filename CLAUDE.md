# CLAUDE.md — klyra-app

App de bureau interne KLYRA (Electron + Next.js 16). Les règles studio (brand, `klyra-ui`, conventions code) sont dans `../CLAUDE.md` et s’appliquent ici. Ce fichier ne liste que ce qui est propre à ce dépôt.

## Phase actuelle

Front seul, **noir et blanc**, données factices. Les maquettes de référence sont dans Figma (section « App KLYRA — wireframes desktop »). On intègre un écran à la fois, dans l’ordre de la checklist du README.

## Règles propres à ce dépôt

- **Export statique obligatoire** (`output: "export"`, chargé par Electron) : pas de Server Actions, de route handlers dynamiques ni de proxy. Lire `node_modules/next/dist/docs/` avant d’utiliser une API Next (version 16.4, différente des connaissances habituelles).
- **Identifiants en paramètre d’URL** : `/chat?id=…`, `/projet?id=…`. NEVER de route `[id]` : l’export ne connaît que les id présents au build.
- **Données uniquement via les hooks de `src/lib/workspace.tsx`**. Les écrans ne lisent jamais `src/data/mock.ts` directement : c’est ce qui permettra de brancher le back sans toucher aux écrans.
- **Rien n’est rendu au build** (`AppShell` attend l’ouverture de l’app) : les dates des données dépendent du moment de l’ouverture.
- **Thème noir et blanc** dans `src/app/globals.css` : les bleus de marque y sont remplacés par des gris. Pour repasser en couleur, remettre les valeurs de `klyra-ui/src/styles/tokens.css`.
- **Variantes `klyra-ui` avec du bleu codé en dur, à éviter tant qu’on est en noir et blanc** : `Tabs` (onglet actif), `Badge` tinted / outline-k1, `Tag`, `IconButton` subtle / primary, `Button` primary, `Sidebar` webapp, et `variant="subtle"` des champs. Utiliser `dark`, `ghost`, `outline`, `ink`, `neutral`.
- **Une seule police : Google Sans Flex.** NEVER d’autre famille, même mono : `--font-mono` pointe sur Google Sans Flex, `.klyra-mono` ne sert qu’à aligner les chiffres.
- **Tailles de texte de l’interface** : tokens `text-ui` (14), `text-ui-s` (13), `text-ui-xs` (12), `text-ui-2xs` (11), `text-ui-3xs` (10). Surfaces : `bg-surface-1/2/3`.
- **Electron** : lancer avec `env -u ELECTRON_RUN_AS_NODE` (déjà dans les scripts). Si cette variable est présente, Electron démarre comme Node et `require("electron")` ne renvoie rien.

## Vérification

`pnpm typecheck && pnpm lint && pnpm build && pnpm test:smoke`. Ne pas vérifier par capture d’écran : Pelin fait la vérification visuelle de son côté ; `test:smoke` lit le texte rendu.
