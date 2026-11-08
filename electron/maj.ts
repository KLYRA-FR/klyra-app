import { app, Notification, net } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lireFiche, messageDepot, passager, plusRecente, relanceApres } from "./maj-depot";
import { lireReglages, notificationPermise } from "./reglages";

/**
 * Mises à jour : à chaque push sur main, une action GitHub publie l'app (Mac et
 * Windows) dans le dépôt public KLYRA-FR/klyra-app-versions (l'app seule, pas
 * le code). L'app regarde la dernière version au démarrage puis toutes les heures,
 * la télécharge, vérifie son empreinte, et l'installe quand on la quitte (ou tout
 * de suite, d'un clic sur la notification).
 *
 * Sans compte Apple Developer, le système de mise à jour d'Electron (Squirrel)
 * refuserait l'app sur Mac : on la remplace nous-mêmes, après avoir vérifié sa
 * signature et son identifiant. Sous Windows, c'est l'installateur qui s'en charge.
 *
 * L'API de GitHub répond parfois 5xx ou limite un réseau : l'app lit alors la fiche de
 * la dernière version (`latest.yml`) sur github.com, et après un échec passager
 * réessaie au bout de quelques minutes plutôt que d'attendre l'heure (`maj-depot.ts`).
 */

const DEPOT = "KLYRA-FR/klyra-app-versions";
/*
 * Tests seulement : `KLYRA_MAJ_URL` remplace l'adresse de la dernière version
 * (un faux dépôt local) et active les mises à jour hors de l'app installée.
 * Ignorée dans l'app installée.
 */
const URL_TEST = app.isPackaged ? undefined : process.env.KLYRA_MAJ_URL;
const DERNIERE = URL_TEST ?? `https://api.github.com/repos/${DEPOT}/releases/latest`;
/* Le secours : la fiche et les fichiers de la dernière version, servis par github.com (hors de l'API). */
const SECOURS = (app.isPackaged ? undefined : process.env.KLYRA_MAJ_SECOURS) ?? (URL_TEST ? null : `https://github.com/${DEPOT}/releases`);
const ACTIVES = app.isPackaged || !!URL_TEST;
const IDENTIFIANT = "design.klyra.app";
const INTERVALLE_MS = 60 * 60 * 1000;
const DOSSIER = path.join(os.homedir(), ".klyra", "maj");
const WINDOWS = process.platform === "win32";
const MAC = process.platform === "darwin";
/** Le fichier de la version pour ce système, et la fiche qui donne son empreinte. */
const FICHIER = MAC ? "-arm64-mac.zip" : "-win-x64-setup.exe";
const FICHE = MAC ? "latest-mac.yml" : "latest.yml";

/** La nouvelle version, téléchargée et vérifiée : l'app (Mac) ou l'installateur (Windows). */
let prete: { version: string; chemin: string } | null = null;
let enCours = false;
/* Les échecs passagers d'affilée, et la relance rapide qui suit le dernier. */
let echecsPassagers = 0;
let relance: ReturnType<typeof setTimeout> | null = null;

/** Ce que les Réglages et le rail affichent : où en est la mise à jour. */
export interface EtatMaj {
  version: string;
  /** « dev » : pas de mise à jour hors de l'app installée. */
  statut: "dev" | "inconnu" | "verification" | "telechargement" | "a-jour" | "prete" | "erreur";
  /** La version prête à installer. */
  nouvelle: string | null;
  /** La dernière version publiée, vue à la dernière vérification. */
  disponible: string | null;
  /** Pendant le téléchargement : octets reçus et total (0 si inconnu). */
  progression: { recus: number; total: number } | null;
  verifieeLe: number | null;
  erreur: string | null;
  depot: string;
}

let derniere: Pick<EtatMaj, "statut" | "verifieeLe" | "erreur" | "disponible"> = { statut: "inconnu", verifieeLe: null, erreur: null, disponible: null };
let progression: EtatMaj["progression"] = null;

export function etatMaj(): EtatMaj {
  const statut = !ACTIVES ? "dev" : prete ? "prete" : progression ? "telechargement" : enCours ? "verification" : derniere.statut;
  return {
    version: app.getVersion(),
    statut,
    nouvelle: prete?.version ?? null,
    disponible: derniere.disponible,
    progression,
    verifieeLe: derniere.verifieeLe,
    erreur: statut === "erreur" ? derniere.erreur : null,
    depot: `https://github.com/${DEPOT}/releases`,
  };
}

/* L'interface suit l'état en direct (rail, Réglages) : prévenue à chaque changement. */
const abonnes = new Set<(etat: EtatMaj) => void>();
let dernierEnvoi = 0;
function prevenir(forcer = true) {
  // Pendant un téléchargement, au plus quatre fois par seconde.
  if (!forcer && Date.now() - dernierEnvoi < 250) return;
  dernierEnvoi = Date.now();
  const etat = etatMaj();
  abonnes.forEach((f) => f(etat));
}
export function surEtatMaj(f: (etat: EtatMaj) => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

function lancer(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000 }, (erreur, sortie, stderr) => (erreur ? reject(new Error(stderr || erreur.message)) : resolve(sortie)));
  });
}

