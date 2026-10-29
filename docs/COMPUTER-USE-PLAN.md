# Computer Use dans l'app KLYRA : plan d'architecture

29/10/2026, pour Corentin. Ce plan ne contient pas de code. Il s'appuie sur `electron/claude.ts`, `electron/ia.ts`, `electron/main.ts`, `electron/reglages.ts` et la config `build` de `package.json`.

## En bref

- **Recommandation** : un serveur MCP « ordinateur », ajouté au serveur MCP local qui existe déjà (`demarrerServeurMcp` dans `ia.ts`). Les agents Claude Code l'appellent comme les outils des fils. Pas de clé API : tout passe par l'abonnement Claude Code de la personne.
- **La règle de sécurité principale** : c'est l'app qui demande l'accord avant chaque action, pas Claude Code. Le serveur bloque l'outil tant que la personne n'a pas répondu, même en accès « tout ».
- **Le point dur sur Mac** : avec la signature ad hoc actuelle, macOS peut retirer les autorisations à chaque mise à jour. Il faut une signature stable avant de livrer.

## 1. Comment les agents pilotent l'écran

| Option | Pour | Contre |
|---|---|---|
| **(a) Outil computer use d'Anthropic, appelé par une boucle dans l'app** | Outil officiel, entraîné pour ce travail. Version actuelle : `computer_toolset_20260801` (aucun en-tête bêta, Claude 5.5 et suivants). Versions précédentes : `computer_20251124`, `computer_20250124`. 17 actions (`screenshot`, `zoom`, `left_click`, `type`, `key`, `scroll`…). [1] | Les exemples officiels passent par l'API Messages avec une clé API (`x-api-key`), facturée à l'usage [1]. Corentin n'a pas de clé : il utilise l'abonnement. Il faudrait aussi écrire une deuxième boucle d'agent à côté de Claude Code. |
| **(a bis) Computer use intégré à Claude Code** (serveur `computer-use`) | Déjà fait par Anthropic : accord par app, Échap global, terminal exclu des captures, captures réduites automatiquement. [2] | **Ne marche pas avec `-p`.** Or l'app lance ses agents en `claude -p --input-format stream-json`. En ligne de commande, il ne marche que sur Mac, et seulement avec un abonnement Pro ou Max (Team et Enterprise sont exclus). [2] |
| **(b) Serveur MCP local « ordinateur »** dans l'app | Abonnement conservé. Branchement déjà en place (`configMcp`, jeton aléatoire, en-têtes `X-Klyra-Chat` / `X-Klyra-Agent`). L'app garde la main sur chaque action. | Il faut tout écrire : capture, entrées, garde-fous. Deux points sont **à vérifier sur un prototype** : que Claude Code transmet bien au modèle les images rendues par un outil MCP en mode `-p` (le SDK accepte des blocs image dans un résultat d'outil [3], mais un bug connu les supprime si `structuredContent` est aussi présent [4]), et la précision des clics hors de l'outil officiel. |
| **(c) Briques existantes** | Serveurs MCP open source de contrôle d'ordinateur (par exemple macos-use [5]). nut.js [6]. robotjs (MIT, de nouveau publié en 2026, version 0.9.1 [7]). Ou les API natives : CGEvent et ScreenCaptureKit sur Mac, SendInput et Windows.Graphics.Capture ou PrintWindow sous Windows. | Les serveurs MCP tiers échappent à notre contrôle par action et demandent leurs propres autorisations. Les paquets précompilés de nut.js sont réservés aux offres payantes (la source reste sur GitHub) [6]. robotjs est un module natif à recompiler pour chaque version d'Electron (compatibilité avec Electron 44 : à vérifier). |

**Choix : (b)**, avec une base native minimale :
- **Capture** : `desktopCapturer` d'Electron, dans le process principal, avec `thumbnailSize` à la taille de l'écran [8]. Aucune dépendance de plus.
- **Clavier et souris** : un petit exécutable par système, livré dans `extraResources` comme `whisper-cli` (Swift + CGEvent sur Mac, SendInput sous Windows), piloté en JSON sur son entrée standard. robotjs reste une solution de repli, après un test sur Electron 44.
- **Outils** : on reprend les noms et paramètres de l'outil d'Anthropic (`capture`, `clic` avec `coordinate`, `taper`, `touche`, `defiler`, `zoom`). Le modèle reste ainsi en terrain connu.
- **Taille des captures** : 1 280 à 1 568 px sur le grand côté, en JPEG. Anthropic conseille de ne pas dépasser 1920×1080 et prend 1280×720 comme base quand les clics manquent de précision [1]. Claude Code réduit lui-même un écran Retina de 16 pouces à environ 1372×887 [2]. Une sortie d'outil MCP est limitée à 25 000 tokens par défaut, avec une alerte à 10 000 [9] ; la façon dont les images comptent dans cette limite est à vérifier.
- **Latence** : chaque action fait un aller-retour complet (réponse du modèle, puis capture). Pour limiter le nombre de tours, chaque action rend sa capture d'après, et `zoom` sert à lire un détail sans envoyer tout l'écran.

## 2. Sécurité

- **Interrupteur** : `computerUse: false` par défaut dans `reglages.ts`. Tant qu'il est éteint, les outils n'apparaissent pas dans `tools/list` et `tools/call` refuse. On ne les ajoute jamais à `OUTILS_APP()` ni à `--allowedTools`.
- **Accord avant chaque action** : le serveur MCP attend la réponse de l'interface, comme `relaisFils`, mais sans le délai de 30 s. Il ne passe pas par le `can_use_tool` de `claude.ts` : en accès « tout », celui-ci dit oui d'office (ligne 466), et son « toujours » écrit des règles durables dans `.claude/settings.local.json`. La fenêtre montre la capture, l'action en clair (« Cliquer sur “Envoyer” dans Mail ») et la zone visée, avec trois choix : Oui, Toujours pour cette app (jusqu'à la fin du pilotage), Non. Le délai d'attente des outils MCP dans Claude Code est à vérifier.
- **Liste d'apps autorisées**, réglée dans les Réglages. Avant chaque action, l'exécutable vérifie l'app au premier plan et la fenêtre sous le point visé (`NSWorkspace.frontmostApplication` et la liste des fenêtres sur Mac, `WindowFromPoint` sous Windows). Si l'app n'est pas dans la liste, l'action est refusée. Les terminaux, IDE, gestionnaires de mots de passe, Finder, Réglages système et KLYRA lui-même ne sont pas dans la liste de départ, et un avertissement s'affiche si on les ajoute, comme dans Claude Code [2].
- **Arrêt d'urgence**, de trois façons :
  - un raccourci global (`globalShortcut`) actif pendant le pilotage, que l'agent n'a pas le droit d'envoyer ;
  - un bouton « Arrêter » flottant, toujours visible ;
  - une bordure colorée autour de chaque écran (fenêtre transparente au niveau `screen-saver`, qui laisse passer la souris grâce à `setIgnoreMouseEvents`) [10].

  Arrêter fait trois choses : l'outil en cours est refusé, `cancelAgent` interrompt l'agent, et toute touche encore enfoncée est relâchée.
