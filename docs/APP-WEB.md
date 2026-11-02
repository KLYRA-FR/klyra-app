# L’app web du téléphone : ce qu’il faut pour la publier

Rien n’est publié. Cette page dit ce qu’une future publication à adresse stable demande, pour que Réglages › Mobile affiche son QR et que les liens de connexion ouvrent l’app sur l’iPhone. Choisir un hébergement, le payer et le mettre en ligne restent à décider par Corentin.

## Ce qui existe

- **Un seul export** : `pnpm build` produit `out/`, l’export statique que charge Electron. Le même dossier est l’app web : sous 760 px, la coque du téléphone (`CoqueTelephone`). Aucun code serveur, aucune route dynamique.
- **Servi à la racine d’une adresse, il marche** : `scripts/test-mobile.mjs` le sert en local (`http://127.0.0.1:3480`) et s’y connecte comme un iPhone, sans app de bureau.
- **Le compte** : hors Electron, l’app parle à Convex directement (`adresseNavigateur`, `src/lib/compte.tsx`) : la production par défaut, le déploiement de développement sur `localhost`. Les jetons restent dans le stockage de la page.
- **`public/manifest.webmanifest`** : nom et icônes pour « Sur l’écran d’accueil ».

## Ce qu’il faut pour publier

1. **Une adresse https stable** (un nom de domaine, ou un sous-domaine d’un hébergeur statique). Un tunnel temporaire (`trycloudflare.com`, port local) change à chaque lancement : il ne convient pas.
2. **Un hébergement de fichiers statiques** qui sert `out/` tel quel, avec une règle : une adresse sans extension sert le fichier `.html` du même nom (`/chats` → `chats.html`, `/reglages` → `reglages.html`), et `/` sert `index.html`. Pas besoin de Node côté serveur.
3. **Publier depuis `main`**, après fusion, avec la même commande `pnpm build` que l’app de bureau. Aucun workflow de `.github/workflows/` ne le fait aujourd’hui : l’ajouter est une décision de publication (accord de Corentin, mise en œuvre par Diego).
4. **Poser `KLYRA_APP_URL`** dans le déploiement Convex de production, une fois l’adresse en ligne : l’adresse https, sans barre finale (`convex/convex.config.ts`). Elle n’est pas secrète. C’est un changement de production : sur accord de Corentin seulement.

## Ce que `KLYRA_APP_URL` change

- **Réglages › Mobile** (`telephones:adresseApp`) : l’étape 1 montre l’adresse, son QR (`serveur/qr.mjs`, rendu en SVG) et « Copier l’adresse » ; les étapes 2 et 3 apparaissent. Sans elle : « L’adresse de KLYRA pour le téléphone n’est pas encore en ligne. »
- **La page relais du lien de connexion** (`convex/http.ts`) : une demande venue du téléphone ouvre `KLYRA_APP_URL/?code=…` au lieu de montrer le lien à coller.
- Une valeur qui n’est pas une adresse https est ignorée (`adresseApp`, `convex/model/contenus.ts`).

## Ce que la publication ne change pas

- Le téléphone écrit toujours aux conversations par le compte, puis par le PC : une conversation du VPS écrite depuis le téléphone attend que le PC soit ouvert. L’accès direct au VPS quand le PC est éteint reste à construire dans le parcours VPS.
- Le QR du terminal du VPS (`klyra://rejoindre`) ne s’ouvre toujours pas dans l’app web de l’iPhone.

## À vérifier sur l’iPhone de Corentin, après publication

Pose sur l’écran d’accueil depuis Safari, stockage séparé entre Safari et l’app posée (le lien ouvert dans Safari peut devoir être collé dans l’app), libellés exacts des menus, déconnexion à distance depuis Réglages › Mobile.
