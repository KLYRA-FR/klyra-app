/* eslint-disable @typescript-eslint/no-require-imports -- Harnais Electron CommonJS isolé. */
/**
 * Une fenêtre de navigateur sans app de bureau (pas de preload, donc pas de `window.klyra`),
 * pour piloter l'app web comme sur un téléphone. Utilisée par scripts/test-mobile.mjs.
 *   electron scripts/fenetre-web.cjs --remote-debugging-port=<port> <adresse> <dossier-jetable>
 */
const { app, BrowserWindow } = require("electron");

const [adresse, dossier] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (dossier) app.setPath("userData", dossier);

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

app.whenReady().then(() => {
  const fenetre = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  fenetre.webContents.setUserAgent(IPHONE);
  void fenetre.loadURL(adresse);
});
