# L’app web du téléphone : ce qu’il faut pour la publier

L’app web du téléphone se publie sur Vercel, à l’adresse prévue `https://app.klyra.fr`, dès que le projet et ses secrets sont posés (ci-dessous). Une fois `KLYRA_APP_URL` posée, Réglages › Mobile affiche son QR et les liens de connexion ouvrent l’app sur l’iPhone.

## Ce qui existe

- **Un seul export** : `pnpm build` produit `out/`, l’export statique que charge Electron. Le même dossier est l’app web : sous 760 px, la coque du téléphone (`CoqueTelephone`). Aucun code serveur, aucune route dynamique.
- **Servi à la racine d’une adresse, il marche** : `scripts/test-mobile.mjs` le sert en local (`http://127.0.0.1:3480`) et s’y connecte comme un iPhone, sans app de bureau.
- **Le compte** : hors Electron, l’app parle à Convex directement (`adresseNavigateur`, `src/lib/compte.tsx`) : la production par défaut, le déploiement de développement sur `localhost`. Les jetons restent dans le stockage de la page.
- **`public/manifest.webmanifest`** : nom et icônes pour « Sur l’écran d’accueil ».

## Publier sur Vercel (choix de Corentin, 02/11/2026)

`.github/workflows/app-web.yml` construit l’export à chaque push sur `main`, le garde en artefact (`app-web`, 14 jours) et le met en ligne sur Vercel. Vercel ne reconstruit rien : `scripts/sortie-vercel.mjs` range `out/` dans `.vercel/output/` (Build Output API v3), qui sert chaque page sans extension (`/chats` → `chats.html`), relit `sw.js` à chaque visite et renvoie `404.html` pour le reste ; puis `vercel deploy --prebuilt --prod`. Sans les trois secrets ci-dessous, la mise en ligne est sautée.

Une fois, par Corentin :

1. **Projet Vercel** : sur vercel.com, dans l’équipe de KLYRA, créer un projet `klyra-app` (framework « Other », sans dépôt relié : c’est l’action GitHub qui publie). L’offre gratuite (Hobby) interdit l’usage commercial : le projet va dans l’équipe payante de KLYRA, celle de klyra.fr.
2. **Secrets du dépôt** (GitHub › Settings › Secrets and variables › Actions) :
   - `VERCEL_TOKEN` : un jeton créé dans Vercel › Account Settings › Tokens, limité à l’équipe de KLYRA ;
   - `VERCEL_ORG_ID` : l’identifiant de l’équipe (Team Settings › General › Team ID) ;
   - `VERCEL_PROJECT_ID` : l’identifiant du projet (Project Settings › General › Project ID).
3. **Domaine** : dans le projet, Settings › Domains, ajouter `app.klyra.fr`. Chez Hostinger (DNS de klyra.fr), l’enregistrement que Vercel indique, en général un CNAME `app` vers `cname.vercel-dns.com`.
4. **Première mise en ligne** : relancer « App web » (Actions › App web › Run workflow), ou attendre la prochaine fusion sur `main`.
5. **Poser `KLYRA_APP_URL`** dans le déploiement Convex de production, une fois l’adresse en ligne : `npx convex env set KLYRA_APP_URL https://app.klyra.fr --prod` (sans barre finale, `convex/convex.config.ts`). Elle n’est pas secrète. C’est un changement de production : sur accord de Corentin seulement.

## Ce que `KLYRA_APP_URL` change

- **Réglages › Mobile** (`telephones:adresseApp`) : l’étape 1 montre l’adresse, son QR (`serveur/qr.mjs`, rendu en SVG) et « Copier l’adresse » ; les étapes 2 et 3 apparaissent. Sans elle : « L’adresse de KLYRA pour le téléphone n’est pas encore en ligne. »
- **La page relais du lien de connexion** (`convex/http.ts`) : une demande venue du téléphone ouvre `KLYRA_APP_URL/?code=…` au lieu de montrer le lien à coller.
- Une valeur qui n’est pas une adresse https est ignorée (`adresseApp`, `convex/model/contenus.ts`).

## Ce que la publication ne change pas

- Le téléphone écrit aux conversations par le compte, puis par le PC. Une conversation du VPS fait exception quand le PC est fermé et que ce téléphone est relié au VPS (Plus › Serveurs) : le téléphone envoie lui-même au VPS et lit la réponse ; le PC range l’échange dans la conversation à sa réouverture (`src/lib/telephone/vps-direct.ts`). L’adresse https du VPS doit accepter l’origine de l’app web (CORS du serveur, déjà ouvert).
- Le QR du terminal du VPS (`klyra://rejoindre`) ne s’ouvre toujours pas dans l’app web de l’iPhone.

## À vérifier sur l’iPhone de Corentin, après publication

Pose sur l’écran d’accueil depuis Safari, stockage séparé entre Safari et l’app posée (le lien ouvert dans Safari peut devoir être collé dans l’app), libellés exacts des menus, déconnexion à distance depuis Réglages › Mobile.
