/**
 * Les consignes d'un projet en un clic (electron/consignes-projet.ts, ConsignesProjet) dans l'app de
 * bureau, sur trois projets aux dossiers temporaires :
 * - vierge (package.json et verrou pnpm) : aperçu d'AGENTS.md (commandes devinées) et du CLAUDE.md qui
 *   l'importe, « Créer », les deux fichiers écrits ;
 * - avec son propre CLAUDE.md : « Annuler » ne touche à rien ; « Créer » ajoute l'import en tête et garde
 *   le reste ;
 * - déjà en place : pas d'aperçu, « Ouvrir AGENTS.md ».
 * Aucun agent n'est lancé. Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:consignes-projet          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-consignes-projet-"));
const DONNEES = path.join(TMP, "userdata");
mkdirSync(DONNEES, { recursive: true });
const dossier = (nom, fichiers = {}) => {
  const d = path.join(TMP, nom);
  mkdirSync(d, { recursive: true });
  for (const [f, contenu] of Object.entries(fichiers)) writeFileSync(path.join(d, f), contenu);
  return d;
};
const VIERGE = dossier("vierge", { "package.json": JSON.stringify({ scripts: { lint: "eslint", test: "vitest", dev: "next dev" } }), "pnpm-lock.yaml": "" });
const AVEC_CLAUDE = dossier("avec-claude", { "CLAUDE.md": "Mes règles à moi.\n" });
const EN_PLACE = dossier("en-place", { "AGENTS.md": "# Déjà là\n", "CLAUDE.md": "@AGENTS.md\n" });
const lire = (d, f) => (existsSync(path.join(d, f)) ? readFileSync(path.join(d, f), "utf8") : null);

const projet = (id, nom, folder) => ({ id, name: nom, subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder, files: [], updatedAt: new Date().toISOString() });
writeFileSync(
  path.join(DONNEES, "conversations.json"),
  JSON.stringify({ version: 1, chats: [], messages: [], projects: [projet("vierge", "Site du Bouchon", VIERGE), projet("avec-claude", "Outil interne", AVEC_CLAUDE), projet("en-place", "Projet rangé", EN_PLACE)] }),
);

const app = await lancerApp({ port: 9383, env: { HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES } });
const carte = () => app.ev(`(() => { const c = document.querySelector("[data-consignes-projet]"); return c && { etat: c.dataset.consignesProjet, texte: c.innerText, apercu: !!c.querySelector("[data-apercu-consignes]") }; })()`);
const cliquer = async (libelle) => {
  const ok = await app.ev(`(() => { const b = [...document.querySelectorAll("[data-consignes-projet] button")].find((x) => x.innerText.trim() === ${JSON.stringify(libelle)}); b?.click(); return !!b; })()`);
  if (!ok) throw new Error(`bouton introuvable : ${libelle}`);
  await attendre(800);
};
const ouvrir = async (id) => {
  await app.aller(`/projet?id=${id}`);
  await app.quand(`!!document.querySelector("[data-consignes-projet]")`, 15000).catch(() => {});
};

try {
  await ouvrir("vierge");
  let c = await carte();
  verifier(c?.etat === "a-ajouter" && /Pas encore de consignes/.test(c.texte), "projet vierge : la carte propose d’ajouter les consignes");
  await cliquer("Ajouter les consignes KLYRA");
  c = await carte();
  verifier(!!c?.apercu && /Créer AGENTS\.md/.test(c.texte) && /# Site du Bouchon/.test(c.texte) && /pnpm lint && pnpm test/.test(c.texte) && /Créer CLAUDE\.md/.test(c.texte), "l’aperçu montre AGENTS.md (commandes devinées) et le CLAUDE.md qui l’importe");
  verifier(lire(VIERGE, "AGENTS.md") === null, "rien n’est écrit avant « Créer »");
  await cliquer("Créer");
  c = await carte();
  verifier(c?.etat === "en-place" && /AGENTS\.md créé/.test(c.texte), "après « Créer » : consignes en place, invitation à remplir");
  verifier(/^# Site du Bouchon\n/.test(lire(VIERGE, "AGENTS.md") ?? "") && lire(VIERGE, "CLAUDE.md") === "@AGENTS.md\n", "les deux fichiers sont écrits");

  await ouvrir("avec-claude");
  await cliquer("Ajouter les consignes KLYRA");
  c = await carte();
  verifier(/Ajouter en tête de ton CLAUDE\.md/.test(c?.texte ?? ""), "avec son CLAUDE.md : l’aperçu dit qu’on ajoute seulement l’import en tête");
  await cliquer("Annuler");
  verifier(lire(AVEC_CLAUDE, "CLAUDE.md") === "Mes règles à moi.\n" && lire(AVEC_CLAUDE, "AGENTS.md") === null, "« Annuler » ne touche à rien");
  await cliquer("Ajouter les consignes KLYRA");
  await cliquer("Créer");
  verifier(lire(AVEC_CLAUDE, "CLAUDE.md") === "@AGENTS.md\n\nMes règles à moi.\n" && !!lire(AVEC_CLAUDE, "AGENTS.md"), "« Créer » : l’import en tête, le reste gardé, AGENTS.md créé");

  await ouvrir("en-place");
  c = await carte();
  verifier(c?.etat === "en-place" && /Ouvrir AGENTS\.md/.test(c.texte) && lire(EN_PLACE, "AGENTS.md") === "# Déjà là\n", "déjà en place : rien à ajouter, « Ouvrir AGENTS.md »");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page (${app.erreurs.join(" | ") || "aucune"})`);
} catch (erreur) {
  verifier(false, `parcours interrompu : ${erreur instanceof Error ? erreur.message : erreur}`);
} finally {
  await app.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nTout est bon.");
