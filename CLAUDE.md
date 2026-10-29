# CLAUDE.md — klyra-app

App de bureau interne KLYRA (Electron + Next.js 16). Les règles studio (brand, `klyra-ui`, conventions code) sont dans `../CLAUDE.md` et s’appliquent ici. Ce fichier ne liste que ce qui est propre à ce dépôt.

**ALWAYS lire `docs/JOURNAL.md` en début de session** (décisions, maquettes Figma, ce qui reste à faire) et le mettre à jour en fin de session : c’est l’historique partagé entre les ordis.

## Phase actuelle

Front seul, données factices, **aux couleurs et composants du design system KLYRA** (https://claude.ai/artifact/C3Tqnor89ed3qjk6n1Wben) : l’app doit avoir l’air d’un vrai produit KLYRA, pas d’un wireframe. Les maquettes Figma (section « App KLYRA — wireframes desktop ») donnent la structure des écrans, le design system donne le rendu. On intègre un écran à la fois, dans l’ordre de la checklist du journal.

## Règles propres à ce dépôt

- **Export statique obligatoire** (`output: "export"`, chargé par Electron) : pas de Server Actions, de route handlers dynamiques ni de proxy. Lire `node_modules/next/dist/docs/` avant d’utiliser une API Next (version 16.4, différente des connaissances habituelles).
- **Identifiants en paramètre d’URL** : `/chat?id=…`, `/projet?id=…`. NEVER de route `[id]` : l’export ne connaît que les id présents au build.
- **Données uniquement via les hooks de `src/lib/workspace.tsx`**. Les écrans ne lisent jamais `src/data/mock.ts` directement : c’est ce qui permettra de brancher le back sans toucher aux écrans.
- **Rien n’est rendu au build** (`AppShell` attend l’ouverture de l’app) : les dates des données dépendent du moment de l’ouverture.
- **Tokens** dans `src/app/globals.css`, repris du `tokens.json` du design system. ALWAYS les rôles du design system en classes : `text-texte-principal / -secondaire / -tertiaire / -accent`, `bg-fond-page / -surface / -survol / -surface-grise / -accent`, `border-bordure-subtile / -defaut / -forte / -champ`, `text-icone-defaut / -secondaire / -accent`, `shadow-ombre-xs / -sm / -ambiante / -levee`, `rounded-xs` (6, boutons) à `rounded-3xl`, `ease-sortie`. Les anciens noms (`k1`, `ink`, `fg-1`, `border-1`, `surface-1`…) ne restent que parce que `klyra-ui` les lit.
- **Icônes : uniquement le set officiel** du design system, via `<Icon name="…" />` (`src/components/icons/`). NEVER lucide ni un autre set. Une icône manque : la reprendre du groupe Icons du design system et l’ajouter à `icon-data.tsx` (encre `#303030` → `currentColor`).
- **Boutons : `Bouton` / `BoutonIcone`** (`src/components/ui/Bouton.tsx`, variantes `sombre`, `blanc`, `gris`, `discret`, `ghost`) et `BoutonPrincipal` (noir à écran de points, un seul par écran, sans icône). NEVER le `Button` ni l’`IconButton` de `klyra-ui` : ils sont en pilule et passent au bleu au survol.
- **Autres composants du design system portés ici** : `Onglets`, `PixelCheck` (coche « fait »). De `klyra-ui`, on garde `Input`, `Textarea`, `Avatar`, `Kbd`, `Stack`, `EmptyState`.
- **Listes et fenêtres : jamais de rendu système.** NEVER de `<select>` natif ni du `Select` de `klyra-ui` : `ListeDeroulante` (`src/components/ui/ListeDeroulante.tsx`, variantes `champ`, `puce`, `compact` ; `PuceSelect` dans les composeurs). NEVER `window.alert/confirm/prompt` : `Modale` et `useConfirmation` (`src/components/ui/Modale.tsx`).
- **Réglages** (`src/components/reglages/`) : une section par fichier dans `sections/`, chaque réglage dans une `Ligne` dont l’`id` est aussi déclaré dans `catalogue.ts` (c’est ce que la recherche trouve). Nouveau réglage → l’ajouter aux deux. Ce que le process principal doit connaître (notifications…) passe par `electron/reglages.ts` et `useReglages()` (`src/lib/reglages.ts`). ⌘ , ouvre les Réglages (`useRaccourciReglages`).
- **Consommation** : `electron/consommation.ts` tient un journal (`consommation.jsonl` dans le dossier de l’app) des jetons et coûts renvoyés par Claude Code (écart du `modelUsage` cumulé, à chaque `result`) et par les autres IA (`usage`). Jamais de contenu de message. Le Profil en tire ses chiffres (`src/lib/consommation.ts`) ; NEVER de chiffre estimé ou inventé : sans donnée, un état vide.
- **Computer Use** : seulement l’interrupteur (coupé par défaut) et l’état des autorisations du système, dans les Réglages. Le pilotage suit `docs/COMPUTER-USE-PLAN.md`, après validation de Corentin.
- **NEVER de `.module.css`** : la config Turbopack fait passer tous les `.css` par Tailwind, ce qui casse les CSS modules (le composant s’affiche sans style, sans erreur). Les styles qu’on ne peut pas écrire en classes Tailwind vont dans `globals.css`, en classes préfixées `klyra-…`.
- **ALWAYS `cn` de `@/lib/cn`**, jamais celui de `klyra-ui` : il ne connaît pas nos tailles `text-ui…` et les prend pour des couleurs (texte noir sur bouton sombre). Nouvelle taille ou ombre dans `globals.css` → l’ajouter aussi dans `src/lib/cn.ts`.
- **Logo** : `public/brand/` (générique, signe, icône), copiés du design system. Générique jamais sous 125 px de large.
- **Agents = les vrais fichiers `~/.claude/agents/*.md`**, lus et écrits par l’app de bureau (`electron/agents.ts`, via `window.klyra`, cf. `src/lib/bridge.ts`). NEVER de copie des fiches dans le code : l’écran affiche le fichier, section par section. Seuls le rôle court et la couleur sont des réglages de l’app (`agents-meta.json` dans le dossier de l’app).
- **Écrire une fiche** : toujours via `useAgents().save` (copie dans l’historique, refus si le fichier a changé depuis l’ouverture). L’`id` d’un agent ne change jamais.
- **Modèle d’équipe** : `agents-equipe/*.md` (texte intégral des 11 fiches) → `pnpm agents:equipe` régénère `src/data/agent-templates.generated.ts`, installé sur un poste qui ne les a pas.
- **Lou** : « Modifier avec Lou » lance Claude Code en local (`electron/claude.ts`, `claude -p --agent prompty`, sans outil d’écriture). Elle propose, l’utilisateur applique.
- **Une seule police : Google Sans Flex.** NEVER d’autre famille, même mono : `--font-mono` pointe sur Google Sans Flex, `.klyra-mono` ne sert qu’à aligner les chiffres.
- **Tailles de texte de l’interface** : tokens `text-ui` (14), `text-ui-s` (13), `text-ui-xs` (12), `text-ui-2xs` (11), `text-ui-3xs` (10). Texte en sentence case, y compris les petits titres de la barre latérale.
- **Mac et Windows** : NEVER « Mac », « Finder » ni « ⌘ » en dur dans un texte de l’interface. Passer par `src/lib/plateforme.ts` (`poste.ce` → « ce Mac » ou « ce PC », `poste.dansExplorateur`, `raccourciDuSysteme("⇧⌘Z")` → « Ctrl+Maj+Z » sous Windows) ; pour les touches, `estMac()` et `avecCommande()` de `src/lib/raccourcis.ts`, qui lisent le même système.
- **Electron** : lancer avec `env -u ELECTRON_RUN_AS_NODE` (déjà dans les scripts). Si cette variable est présente, Electron démarre comme Node et `require("electron")` ne renvoie rien.

## Vérification

`pnpm typecheck && pnpm lint && pnpm build && pnpm test:smoke`, et `pnpm test:agents` (dev server lancé) dès qu’on touche aux agents : il tourne sur un dossier temporaire, jamais sur les vrais agents. Ne pas vérifier par capture d’écran : Pelin fait la vérification visuelle de son côté ; `test:smoke` lit le texte rendu.
