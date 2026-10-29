import { app, Notification, net } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Mises à jour : à chaque push sur main, une action GitHub publie l'app (Mac et
 * Windows) dans le dépôt public pelin-klyra/klyra-app-versions (l'app seule, pas
 * le code). L'app regarde la dernière version au démarrage puis toutes les heures,
 * la télécharge, vérifie son empreinte, et l'installe quand on la quitte (ou tout
 * de suite, d'un clic sur la notification).
 *
 * Sans compte Apple Developer, le système de mise à jour d'Electron (Squirrel)
 * refuserait l'app sur Mac : on la remplace nous-mêmes, après avoir vérifié sa
 * signature et son identifiant. Sous Windows, c'est l'installateur qui s'en charge.
 */

const DERNIERE = "https://api.github.com/repos/pelin-klyra/klyra-app-versions/releases/latest";
const IDENTIFIANT = "design.klyra.app";
const INTERVALLE_MS = 60 * 60 * 1000;
const DOSSIER = path.join(os.homedir(), ".klyra", "maj");
const WINDOWS = process.platform === "win32";
/** Le fichier de la version pour ce système, et la fiche qui donne son empreinte. */
const FICHIER = WINDOWS ? "-win-x64-setup.exe" : "-arm64-mac.zip";
const FICHE = WINDOWS ? "latest.yml" : "latest-mac.yml";

/** La nouvelle version, téléchargée et vérifiée : l'app (Mac) ou l'installateur (Windows). */
let prete: { version: string; chemin: string } | null = null;
let enCours = false;

/** « 0.1.42 » > « 0.1.9 » : comparaison nombre par nombre. */
function plusRecente(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
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

/** Le dossier KLYRA.app en cours d'exécution (Mac). */
function appInstallee(): string {
  return path.resolve(process.execPath, "..", "..", "..");
}

async function verifier() {
  if (enCours || prete) return;
  enCours = true;
  try {
    const reponse = await net.fetch(DERNIERE, { headers: { Accept: "application/vnd.github+json" } });
    if (!reponse.ok) return;
    const version = (await reponse.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const numero = version.tag_name?.replace(/^v/, "");
    const fichier = version.assets?.find((a) => a.name.endsWith(FICHIER));
    const fiche = version.assets?.find((a) => a.name === FICHE);
    if (!numero || !fichier || !fiche || !plusRecente(numero, app.getVersion())) return;

    // L'empreinte publiée avec la version : un fichier abîmé ou remplacé est refusé.
    const empreinte = (await telecharger(fiche.browser_download_url))?.toString("utf8").match(/^sha512: (\S+)$/m)?.[1];
    const contenu = await telecharger(fichier.browser_download_url);
    if (!empreinte || !contenu || createHash("sha512").update(contenu).digest("base64") !== empreinte) return;

    await rm(DOSSIER, { recursive: true, force: true });
    await mkdir(DOSSIER, { recursive: true });
    const archive = path.join(DOSSIER, fichier.name);
    await writeFile(archive, contenu);

    if (WINDOWS) {
      prete = { version: numero, chemin: archive };
    } else {
      await lancer("/usr/bin/ditto", ["-x", "-k", archive, DOSSIER]);
      const nom = (await readdir(DOSSIER)).find((n) => n.endsWith(".app"));
      if (!nom) return;
      const nouvelle = path.join(DOSSIER, nom);
      // Une app intacte (signature valide) et la nôtre (même identifiant), sinon rien.
      await lancer("/usr/bin/codesign", ["--verify", "--deep", nouvelle]);
      const id = (await lancer("/usr/bin/defaults", ["read", path.join(nouvelle, "Contents", "Info"), "CFBundleIdentifier"])).trim();
      if (id !== IDENTIFIANT) return;
      prete = { version: numero, chemin: nouvelle };
    }

    if (Notification.isSupported()) {
      const notif = new Notification({
        title: `KLYRA ${numero} est prête`,
        body: "Elle s’installera quand tu quitteras l’app. Clique pour l’installer maintenant.",
      });
      notif.on("click", () => installerMaintenant());
      notif.show();
    }
  } catch {
    /* hors ligne, GitHub indisponible… on réessaiera à la prochaine vérification */
  } finally {
    enCours = false;
  }
}

/** Installe la nouvelle version une fois l'app fermée ; la rouvre si demandé. */
function remplacer(rouvrir: boolean) {
  if (!prete) return;
  if (WINDOWS) {
    // L'installateur, en silence : il attend la fermeture de l'app, remplace, et la relance avec --force-run.
    spawn(prete.chemin, ["/S", ...(rouvrir ? ["--force-run"] : [])], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else {
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

function installerMaintenant() {
  remplacer(true);
  app.quit();
}

/** À appeler une fois l'app prête : rien en développement. */
export function demarrerMisesAJour() {
  if (!app.isPackaged) return;
  setTimeout(() => void verifier(), 10_000);
  setInterval(() => void verifier(), INTERVALLE_MS);
  app.on("will-quit", () => remplacer(false));
}
