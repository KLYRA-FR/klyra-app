/**
 * Computer Use, couche système : test de bout en bout dans Electron, sur un
 * dossier d'app temporaire. Une fenêtre de test (un bouton, un champ, une zone
 * qui défile) ; on la capture, on clique au centre du bouton, on tape, on
 * efface par un raccourci, on fait défiler — et la page dit ce qu'elle a reçu.
 *   pnpm build:electron && pnpm entrees && pnpm test:ordinateur
 * Sous Linux (pas une cible de l'app), seuls l'interrupteur et la capture sont testés.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-ordinateur-"));
app.setPath("userData", path.join(TMP, "donnees"));
app.setPath("sessionData", path.join(TMP, "session"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });
const ecrireReglages = (actif) => fs.writeFileSync(path.join(app.getPath("userData"), "reglages.json"), JSON.stringify({ computerUse: { actif } }));

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">
<button id="b" style="position:absolute;left:40px;top:40px;width:160px;height:60px" onclick="window.clics=(window.clics||0)+1">Cible</button>
<input id="t" style="position:absolute;left:40px;top:130px;width:300px;height:30px">
<div id="d" style="position:absolute;left:40px;top:190px;width:300px;height:120px;overflow:auto"><div style="height:2000px">défile</div></div>
</body>`;

app.whenReady().then(async () => {
  let fenetre = null;
  try {
    const garde = require("../dist-electron/ordinateur/garde.js");
    const capture = require("../dist-electron/ordinateur/capture.js");

    // 1. Interrupteur coupé : ni capture ni clic.
    ecrireReglages(false);
    let refus = 0;
    await capture.capturer().catch((e) => e instanceof garde.ComputerUseCoupe && refus++);
    const entreesDispo = process.platform === "darwin" || process.platform === "win32";
    const entrees = require("../dist-electron/ordinateur/entrees.js");
    await entrees.clic({ x: 10, y: 10 }).catch((e) => e instanceof garde.ComputerUseCoupe && refus++);
    verifier(refus === 2, "interrupteur coupé : capture et clic refusés");

    // L'interrupteur est lu une fois puis gardé en mémoire : on repart d'un process propre pour l'allumer.
    ecrireReglages(true);
    for (const k of Object.keys(require.cache)) if (k.includes("dist-electron")) delete require.cache[k];
    const capture2 = require("../dist-electron/ordinateur/capture.js");
    const entrees2 = require("../dist-electron/ordinateur/entrees.js");

    fenetre = new BrowserWindow({ x: 120, y: 120, width: 420, height: 360, show: true, alwaysOnTop: true, frame: false, webPreferences: { sandbox: true } });
    await fenetre.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    fenetre.focus();
    await pause(800);

    // 2. Capture : réduite, en JPEG.
    const c = await capture2.capturer();
    verifier(c.jpeg.length > 1000 && c.jpeg[0] === 0xff && c.jpeg[1] === 0xd8, `capture JPEG ${c.largeur}×${c.hauteur} (${Math.round(c.jpeg.length / 1024)} Ko)`);
    verifier(Math.max(c.largeur, c.hauteur) <= 1568, "capture au plus 1568 px de côté");

    if (!entreesDispo) {
      console.log("(clavier et souris : Mac et Windows seulement, non testés ici)");
    } else {
      const p = await entrees2.ping();
      verifier(p.version === 1, `klyra-entrees répond (version ${p.version}${p.accessibilite === undefined ? "" : `, accessibilité ${p.accessibilite}`})`);
      const page = (js) => fenetre.webContents.executeJavaScript(js);
      const contenu = fenetre.getContentBounds();
      const centre = async (sel) => {
        const r = await page(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        return { x: Math.round(contenu.x + r.x), y: Math.round(contenu.y + r.y) };
      };

      // 3. Clic au centre du bouton.
      await entrees2.clic(await centre("#b"));
      await pause(400);
      verifier((await page("window.clics || 0")) === 1, "clic reçu par le bouton");

      // 4. Frappe dans le champ, accents compris.
      await entrees2.clic(await centre("#t"));
      await pause(200);
      await entrees2.taper("Bonjour é");
      await pause(400);
      const valeur = await page("document.querySelector('#t').value");
      verifier(valeur === "Bonjour é", `texte tapé : « ${valeur} »`);

      // 5. Raccourci : tout sélectionner, puis effacer.
      await entrees2.touche([process.platform === "darwin" ? "cmd" : "ctrl", "a"]);
      await entrees2.touche(["retour"]);
      await pause(400);
      verifier((await page("document.querySelector('#t').value")) === "", "raccourci tout sélectionner + retour : champ vidé");

      // 6. Défilement dans la zone.
      await entrees2.defiler(await centre("#d"), 3);
      await pause(600);
      const haut = await page("document.querySelector('#d').scrollTop");
      verifier(haut > 0, `défilement reçu (scrollTop ${haut})`);

      await entrees2.relacherTout();
      entrees2.arreter();
    }
  } catch (e) {
    verifier(false, `exception : ${e && e.stack ? e.stack : e}`);
  } finally {
    fenetre?.destroy();
    console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
    try {
      fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      console.log(`(ménage incomplet : ${e.code ?? e.message})`);
    }
    app.exit(echecs.length ? 1 : 0);
  }
});