- **Masquage** : les fenêtres de KLYRA (y compris la bordure et le bouton) sont noircies sur chaque capture à partir de leurs coordonnées, qu'on connaît. On ne compte pas sur `setContentProtection`, qui ne bloque pas toutes les captures sur Mac récents [10]. Les champs de mot de passe sont repérés par l'accessibilité (sous-rôle `AXSecureTextField` sur Mac, propriété `IsPassword` d'UI Automation sous Windows ; à vérifier) : ils sont noircis, et `taper` y est refusé.
- **Pas de secrets** : un agent ne peut ni taper dans un champ de mot de passe ni lire ou écrire le presse-papiers. Une consigne lui demande de rendre la main à la personne pour toute connexion.
- **Limites** : une durée maximale et un nombre maximal d'actions par pilotage, réglables (les valeurs par défaut sont à fixer), et un pilotage à la fois sur tout le poste.
- **Journal** : un fichier JSONL par jour dans `userData` (date, agent, conversation, app, action, réponse de la personne, résultat), lisible depuis les Réglages.
- **Injection par l'écran** : une page ou un mail peut contenir des consignes. Anthropic recommande l'accord humain pour les actions importantes, de ne pas donner d'identifiants au modèle et de limiter les sites accessibles [1]. Ses classifieurs analysent les captures rendues par son outil [1] ; on ne sait pas s'ils analysent aussi celles d'un MCP tiers (à vérifier). Parades : l'accord avant chaque action, la liste d'apps, les terminaux exclus, et une consigne qui précise que le contenu de l'écran est une donnée, jamais une instruction.

## 3. Mac et Windows

| | Mac (arm64) | Windows (x64) |
|---|---|---|
| Autorisations | Accessibilité (clavier et souris) et Enregistrement de l'écran. État lu avec `isTrustedAccessibilityClient(false)` et `getMediaAccessStatus('screen')` [11]. `askForMediaAccess` ne gère pas `screen` [11]. Il faut parfois relancer l'app après l'accord [2][11]. | Pas d'équivalent : `screen` renvoie toujours « granted » [11]. En revanche, SendInput ne peut pas agir sur une app lancée en administrateur (UIPI), et l'échec est silencieux [12]. Il faut le détecter et l'expliquer. |
| Entrées | CGEvent, coordonnées en points | SendInput, coordonnées absolues |
| Capture | `desktopCapturer` (ScreenCaptureKit en direct : à éviter si possible) | `desktopCapturer`, ou PrintWindow pour une seule fenêtre |
| Mise à l'échelle | Retina ×2 : on réduit la capture, puis on reconvertit les coordonnées du modèle [1] | 125 à 200 % selon l'écran : conversion des DIP en pixels avec `screen.dipToScreenPoint` (à vérifier) |
| Multi-écrans | On pilote un écran à la fois, celui de l'app visée. Le calcul `screen.getAllDisplays()` (position, `scaleFactor`) → capture réduite → coordonnées du modèle → coordonnées de l'écran est fait dans une fonction pure, testée sur des cas Retina, 150 % et écrans mixtes. | idem |

**Signature Mac et mises à jour.** L'app est signée ad hoc (`"identity": "-"`, `hardenedRuntime: false`), et `maj.ts` remplace l'app entière. Apple le confirme : une signature ad hoc n'a pas d'« exigence désignée » stable, donc macOS ne reconnaît pas la version suivante comme la même app et redemande l'Enregistrement de l'écran [13]. L'Accessibilité est touchée de la même façon. Parfois, l'interrupteur reste coché alors que l'accord ne vaut plus [14]. Parades, de la meilleure à la moins bonne :
1. **Une signature Developer ID** (compte Apple Developer, déjà prévu au point 8 du journal), recommandée par Apple [13].
2. **Un certificat auto-signé stable**, gardé dans les secrets de l'action GitHub et réutilisé à chaque version : l'exigence désignée repose alors sur le certificat, plus sur l'empreinte du binaire. Que cela suffise à garder les autorisations est **à vérifier** sur deux versions successives.
3. **Dans tous les cas** : après une mise à jour, l'app détecte qu'elle a perdu les autorisations et affiche un guide (ouvrir le bon panneau, retirer l'ancienne ligne, la rajouter, relancer l'app). Elle ne lance aucun pilotage sans les deux autorisations.

## 4. Étapes (7 PR)

1. **Réglages et autorisations** (faite dans la PR qui ajoute ce plan). Section « Computer Use » : interrupteur éteint par défaut, état Accessibilité et Écran, boutons vers les Réglages système ; l'état est relu à chaque retour dans l'app, ce qui montre une autorisation perdue après une mise à jour. Ajout dans `reglages.ts`, `catalogue.ts` et le pont IPC. *Vérifier* : `pnpm typecheck && pnpm lint && pnpm build && pnpm test:smoke` (le texte de la section est lu) ; sur Mac, l'état change bien après avoir accordé puis retiré les autorisations.
2. **Signature Mac stable.** Option 1 ou 2 ci-dessus dans l'action App. *Vérifier* : publier deux versions de test, accorder les autorisations sur la première, mettre à jour, et constater qu'elles sont toujours actives.
3. **Couche système, sans agent.** Capture réduite, exécutables d'entrée Mac et Windows, conversion des coordonnées, liste des écrans. *Vérifier* : tests de la fonction de conversion ; un script de dev qui clique sur une cible connue dans une fenêtre de test, sur un écran Retina et sur un écran Windows à 150 %.
4. **Serveur MCP « ordinateur ».** Outils déclarés seulement si l'interrupteur est allumé, résultat en image sans `structuredContent`, blocage tant que la personne n'a pas répondu. *Vérifier* : un script (sur le modèle de `test:agents`) montre que les outils sont absents quand l'interrupteur est éteint et refusés sans accord ; un essai réel où un agent lit un texte affiché, ce qui confirme que l'image lui parvient en `-p`.
5. **Accord par action, liste d'apps, limites, journal.** Fenêtre d'accord (`Modale`, pas de fenêtre système), « toujours pour cette app », refus hors liste, coupure à la limite de durée ou d'actions. *Vérifier* : un scénario scripté (app hors liste, limite atteinte, refus) produit les bonnes lignes dans le journal.
6. **Arrêt d'urgence et masquage.** Raccourci, bouton, bordure, fenêtres KLYRA noircies, champs de mot de passe noircis et refusés. *Vérifier* : le raccourci coupe un agent en pleine action ; une capture prise pendant le pilotage ne montre ni KLYRA ni le contenu d'un champ de mot de passe de test.
7. **Parité Windows et documentation.** Message en cas de blocage UIPI, tests multi-écrans avec mise à l'échelle, mise à jour de `docs/JOURNAL.md`. *Vérifier* : la même recette que les PR 3, 5 et 6, sur un PC Windows (relecture par Agathe seulement si Corentin la demande).

## 5. Questions pour Corentin

1. Sur Mac, on prend le compte Apple Developer maintenant, ou on essaie d'abord le certificat auto-signé stable ?
2. Qui a droit au pilotage : tous les agents, ou un seul agent dédié ? Et quelles apps mettre dans la liste de départ ?
3. « Toujours pour cette app » doit durer jusqu'à la fin du pilotage (proposé), de la conversation, ou toujours ?
4. Le journal doit-il garder les captures (en local, effacées après quelques jours), ou seulement le texte ?
5. On livre Mac et Windows ensemble, ou Mac d'abord ?

## Sources

1. Outil computer use, doc Anthropic : https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
2. Computer use dans Claude Code (CLI) : https://code.claude.com/docs/en/computer-use · version Desktop : https://code.claude.com/docs/en/desktop
3. Outils personnalisés du SDK (blocs texte, image, ressource), d'après le ticket cité en 4 ; à relire : https://code.claude.com/docs/en/agent-sdk/custom-tools
4. Ticket « images supprimées si `structuredContent` » : https://claudeissues.com/issue/54737-bug-mcp-tool-results-image-content-blocks-dropped-when-structuredcontent-is-also
5. macos-use (exemple de MCP communautaire) : https://sharedcontext.ai/skills/external/sonichi/macos-use
6. nut.js, offres : https://nutjs.dev/
7. robotjs sur npm : https://www.npmjs.com/package/robotjs
8. Electron `desktopCapturer` : https://www.electronjs.org/docs/latest/api/desktop-capturer
9. Limite de sortie MCP de Claude Code : https://code.claude.com/docs/en/mcp
10. Electron `BrowserWindow` (`setContentProtection`, `setIgnoreMouseEvents`, `setAlwaysOnTop`) : https://www.electronjs.org/docs/latest/api/browser-window
11. Electron `systemPreferences` : https://www.electronjs.org/docs/latest/api/system-preferences
12. SendInput et UIPI, Microsoft : https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
13. Apple, perte de l'Enregistrement de l'écran avec une signature ad hoc : https://developer.apple.com/forums/thread/795739 · TN3127 : https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
14. Autorisation affichée active mais liée à une ancienne version (doc communautaire OpenClaw) : https://docs.openclaw.ai/platforms/mac/permissions
