/**
 * La fenêtre isolée, sans l'app entière : origine propre, pas de pont, pas de réseau.
 * Écrit deux PNG si KLYRA_CAPTURES est un dossier (la fenêtre, puis la vignette).
 *   pnpm build:electron && xvfb-run -a electron scripts/test-fenetre-document.cjs --no-sandbox
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app, BrowserWindow, protocol } = require("electron");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PRIVILEGE_SCHEMA, SCHEMA } = require("../dist-electron/document-isole.js");
protocol.registerSchemesAsPrivileged([PRIVILEGE_SCHEMA]);
/* Sans fenêtre principale, fermer la vignette quitterait l'app et ferait échouer la page suivante. */
app.on("window-all-closed", () => {});

const CAPTURES = process.env.KLYRA_CAPTURES;
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-fenetre-document-"));
app.setPath("userData", path.join(TMP, "userdata"));
app.setName("KLYRA");

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>KLYRA isolé</title>
<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#1c3d32;color:#f6f1e7;font:600 48px "Georgia",serif}</style>
</head><body>Fenêtre isolée<script>
window.__reseau = fetch("https://example.invalid/x").then(() => "ouvert", () => "bloque");
</script></body></html>`;

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};

app.whenReady().then(async () => {
  const { ouvrirHtml, vignetteHtml } = require("../dist-electron/fenetre-document.js");
  try {
    const vignette = await vignetteHtml("document-essai:1", HTML, true);
    verifier(typeof vignette === "string" && vignette.startsWith("data:image/png;base64,"), "la vignette est un PNG");
    if (CAPTURES && vignette) {
      mkdirSync(CAPTURES, { recursive: true });
      writeFileSync(path.join(CAPTURES, "vignette.png"), Buffer.from(vignette.slice("data:image/png;base64,".length), "base64"));
    }

    await ouvrirHtml(HTML, "Page de l’équipe");
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith(`${SCHEMA}://`));
    verifier(!!win, "une fenêtre s’ouvre sur l’origine du document");
    if (!win) throw new Error("pas de fenêtre");
    const url = win.webContents.getURL();
    verifier(url.startsWith(`${SCHEMA}://`) && !url.includes("convex") && !url.includes("http"), "l’adresse affichée n’est pas celle du stockage");
    const lu = await win.webContents.executeJavaScript(`(async () => ({
      origine: location.origin,
      protocole: location.protocol,
      texte: document.body.innerText,
      pont: typeof window.klyra,
      node: typeof process,
      reseau: await window.__reseau,
    }))()`);
    verifier(lu.protocole === `${SCHEMA}:`, "le document a sa propre origine");
    verifier(lu.texte.includes("Fenêtre isolée"), "la page s’affiche");
    verifier(lu.pont === "undefined" && lu.node === "undefined", "pas de pont vers l’app, pas de Node");
    verifier(lu.reseau === "bloque", "le document ne joint pas le réseau");
    if (CAPTURES) {
      const image = await win.webContents.capturePage();
      writeFileSync(path.join(CAPTURES, "fenetre.png"), image.toPNG());
    }
    win.destroy();
  } catch (e) {
    console.error(e);
    echecs.push(e instanceof Error ? e.message : String(e));
  }
  console.log(echecs.length ? `\n${echecs.length} échec(s)` : "\nFenêtre isolée : tout passe.");
  app.exit(echecs.length ? 1 : 0);
});