async function telecharger(url: string): Promise<Buffer | null> {
  const reponse = await net.fetch(url);
  return reponse.ok ? Buffer.from(await reponse.arrayBuffer()) : null;
}

/** Télécharge en suivant la progression, que l'interface affiche. */
async function telechargerAvecProgression(url: string): Promise<Buffer | null> {
  const reponse = await net.fetch(url);
  if (!reponse.ok || !reponse.body) return null;
  const total = Number(reponse.headers.get("content-length")) || 0;
  const morceaux: Uint8Array[] = [];
  let recus = 0;
  progression = { recus, total };
  prevenir();
  const lecteur = reponse.body.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    recus += value.byteLength;
    progression = { recus, total };
    prevenir(false);
  }
  return Buffer.concat(morceaux);
}

/** Le dossier KLYRA.app en cours d'exécution (Mac). */
function appInstallee(): string {
  return path.resolve(process.execPath, "..", "..", "..");
}

/** La dernière version publiée : son numéro, l'app pour ce système, sa fiche (ou l'empreinte lue dans la fiche). */
type Trouvee = {
  numero: string;
  fichier: { name: string; browser_download_url: string } | undefined;
  fiche: { name: string; browser_download_url: string } | undefined;
  empreinte?: string;
};

/**
 * Par l'API de GitHub d'abord ; si elle échoue (hors ligne, 5xx, limite), par la fiche de la
 * dernière version sur github.com. `statut` : l'échec à montrer (null : injoignable).
 */
