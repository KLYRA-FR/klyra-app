/* eslint-disable @typescript-eslint/no-require-imports -- Harnais Electron sur un profil temporaire. */
const { ipcMain, dialog } = require("electron");
const { appendFileSync } = require("node:fs");
const path = require("node:path");
if (!process.env.KLYRA_TEST_MODE_JOURNAL || !process.env.KLYRA_USER_DATA) throw new Error("Profil de test requis.");
if (process.env.KLYRA_TEST_MEMOIRE_DOCUMENT) {
  const ouvrir = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = (...args) => args.at(-1)?.title === "Importer des documents dans la mémoire"
    ? Promise.resolve({ canceled: false, filePaths: [process.env.KLYRA_TEST_MEMOIRE_DOCUMENT] }) : ouvrir(...args);
}
if (process.env.KLYRA_TEST_MEMOIRE_DOSSIER) {
  const ouvrir = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = (...args) => args.at(-1)?.title === "Connecter le dossier DIGITAL-OS à la mémoire"
    ? Promise.resolve({ canceled: false, filePaths: [process.env.KLYRA_TEST_MEMOIRE_DOSSIER] }) : ouvrir(...args);
}
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (canal, fn) => handle(canal, (event, ...args) => {
  // Uniquement les noms des appels, jamais leurs arguments ni des secrets.
  appendFileSync(process.env.KLYRA_TEST_MODE_JOURNAL, `${canal}\n`);
  return fn(event, ...args);
});
require(path.join(__dirname, "..", "dist-electron", "main.js"));
