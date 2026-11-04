/**
 * L'ordre de Mes agents sur la page Routines suit celui des Chats.
 * Profil jetable : Cicco, puis Iris, Val, Hugo (rang), et non l'ordre alphabétique.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   node scripts/test-ordre-routines.mjs --no-sandbox
 */
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lancerApp, verificateur } from "./pilote-app.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-ordre-routines-"));
const home = path.join(TMP, "home");
const donnees = path.join(TMP, "userdata");
const equipe = path.join(donnees, "equipe");
mkdirSync(equipe, { recursive: true });
for (const id of ["designer", "dev", "val"]) cpSync(path.join(APP, "agents-equipe", `${id}.md`), path.join(equipe, `${id}.md`));

const entree = (modele) => ({ actif: true, ajouteLe: 1, origine: { type: "modele", modele }, empreinte: null });
writeFileSync(
  path.join(donnees, "mes-agents.json"),
  JSON.stringify({
    version: 1,
    depart: "reprise",
    assistant: { nom: "Cicco", teinte: null },
    agents: { designer: entree("designer"), dev: entree("dev"), val: entree("val") },
  }),
);
writeFileSync(
  path.join(donnees, "agents-meta.json"),
  JSON.stringify({ designer: { rang: 0 }, val: { rang: 1 }, dev: { rang: 2 } }),
);

const ATTENDU = ["Cicco", "Iris", "Val", "Hugo"];
const BASE = ["Cicco", "Hugo", "Iris", "Val"];
const nomsChats = `(() => {
  const section = [...document.querySelectorAll('nav[aria-label="Agents et conversations"] section')]
    .find((s) => s.querySelector('[aria-label="Replier Mes agents"], [aria-label="Déplier Mes agents"]'));
  return section ? [...section.querySelectorAll("strong")].map((n) => n.textContent.trim()) : [];
})()`;
const nomsRoutines = `[...document.querySelectorAll('nav[aria-label="Agents"] section[aria-label="Mes agents"] strong')].map((n) => n.textContent.trim())`;
const nomsSelecteur = `[...document.querySelectorAll('[role="option"]')].map((o) => o.innerText.split(" · ")[1]?.trim() ?? o.innerText.trim())`;

let app;
try {
  app = await lancerApp({ port: 9348, env: { HOME: home, KLYRA_USER_DATA: donnees } });

  await app.aller("/chats");
  verifier(await app.quand(`${nomsChats}.join() === ${JSON.stringify(ATTENDU.join())}`), `Chats : ${ATTENDU.join(", ")}`);
  const chats = await app.ev(nomsChats);
  verifier(JSON.stringify(chats) !== JSON.stringify(BASE), `Chats n'est pas l'ordre de base (${(chats ?? []).join(", ")})`);

  await app.aller("/routines?vue=routines");
  verifier(await app.quand(`${nomsRoutines}.length >= 3`), "Routines : la colonne Mes agents est là");
  const routines = await app.ev(nomsRoutines);
  verifier(JSON.stringify(routines) === JSON.stringify(chats), `Routines = Chats (${(routines ?? []).join(", ")} / ${(chats ?? []).join(", ")})`);
  verifier(await app.quand("document.querySelector('.klyra-routines-colonne') && getComputedStyle(document.querySelector('.klyra-routines-colonne')).display !== 'none'"), "la colonne est visible en bureau");

  await app.ev(`(() => { const zone = document.querySelector(".klyra-routines-agent-compact"); if (zone) zone.style.display = "block"; zone?.querySelector("button")?.click(); return true; })()`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="option"]')].length >= 3`), "le sélecteur d'agent s'ouvre");
  const selecteur = await app.ev(nomsSelecteur);
  verifier(JSON.stringify(selecteur) === JSON.stringify(ATTENDU), `le sélecteur d'agent suit (${(selecteur ?? []).join(", ")})`);
} finally {
  if (app) await app.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.error(`${echecs.length} échec(s)`);
  process.exit(1);
}
console.log("Ordre Routines = ordre Chats.");