async function derniereVersion(): Promise<Trouvee | { statut: number | null } | { message: string }> {
  let statut: number | null = null;
  let reponse: Response | null = null;
  try {
    reponse = await net.fetch(DERNIERE, { headers: { Accept: "application/vnd.github+json" } });
    statut = reponse.status;
  } catch {
    /* hors ligne, ou GitHub injoignable : on tente la fiche */
  }
  if (reponse?.ok) {
    const version = (await reponse.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const numero = version.tag_name?.replace(/^v/, "");
    if (!numero) return { message: "La dernière version publiée n’a pas de numéro : elle est ignorée." };
    return { numero, fichier: version.assets?.find((a) => a.name.endsWith(FICHIER)), fiche: version.assets?.find((a) => a.name === FICHE) };
  }
  /* Un dépôt introuvable l'est aussi pour la fiche ; un autre échec de l'API, on tente la fiche. */
  if (!SECOURS || statut === 404 || (statut !== null && !passager(statut))) return { statut };
  try {
    const reponse = await net.fetch(`${SECOURS}/latest/download/${FICHE}`);
    if (!reponse.ok) return { statut: statut ?? reponse.status };
    const lue = lireFiche(await reponse.text(), FICHIER);
    if (!lue) return { statut: statut ?? reponse.status };
    const url = `${SECOURS}/download/v${lue.version}/${encodeURIComponent(lue.fichier)}`;
    return { numero: lue.version, fichier: { name: lue.fichier, browser_download_url: url }, fiche: undefined, empreinte: lue.empreinte };
  } catch {
    return { statut };
  }
}

/** Une vérification de plus dans quelques minutes, après un échec passager. */
function relancerDans(minutes: number) {
  if (relance) clearTimeout(relance);
  relance = setTimeout(() => {
    relance = null;
    void verifier();
  }, minutes * 60_000);
}

async function verifier() {
  if (enCours || prete) return;
  enCours = true;
  prevenir();
  /* Par défaut, une vérification qui s'arrête en route n'a rien trouvé à installer. */
  derniere = { statut: "a-jour", verifieeLe: Date.now(), erreur: null, disponible: derniere.disponible };
  const echec = (erreur: string) => (derniere = { ...derniere, statut: "erreur", verifieeLe: Date.now(), erreur });
  try {
    const trouvee = await derniereVersion();
    if ("message" in trouvee) return echec(trouvee.message);
    if ("statut" in trouvee) {
      const estPassager = passager(trouvee.statut);
      const minutes = estPassager ? relanceApres(echecsPassagers) : null;
      if (estPassager) {
        echecsPassagers++;
        if (minutes !== null) relancerDans(minutes);
      }
      return echec(messageDepot(DEPOT, trouvee.statut, minutes));
    }
    echecsPassagers = 0;
    const { numero, fichier, fiche, empreinte: empreinteFiche } = trouvee;
    derniere.disponible = numero;
    if (!plusRecente(numero, app.getVersion())) return;
    if (!fichier || (!fiche && !empreinteFiche)) return echec(`La version ${numero} ne contient pas encore l’app pour ce système.`);

    // L'empreinte publiée avec la version : un fichier abîmé ou remplacé est refusé.
    const empreinte = empreinteFiche ?? (fiche ? (await telecharger(fiche.browser_download_url))?.toString("utf8").match(/^sha512: (\S+)$/m)?.[1] : undefined);
    const contenu = await telechargerAvecProgression(fichier.browser_download_url).finally(() => (progression = null));
    if (!empreinte || !contenu || createHash("sha512").update(contenu).digest("base64") !== empreinte) {
      return echec(`La version ${numero} n’a pas passé le contrôle d’intégrité : elle n’est pas installée.`);
    }

    await rm(DOSSIER, { recursive: true, force: true });
    await mkdir(DOSSIER, { recursive: true });
    const archive = path.join(DOSSIER, fichier.name);
    await writeFile(archive, contenu);

    if (!MAC) {
      prete = { version: numero, chemin: archive };
    } else {
      await lancer("/usr/bin/ditto", ["-x", "-k", archive, DOSSIER]);
      const nom = (await readdir(DOSSIER)).find((n) => n.endsWith(".app"));
      if (!nom) return echec(`L’archive de la version ${numero} ne contient pas l’app.`);
      const nouvelle = path.join(DOSSIER, nom);
      // Une app intacte (signature valide) et la nôtre (même identifiant), sinon rien.
      await lancer("/usr/bin/codesign", ["--verify", "--deep", nouvelle]);
      // Signée par notre certificat : la nouvelle version doit l'être par le même (exigence désignée de l'app installée).
      const exigence = (await lancer("/usr/bin/codesign", ["--display", "--requirements", "-", appInstallee()]).catch(() => ""))
        .split("\n")
        .find((l) => l.startsWith("designated => "))
        ?.replace("designated => ", "");
      if (exigence?.includes("certificate")) {
        await lancer("/usr/bin/codesign", ["--verify", "--deep", `-R=${exigence}`, nouvelle]).catch(() => {
          throw new Error(`La version ${numero} n’est pas signée par le certificat de KLYRA : elle n’est pas installée.`);
        });
      }
      const id = (await lancer("/usr/bin/defaults", ["read", path.join(nouvelle, "Contents", "Info"), "CFBundleIdentifier"])).trim();
      if (id !== IDENTIFIANT) return echec(`La version ${numero} ne porte pas l’identifiant de KLYRA : elle n’est pas installée.`);
      prete = { version: numero, chemin: nouvelle };
    }

    if (Notification.isSupported() && notificationPermise("majPrete")) {
      const notif = new Notification({
        title: `KLYRA ${numero} est prête`,
        body: "Elle s’installera quand tu quitteras l’app. Clique pour l’installer maintenant.",
        silent: !lireReglages().notifications.son,
      });
      notif.on("click", () => installerMaintenant());
      notif.show();
    }
  } catch (erreur) {
    /* hors ligne, GitHub indisponible… on réessaiera à la prochaine vérification */
    echec(erreur instanceof Error ? erreur.message : "Vérification impossible (hors ligne ?).");
  } finally {
    enCours = false;
    progression = null;
    prevenir();
  }
}

/** « Rechercher maintenant », depuis les Réglages : attend la fin de la recherche. */
export async function verifierMaintenant(): Promise<EtatMaj> {
  if (!ACTIVES) return etatMaj();
  await verifier();
  return etatMaj();
}

/** Installe la nouvelle version une fois l'app fermée ; la rouvre si demandé. */
function remplacer(rouvrir: boolean) {
  if (!prete) return;
  if (WINDOWS) {
    // L'installateur, en silence : il attend la fermeture de l'app, remplace, et la relance avec --force-run.
    spawn(prete.chemin, ["/S", ...(rouvrir ? ["--force-run"] : [])], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (MAC) {
    const cible = appInstallee();
    if (!cible.endsWith(".app")) return;
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      `rm -rf "$CIBLE" && /usr/bin/ditto "$SOURCE" "$CIBLE" && rm -rf "$DOSSIER"`,
      rouvrir ? `/usr/bin/open "$CIBLE"` : "",
    ].join("\n");
    spawn("/bin/sh", ["-c", script], {
      detached: true,
      stdio: "ignore",
      env: { CIBLE: cible, SOURCE: prete.chemin, DOSSIER },
    }).unref();
  }
  prete = null;
}

/** Installe la version prête et relance l'app (notification ou Réglages). */
export function installerMaintenant() {
  if (!prete) throw new Error("Aucune version n’est prête à installer.");
  remplacer(true);
  app.quit();
}

/** À appeler une fois l'app prête : rien en développement (sauf faux dépôt de test). */
export function demarrerMisesAJour() {
  if (!ACTIVES) return;
  setTimeout(() => void verifier(), 10_000);
  setInterval(() => void verifier(), INTERVALLE_MS);
  app.on("will-quit", () => remplacer(false));
}
