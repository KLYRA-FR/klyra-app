/**
 * Test des sons de l'app, dans Electron (le même Chromium que l'app) : chaque
 * thème a un son pour chaque événement, chacun se rend vite, s'entend, ne
 * sature pas et reste court ; le réglage des sons du système se lit sans
 * erreur. Tourne sous Linux, Mac et Windows.
 *   pnpm build:electron && pnpm test:sons
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const RACINE = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-sons-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));

const EVENEMENTS = ["envoi", "fin-de-tache", "erreur", "notification", "dictee-debut", "dictee-fin", "maj-prete", "active", "desactive", "validation"];
const THEMES = ["chaleureux", "mecanique", "petillant", "clavier"];

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};

/** Les modules de synthèse, tels quels, en un seul script de page (leurs imports ne sont que des types). */
function script(fichier) {
  const source = fs.readFileSync(path.join(RACINE, fichier), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return js.replace(/^import .*$/gm, "").replace(/^export /gm, "");
}

const RENDU = `
(async () => {
  const sons = [];
  for (const [theme, jeu] of Object.entries(JEUX)) {
    for (const [evenement, recette] of Object.entries(jeu)) {
      const debut = performance.now();
      const b = await rendre(recette, 48000);
      const ms = performance.now() - debut;
      let crete = 0;
      let nan = false;
      for (let c = 0; c < b.numberOfChannels; c++)
        for (const v of b.getChannelData(c)) {
          if (Number.isNaN(v)) nan = true;
          crete = Math.max(crete, Math.abs(v));
        }
      sons.push({ theme, evenement, duree: b.duration, canaux: b.numberOfChannels, crete, nan, ms });
    }
  }
  return { sons, titres: THEMES.map((t) => t.id) };
})()`;

let fenetre = null;

async function tester() {
  fenetre = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await fenetre.loadURL("data:text/html,<meta charset=utf-8><title>sons</title>");
  // Le « 0 » final : executeJavaScript renvoie la dernière valeur, qui doit pouvoir être copiée.
  await fenetre.webContents.executeJavaScript(`${script("src/lib/sons/synthese.ts")}\n${script("src/lib/sons/themes.ts")}\nwindow.JEUX = JEUX; window.rendre = rendre; window.THEMES = THEMES; 0;`);
  const { sons, titres } = await fenetre.webContents.executeJavaScript(RENDU);

  verifier(JSON.stringify(titres) === JSON.stringify(["silence", ...THEMES]), `les cartes : ${titres.join(", ")}`);
  for (const theme of THEMES) {
    const presents = sons.filter((s) => s.theme === theme).map((s) => s.evenement);
    verifier(EVENEMENTS.every((e) => presents.includes(e)) && presents.length === EVENEMENTS.length, `${theme} : un son pour chacun des ${EVENEMENTS.length} événements`);
  }
  for (const s of sons) {
    const dbfs = 20 * Math.log10(s.crete);
    const ok = !s.nan && s.canaux === 2 && s.crete > 0.05 && s.crete <= 0.9 && s.duree < 2.5 && s.ms < 250;
    verifier(ok, `${s.theme}/${s.evenement} : ${s.duree.toFixed(2)} s, crête ${dbfs.toFixed(1)} dBFS, rendu en ${s.ms.toFixed(0)} ms`);
  }

  const { sonsCoupesParLeSysteme } = require("../dist-electron/reglages.js");
  const coupes = await sonsCoupesParLeSysteme();
  verifier(typeof coupes === "boolean", `sons de l'interface coupés par le système (${process.platform}) : ${coupes}`);
}

// Un test bloqué échoue vite, au lieu d'attendre la limite du job.
setTimeout(() => {
  console.log("ÉCHEC  le test n'a pas fini en 90 s.");
  app.exit(1);
}, 90_000).unref();

app.whenReady().then(async () => {
  try {
    await tester();
  } catch (erreur) {
    verifier(false, `exception : ${erreur instanceof Error ? erreur.stack : erreur}`);
  } finally {
    fenetre?.destroy();
    console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTous les sons passent.");
    // Sous Windows, Electron tient encore des fichiers du dossier de session : le ménage peut échouer.
    try {
      fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      console.log(`(ménage incomplet : ${e.code ?? e.message})`);
    }
    app.exit(echecs.length ? 1 : 0);
  }
});
