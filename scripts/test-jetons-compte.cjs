/**
 * Les jetons de session du compte d'équipe (electron/compte.ts), dans Electron, avec le
 * vrai safeStorage, sur un dossier temporaire : jamais les vraies données.
 * Une écriture ratée (fichier verrouillé par un antivirus sous Windows, disque plein…)
 * ou une entrée illisible ne doit jamais faire perdre la session au redémarrage suivant.
 *   pnpm build:electron && pnpm test:jetons-compte      (Linux : xvfb-run -a … -- --no-sandbox)
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-jetons-"));
app.setPath("userData", DONNEES);
app.setPath("sessionData", path.join(DONNEES, "session"));
const FICHIER = path.join(DONNEES, "compte.json");
const MODULE = path.join(__dirname, "..", "dist-electron", "compte.js");

/* Les clés que Convex Auth écrit pour un déploiement (cf. `useNamespacedStorage`). */
const JWT = "__convexAuthJWT_httpscalculatingcuttlefish710euwest1convexcloud";
const RAFRAICHISSEMENT = "__convexAuthRefreshToken_httpscalculatingcuttlefish710euwest1convexcloud";

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le module tel qu'au lancement de l'app : rien en mémoire, le fichier relu. */
function relancer() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

/** Ce qu'un redémarrage relirait : le fichier, déchiffré par le trousseau. */
function surDisque() {
  if (!fs.existsSync(FICHIER)) return {};
  const brut = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
  return Object.fromEntries(
    Object.entries(brut).map(([cle, valeur]) => {
      try {
        return [cle, safeStorage.decryptString(Buffer.from(valeur, "base64"))];
      } catch {
        return [cle, `(illisible) ${valeur}`];
      }
    }),
  );
}

/** Attend que le fichier reprenne ce qui est en mémoire (une écriture réessayée), 5 s au plus. */
async function quandSurDisque(cle, valeur) {
  for (let i = 0; i < 50 && surDisque()[cle] !== valeur; i++) await attendre(100);
  return surDisque()[cle] === valeur;
}

async function essais() {
  /* Linux sans trousseau (CI) : le chiffrement de secours de Chromium, pour ce test seulement. */
  if (process.platform === "linux" && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage indisponible : le test ne peut pas tourner.");

  /* 1. Une écriture ratée, puis le disque redevient disponible : la session sur le disque rattrape la mémoire.
        C'est le cas qui déconnectait : Convex Auth écrit le jeton d'accès puis le jeton de rafraîchissement ;
        si le second ne part pas, le disque garde un jeton de rafraîchissement que le serveur a déjà remplacé. */
  let compte = relancer();
  await compte.ecrireJeton(JWT, "acces-1");
  await compte.ecrireJeton(RAFRAICHISSEMENT, "rafraichissement-1");
  verifier(surDisque()[RAFRAICHISSEMENT] === "rafraichissement-1", "une session écrite est sur le disque");

  fs.mkdirSync(`${FICHIER}.tmp`); // le fichier temporaire ne peut plus être écrit
  await compte.ecrireJeton(JWT, "acces-2").catch(() => {});
  fs.rmSync(`${FICHIER}.tmp`, { recursive: true, force: true });
  let refusee = false;
  await compte.ecrireJeton(RAFRAICHISSEMENT, "rafraichissement-2").catch(() => (refusee = true));
  verifier(!refusee, "après une écriture ratée, l'écriture suivante n'est pas refusée");
  verifier(await quandSurDisque(RAFRAICHISSEMENT, "rafraichissement-2"), "après une écriture ratée, le disque reçoit le dernier jeton de rafraîchissement");
  verifier(surDisque()[JWT] === "acces-2", "après une écriture ratée, le disque reçoit aussi le dernier jeton d'accès");
  compte = relancer();
  verifier(compte.lireJeton(RAFRAICHISSEMENT) === "rafraichissement-2", "au redémarrage, l'app relit le dernier jeton de rafraîchissement");

  /* 2. Le fichier verrouillé un instant (antivirus ou indexation sous Windows : EPERM sur le renommage). */
  const renommer = fsp.rename;
  let refus = 2;
  fsp.rename = async (...args) => {
    if (refus > 0 && String(args[1]) === FICHIER) {
      refus--;
      throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    }
    return renommer(...args);
  };
  refusee = false;
  await compte.ecrireJeton(RAFRAICHISSEMENT, "rafraichissement-3").catch(() => (refusee = true));
  verifier(!refusee, "fichier verrouillé un instant : l'écriture n'est pas refusée");
  verifier(await quandSurDisque(RAFRAICHISSEMENT, "rafraichissement-3"), "fichier verrouillé un instant : le jeton finit sur le disque");
  fsp.rename = renommer;
  await compte.ecrireJeton(JWT, "acces-4");
  verifier(surDisque()[JWT] === "acces-4", "les écritures suivantes partent normalement");

  /* 3. Une entrée illisible (chiffrée par un autre trousseau, abîmée) : les autres restent lues et gardées. */
  const brut = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
  brut.__convexAuthJWT_httpcoordinatedox134euwest1convexcloud = Buffer.from("pas chiffré par ce trousseau").toString("base64");
  fs.writeFileSync(FICHIER, JSON.stringify(brut));
  compte = relancer();
  verifier(compte.lireJeton(RAFRAICHISSEMENT) === "rafraichissement-3", "une entrée illisible n'efface pas la session lisible");
  await compte.ecrireJeton(JWT, "acces-5");
  const apres = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
  verifier(
    apres.__convexAuthJWT_httpcoordinatedox134euwest1convexcloud === brut.__convexAuthJWT_httpcoordinatedox134euwest1convexcloud,
    "l'entrée illisible est gardée telle quelle sur le disque (relue si le trousseau la retrouve)",
  );
  verifier(surDisque()[RAFRAICHISSEMENT] === "rafraichissement-3" && surDisque()[JWT] === "acces-5", "la session lisible reste sur le disque après une nouvelle écriture");

  /* 4. Fichier abîmé (JSON coupé) : pas de session, mais aucune exception. */
  fs.writeFileSync(FICHIER, "{\"__convexAuthJWT_x");
  compte = relancer();
  verifier(compte.lireJeton(JWT) === null, "fichier abîmé : pas de session, sans erreur");

  /* 5. Se déconnecter retire les jetons du disque. */
  fs.rmSync(FICHIER, { force: true });
  compte = relancer();
  await compte.ecrireJeton(JWT, "acces-6");
  await compte.ecrireJeton(RAFRAICHISSEMENT, "rafraichissement-6");
  await compte.retirerJeton(JWT);
  await compte.retirerJeton(RAFRAICHISSEMENT);
  verifier(surDisque()[JWT] === undefined && surDisque()[RAFRAICHISSEMENT] === undefined, "se déconnecter retire les jetons du disque");
}

app
  .whenReady()
  .then(essais)
  .catch((e) => {
    console.error(e);
    echecs.push(String(e));
  })
  .finally(() => {
    fs.rmSync(DONNEES, { recursive: true, force: true });
    console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nTout passe.");
    app.exit(echecs.length ? 1 : 0);
  });
