/**
 * Computer Use : test des conversions capture ↔ écran (electron/ordinateur/coordonnees.ts),
 * sur des cas Retina, Windows à 150 % et plusieurs écrans. Node seul, sans Electron.
 *   pnpm build:electron && node scripts/test-coordonnees.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script Node en CommonJS */
const { tailleCapture, versEcran, versCapture, ecranDuPoint } = require("../dist-electron/ordinateur/coordonnees.js");

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const egal = (a, b) => a.x === b.x && a.y === b.y;

// MacBook Pro 16 pouces, Retina (×2) : 1728×1117 points.
const retina = { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, scaleFactor: 2 };
const tRetina = tailleCapture(retina);
verifier(tRetina.largeur === 1568 && tRetina.hauteur === 1014, `Retina 1728×1117 → capture ${tRetina.largeur}×${tRetina.hauteur}`);
verifier(egal(versEcran(retina, tRetina, { x: 0, y: 0 }), { x: 0, y: 0 }), "Retina : coin haut gauche");
verifier(egal(versEcran(retina, tRetina, { x: 1567, y: 1013 }), { x: 1727, y: 1116 }), "Retina : coin bas droit");
verifier(egal(versEcran(retina, tRetina, { x: 784, y: 507 }), { x: 864, y: 559 }), "Retina : centre");

// Windows, 2560×1440 pixels à 150 % : 1707×960 DIP (arrondi d'Electron).
const win150 = { id: 2, bounds: { x: 0, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 };
const tWin = tailleCapture(win150);
verifier(tWin.largeur === 1568 && tWin.hauteur === 882, `Windows 150 % → capture ${tWin.largeur}×${tWin.hauteur}`);
const allerRetour = [{ x: 10, y: 10 }, { x: 800, y: 441 }, { x: 1500, y: 870 }].every((p) => {
  const e = versEcran(win150, tWin, p);
  const c = versCapture(win150, tWin, e);
  return Math.abs(c.x - p.x) <= 1 && Math.abs(c.y - p.y) <= 1;
});
verifier(allerRetour, "Windows 150 % : aller-retour capture → écran → capture à 1 px près");

// Petit écran : jamais agrandi.
const petit = { id: 3, bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1 };
const tPetit = tailleCapture(petit);
verifier(tPetit.largeur === 1280 && tPetit.hauteur === 800, "1280×800 : capture à la même taille");
verifier(egal(versEcran(petit, tPetit, { x: 640, y: 400 }), { x: 640, y: 400 }), "1280×800 : 1 pour 1");

// Deux écrans : le second à droite et plus haut (coordonnées négatives).
const second = { id: 4, bounds: { x: 1728, y: -200, width: 1920, height: 1080 }, scaleFactor: 1 };
const tSecond = tailleCapture(second);
verifier(egal(versEcran(second, tSecond, { x: 0, y: 0 }), { x: 1728, y: -200 }), "second écran : origine décalée, y négatif");
verifier(ecranDuPoint([retina, second], { x: 2000, y: 0 }).id === 4, "le point (2000, 0) est sur le second écran");
verifier(ecranDuPoint([retina, second], { x: 5000, y: 5000 }).id === 4, "hors de tout écran : le plus proche");
verifier(egal(versEcran(retina, tRetina, { x: -50, y: 99999 }), { x: 0, y: 1116 }), "hors de la capture : ramené au bord");

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
