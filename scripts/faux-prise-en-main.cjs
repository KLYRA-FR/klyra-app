/* eslint-disable @typescript-eslint/no-require-imports -- Harnais Electron, jamais livré dans l'app. */
const { shell } = require("electron");
const { appendFileSync } = require("node:fs");
const path = require("node:path");
if (!process.env.KLYRA_TEST_PRISE_JOURNAL || !process.env.KLYRA_USER_DATA) throw new Error("Profil de test requis.");
// Le vrai IPC et le vrai adaptateur Codex sont utilisés. Seule l'ouverture externe de la
// connexion factice est interceptée : aucun navigateur ni compte réel n'est sollicité.
shell.openExternal = async (adresse) => {
  const url = new URL(adresse);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/connexion-factice") throw new Error("Connexion extérieure interdite dans ce test.");
  appendFileSync(process.env.KLYRA_TEST_PRISE_JOURNAL, "connexion-factice-ouverte\n");
};
require(path.join(__dirname, "..", "dist-electron", "main.js"));
