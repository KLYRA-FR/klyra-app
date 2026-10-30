/**
 * Test des sons de l'app, dans Electron (le même Chromium que l'app) : chaque
 * thème a un son pour chaque événement, chacun se rend vite, s'entend, ne
 * sature pas et reste court ; les microinteractions sont brèves, plus basses
 * que l'envoi et distinctes entre elles ; le réglage des sons du système se
 * lit sans erreur. Tourne sous Linux, Mac et Windows.
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

const MICRO = ["clic", "ouvrir", "fermer", "selection"];
const EVENEMENTS = [...MICRO, "envoi", "fin-de-tache", "erreur", "notification", "dictee-debut", "dictee-fin", "maj-prete", "active", "desactive", "validation"];
const THEMES = ["chaleureux", "mecanique", "petillant", "clavier"];
/** Une microinteraction s'éteint (40 dB sous sa crête) en moins de ce temps. */
const AUDIBLE_MAX_MICRO = 0.2;
/** Deux sons d'un même thème qui se ressemblent plus que ça (corrélation) se confondraient. */
const RESSEMBLANCE_MAX = 0.9;
/**
 * Le rendu d'un son, au pire. L'app les rend à l'avance (precharger) : ce seuil n'attrape
 * qu'une recette démesurée. Les Mac Intel de la CI ont des à-coups de 400 ms sur un son de 40.
 */
const RENDU_MAX_MS = 1000;

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
  const ressemblances = [];
  for (const [theme, jeu] of Object.entries(JEUX)) {
    const mono = {};
    for (const [evenement, recette] of Object.entries(jeu)) {
      const debut = performance.now();
      const b = await rendre(recette, 48000);
      const ms = performance.now() - debut;
      let crete = 0;
      let nan = false;
      const m = new Float32Array(b.length);
      for (let c = 0; c < b.numberOfChannels; c++)
        b.getChannelData(c).forEach((v, i) => {
          if (Number.isNaN(v)) nan = true;
          crete = Math.max(crete, Math.abs(v));
          m[i] += v / b.numberOfChannels;
        });
      // Audible : jusqu'au dernier échantillon à moins de 40 dB sous la crête.
      let dernier = 0;
      for (let i = 0; i < m.length; i++) if (Math.abs(m[i]) > crete * 0.01) dernier = i;
      // Niveau efficace sur les 120 ms les plus fortes (comme synthese.ts).
      const fenetre = Math.round(0.12 * b.sampleRate);
      let somme = 0;
      let meilleur = 0;
      for (let i = 0; i < m.length; i++) {
        somme += m[i] * m[i];
        if (i >= fenetre) somme -= m[i - fenetre] * m[i - fenetre];
        meilleur = Math.max(meilleur, somme);
      }
      mono[evenement] = m;
      sons.push({ theme, evenement, duree: b.duration, audible: dernier / b.sampleRate, efficace: Math.sqrt(meilleur / fenetre), canaux: b.numberOfChannels, crete, nan, ms });
    }
    // Les microinteractions, entre elles et face aux interrupteurs (les plus proches d'elles).
    const proches = ["clic", "ouvrir", "fermer", "selection", "active", "desactive"];
    for (let i = 0; i < MICROINTERACTIONS.length; i++)
      for (let j = i + 1; j < proches.length; j++) {
        const a = mono[proches[i]];
        const z = mono[proches[j]];
        let ab = 0, aa = 0, zz = 0;
        for (let k = 0; k < Math.max(a.length, z.length); k++) {
          const x = a[k] ?? 0, y = z[k] ?? 0;
          ab += x * y; aa += x * x; zz += y * y;
        }
        ressemblances.push({ theme, a: proches[i], b: proches[j], r: Math.abs(ab) / Math.sqrt(aa * zz) });
      }
  }
  return { sons, ressemblances, titres: THEMES.map((t) => t.id), micro: [...MICROINTERACTIONS] };
})()`;

let fenetre = null;

async function tester() {
  fenetre = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await fenetre.loadURL("data:text/html,<meta charset=utf-8><title>sons</title>");
  // Le « 0 » final : executeJavaScript renvoie la dernière valeur, qui doit pouvoir être copiée.
  await fenetre.webContents.executeJavaScript(
    `${script("src/lib/sons/synthese.ts")}\n${script("src/lib/sons/themes.ts")}\nwindow.JEUX = JEUX; window.rendre = rendre; window.THEMES = THEMES; window.MICROINTERACTIONS = MICROINTERACTIONS; 0;`,
  );
  const { sons, ressemblances, titres, micro } = await fenetre.webContents.executeJavaScript(RENDU);

  verifier(JSON.stringify(titres) === JSON.stringify(["silence", ...THEMES]), `les cartes : ${titres.join(", ")}`);
  verifier(JSON.stringify(micro) === JSON.stringify(MICRO), `les microinteractions : ${micro.join(", ")}`);
  for (const theme of THEMES) {
    const presents = sons.filter((s) => s.theme === theme).map((s) => s.evenement);
    verifier(EVENEMENTS.every((e) => presents.includes(e)) && presents.length === EVENEMENTS.length, `${theme} : un son pour chacun des ${EVENEMENTS.length} événements`);
  }
  const db = (v) => (20 * Math.log10(v)).toFixed(1);
  for (const s of sons) {
    const ok = !s.nan && s.canaux === 2 && s.crete > 0.05 && s.crete <= 0.9 && s.duree < 2.5 && s.ms < RENDU_MAX_MS;
    verifier(ok, `${s.theme}/${s.evenement} : ${s.duree.toFixed(2)} s, crête ${db(s.crete)} dBFS, rendu en ${s.ms.toFixed(0)} ms`);
  }
  for (const s of sons.filter((s) => MICRO.includes(s.evenement))) {
    const envoi = sons.find((e) => e.theme === s.theme && e.evenement === "envoi");
    verifier(s.audible < AUDIBLE_MAX_MICRO, `${s.theme}/${s.evenement} : bref, audible ${(s.audible * 1000).toFixed(0)} ms`);
    verifier(s.efficace < envoi.efficace, `${s.theme}/${s.evenement} : plus bas que l'envoi (${db(s.efficace)} contre ${db(envoi.efficace)} dBFS)`);
  }
  for (const r of ressemblances) verifier(r.r < RESSEMBLANCE_MAX, `${r.theme} : ${r.a} et ${r.b} distincts (ressemblance ${r.r.toFixed(2)})`);

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
