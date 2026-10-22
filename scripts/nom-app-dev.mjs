// En développement, macOS affiche le nom du paquet Electron (« Electron ») dans
// le Dock et la barre de menus. Ce script le renomme « KLYRA » dans la copie
// d'Electron installée sur ce poste (node_modules). Lancé après chaque
// `pnpm install` ; sans effet hors macOS. La version installable aura son nom.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

if (process.platform !== "darwin") process.exit(0);

const require = createRequire(import.meta.url);
const binaire = require("electron");
const plist = path.join(path.dirname(path.dirname(binaire)), "Info.plist");
if (!existsSync(plist)) process.exit(0);

for (const cle of ["CFBundleName", "CFBundleDisplayName"]) {
  try {
    execFileSync("plutil", ["-replace", cle, "-string", "KLYRA", plist]);
  } catch {
    execFileSync("plutil", ["-insert", cle, "-string", "KLYRA", plist]);
  }
}
console.log("Electron renommé KLYRA pour le développement.");
