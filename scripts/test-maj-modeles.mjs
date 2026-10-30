/**
 * Mise à jour des modèles KLYRA déjà installés, dans l'app de bureau (export statique), sur un profil et
 * un `~/.claude/agents` jetables : une installation existante (v0.1.29) dont les fiches viennent des
 * modèles en version 1. Vrais gestes, rien n'est écrit sans choix :
 * - ouverture : « Mise à jour » sur les cartes des modèles, aucune fiche réécrite ; rien pour les agents
 *   reçus de la bibliothèque, publiés par la personne ou à elle ;
 * - modèle non modifié : « Mettre à jour » (consigne actuelle, en-tête et modèle d'IA gardés, réglages
 *   intacts, ancienne version dans l'historique) et « Plus tard » (rien ne change) ;
 * - fiche changée sur le disque pendant la comparaison : rien n'est écrit, puis la comparaison se refait ;
 * - dossier en lecture seule : échec dit, rien d'écrit, rien dans l'historique ;
 * - fiche modifiée : ses ajouts gardés, une section modifiée des deux côtés choisie, « Garder ma version » ;
 * - redémarrage : tout est resté, conversations et réglages compris.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:maj-modeles          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const MODELES = path.join(APP, "agents-equipe");
const v1 = (nom) => readFileSync(path.join(MODELES, "versions-precedentes", `${nom}.v1.md`), "utf8");
const v2 = (nom) => readFileSync(path.join(MODELES, `${nom}.md`), "utf8");
const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-maj-modeles-"));
const empreinte = (texte) => createHash("sha256").update(texte.replace(/\r\n/g, "\n")).digest("hex");
const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const corps = (t) => t.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const enTete = (t) => t.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/)[1].split("\n");
const ligneDescription = (t) => enTete(t).find((l) => l.startsWith("description:"));

const HOME = path.join(TMP, "home");
const AGENTS = path.join(HOME, ".claude", "agents");
const DONNEES = path.join(TMP, "userdata");
mkdirSync(AGENTS, { recursive: true });
mkdirSync(path.join(DONNEES, "definitions-recues"), { recursive: true });
const env = { HOME, KLYRA_USER_DATA: DONNEES };
const fiche = (id) => path.join(AGENTS, `${id}.md`);
const lire = (id) => readFileSync(fiche(id), "utf8");
const historique = (id) => {
  const d = path.join(DONNEES, "historique-agents", id);
  return existsSync(d) ? readdirSync(d).map((f) => readFileSync(path.join(d, f), "utf8")) : [];
};

/* ─── L'installation existante ──────────────────────────────────────── */
const fiches = {
  val: v1("val").replace(/^model: .*$/m, "model: sonnet"),
  qa: v1("qa"),
  designer: v1("designer"),
  motion: v1("motion"),
  dev: `${v1("dev").replace("- Quand on t’écrit, réponds toujours à l’expéditeur, même d’une ligne.", "- Quand on t’écrit, réponds toujours à l’expéditeur, même d’une ligne.\n- Ma règle d’équipe.")}\n## Ajout local\n\nUne règle à moi.\n`,
  redacteur: v1("redacteur").replace("## Comment j’écris", "## Comment j’écris\n\n- Ma touche perso."),
  "pelin-dev": v1("dev").replace(/^name: dev$/m, "name: pelin-dev"),
  "mon-dev": v1("dev").replace(/^name: dev$/m, "name: mon-dev"),
  perso: "---\nname: perso\ndisplayName: Perso\ndescription: \"Perso — essai. Appelle Perso pour l’essai.\"\n---\n\n# Perso — Essai\n\nÀ moi.\n",
};
for (const [id, contenu] of Object.entries(fiches)) writeFileSync(fiche(id), contenu);
writeFileSync(path.join(DONNEES, "definitions-recues", "pelin-dev.md"), fiches["pelin-dev"]);
const modele = (id) => ({ actif: true, ajouteLe: 1, origine: { type: "modele", modele: id }, empreinte: null });
const mesAgents = {
  version: 1,
  depart: "reprise",
  assistant: { nom: "Principal", teinte: null },
  agents: {
    ...Object.fromEntries(["val", "qa", "designer", "motion", "dev", "redacteur"].map((id) => [id, modele(id)])),
    "pelin-dev": {
      actif: true,
      ajouteLe: 1,
      origine: { type: "bibliotheque", definitionId: "def-pelin", version: 3, auteur: "Pelin", compte: "compte-pelin", valeurs: {}, ignoree: null },
      empreinte: empreinte(fiches["pelin-dev"]),
    },
    "mon-dev": { actif: true, ajouteLe: 1, origine: { type: "local", publie: { definitionId: "def-moi", version: 2, compte: "compte-moi" } }, empreinte: null },
    perso: { actif: true, ajouteLe: 1, origine: { type: "local" }, empreinte: null },
  },
};
writeFileSync(path.join(DONNEES, "mes-agents.json"), JSON.stringify(mesAgents, null, 2));
const reglages = { val: { tag: "Boîte", teinte: "rose", nom: "Valérie" }, dev: { tag: "Code", teinte: "violet" } };
writeFileSync(path.join(DONNEES, "agents-meta.json"), JSON.stringify(reglages));
const conversations = {
  version: 1,
  chats: [{ id: "dm-val", kind: "direct", projectId: null, title: "Valérie", roleIds: ["val"], updatedAt: "2026-10-29T10:00:00.000Z", sessions: { val: "11111111-1111-4111-8111-111111111111" }, luJusqua: null }],
  messages: [{ id: "m1", chatId: "dm-val", author: { kind: "user" }, createdAt: "2026-10-29T10:00:00.000Z", parts: [{ type: "text", text: "Trie ma boîte" }] }],
};
writeFileSync(path.join(DONNEES, "conversations.json"), JSON.stringify(conversations));
const avant = Object.fromEntries(Object.entries(fiches).map(([id, c]) => [id, empreinte(c)]));

const cartes = (app) =>
  app.ev(`[...document.querySelectorAll('main a[href^="/equipe?agent="]')].filter((a) => a.querySelector('h2')).map((a) => ({ id: new URL(a.href).searchParams.get('agent'), texte: a.innerText.replace(/\\s+/g, ' ').trim() }))`);
const surFiche = (app) => app.quand("new URL(location.href).searchParams.get('agent') && !new URL(location.href).searchParams.get('mode')");
const dans = (app, texte, ms) => app.quand(`document.querySelector('main')?.innerText.includes(${JSON.stringify(texte)})`, ms);

let app;
try {
  app = await lancerApp({ port: 9337, env });
  await app.aller("/equipe");
  await app.quand("document.querySelector('[role=tablist]')");
  let c = await cartes(app);
  const aMaj = (id) => !!c.find((x) => x.id === id)?.texte.includes("Mise à jour");
  verifier(["val", "qa", "designer", "motion", "dev", "redacteur"].every(aMaj), "les 6 modèles en version 1 : « Mise à jour » sur leur carte");
  verifier(["pelin-dev", "mon-dev", "perso"].every((id) => c.some((x) => x.id === id) && !aMaj(id)), "agent reçu de Pelin, agent publié, agent à soi : rien proposé");
  verifier(Object.keys(fiches).every((id) => empreinte(lire(id)) === avant[id]), "à l’ouverture : aucune fiche réécrite");

  /* ─── Modèle non modifié : « Mettre à jour » ─── */
  await app.aller("/equipe?agent=val");
  verifier(await dans(app, "Le modèle KLYRA de Valérie a une nouvelle version (version 2)."), "fiche de Valérie : le bandeau de la nouvelle version");
  await app.cliquer("Voir les changements");
  verifier(await dans(app, "Version 2 du modèle KLYRA"), "« Voir les changements » ouvre la comparaison");
  let texte = await app.texte();
  verifier(texte.includes("Ta fiche est la version 1 du modèle, sans modification.") && texte.includes("son modèle (Sonnet)"), "comparaison : fiche non modifiée, modèle d’IA gardé annoncé");
  verifier(!texte.includes("Copier en privé"), "fiche non modifiée : « Plus tard » ou « Mettre à jour », sans autre choix");
  await app.cliquer("Mettre à jour");
  verifier(await surFiche(app), "« Mettre à jour » ramène à la fiche");
  const val = lire("val");
  verifier(corps(val) === corps(v2("val")), "val.md : la consigne de la version 2");
  verifier(enTete(val).includes("model: sonnet") && ligneDescription(val) === ligneDescription(v2("val")), "val.md : son modèle d’IA gardé, la description du modèle reprise");
  verifier(JSON.stringify(enTete(val).filter((l) => !l.startsWith("description:"))) === JSON.stringify(enTete(fiches.val).filter((l) => !l.startsWith("description:"))), "val.md : le reste de l’en-tête ligne pour ligne");
  verifier(JSON.stringify(historique("val")) === JSON.stringify([fiches.val]), "l’ancienne version de Valérie est dans l’historique");
  verifier(JSON.stringify(lireJson(path.join(DONNEES, "agents-meta.json"))) === JSON.stringify(reglages), "réglages (nom Valérie, couleur, rôle court) intacts");
  verifier(JSON.stringify(lireJson(path.join(DONNEES, "mes-agents.json")).agents.val) === JSON.stringify(mesAgents.agents.val), "Valérie reste un modèle KLYRA actif");
  verifier(!(await app.texte()).includes("nouvelle version"), "plus de bandeau après la mise à jour");

  /* ─── « Plus tard » ─── */
  await app.aller("/equipe?agent=qa&mode=maj");
  await dans(app, "Version 2 du modèle KLYRA");
  await app.cliquer("Plus tard");
  verifier(await surFiche(app), "« Plus tard » ramène à la fiche");
  verifier(empreinte(lire("qa")) === avant.qa && historique("qa").length === 0, "« Plus tard » : qa.md inchangé, rien dans l’historique");
  verifier(await dans(app, "a une nouvelle version"), "la proposition reste là pour plus tard");

  /* ─── La fiche change sur le disque pendant la comparaison ─── */
  await app.aller("/equipe?agent=designer&mode=maj");
  await dans(app, "Version 2 du modèle KLYRA");
  const exterieure = `${fiches.designer}\n## Note externe\n\nAjoutée par un autre outil.\n`;
  /*
   * L'app relit le dossier 200 ms après le dernier changement (electron/agents.ts, watchAgents) : un
   * fichier sans rapport touché toutes les 50 ms retient cette relecture, et le clic part avec la
   * fiche d'avant, comme quand la personne clique pendant qu'un autre outil écrit.
   */
  const bruit = path.join(AGENTS, ".bruit");
  const retenue = setInterval(() => writeFileSync(bruit, String(Date.now())), 50);
  writeFileSync(fiche("designer"), exterieure);
  await app.cliquer("Mettre à jour");
  verifier(await dans(app, "vient de changer", 5000), "fiche changée entre-temps : « rien n’a été écrit » s’affiche");
  clearInterval(retenue);
  rmSync(bruit, { force: true });
  verifier(lire("designer") === exterieure && historique("designer").length === 0, "la modification extérieure est intacte, rien n’a été remplacé");
  verifier(await dans(app, "Ta fiche a été modifiée depuis la version 1 du modèle."), "la comparaison se refait avec la fiche du disque");
  verifier((await app.texte()).includes("Tes modifications gardées : Note externe (nouvelle)."), "la note extérieure sera gardée");
  await app.cliquer("Mettre à jour");
  await surFiche(app);
  const designer = lire("designer");
  verifier(designer.includes("## Note externe") && designer.includes("## Images et assets générés") && !designer.includes("SendMessage"), "designer.md : la note gardée, les corrections reprises");
  verifier(JSON.stringify(historique("designer")) === JSON.stringify([exterieure]), "la version remplacée est dans l’historique");

  /* ─── Échec d'écriture ─── */
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    await app.aller("/equipe?agent=motion&mode=maj");
    await dans(app, "Version 2 du modèle KLYRA");
    chmodSync(AGENTS, 0o555);
    await app.cliquer("Mettre à jour");
    verifier(await dans(app, "Rien n’a changé", 5000), "dossier en lecture seule : l’échec est dit");
    chmodSync(AGENTS, 0o755);
    verifier(empreinte(lire("motion")) === avant.motion && historique("motion").length === 0, "motion.md intact, rien dans l’historique");
  }

  /* ─── Fiche modifiée : fusion et choix ─── */
  await app.aller("/equipe?agent=dev");
  verifier(await dans(app, "a une nouvelle version (version 2)"), "fiche modifiée de Hugo : la nouvelle version est proposée aussi");
  await app.cliquer("Voir les changements");
  verifier(await dans(app, "Ta fiche a été modifiée depuis la version 1 du modèle."), "comparaison : fiche modifiée reconnue");
  texte = await app.texte();
  verifier(texte.includes("Tes modifications gardées : Ajout local (nouvelle).") && texte.includes("Modifiées des deux côtés") && texte.includes("Passer la main à la QA (retirée)"), "ce qui est repris, gardé et à choisir");
  verifier(texte.includes("Voir ce que j’ai changé"), "« Voir ce que j’ai changé » est proposé");
  const radio = (n) => `document.querySelector('[data-conflit="section:Parler en équipe"]')?.querySelectorAll('[role=radio]')[${n}]`;
  verifier((await app.ev(`${radio(0)}?.getAttribute('aria-checked')`)) === "true", "par défaut, sa version de « Parler en équipe » est gardée");
  await app.ev(`${radio(1)}.click(); 0`);
  verifier(await app.quand(`${radio(1)}?.getAttribute('aria-checked') === 'true'`), "« Prendre celle du modèle » choisi");
  await app.cliquer("Mettre à jour");
  await surFiche(app);
  const dev = lire("dev");
  verifier(dev.includes("## Ajout local\n\nUne règle à moi.") && dev.includes("## Vérifier avant de livrer") && !dev.includes("Ma règle d’équipe") && !dev.includes("SendMessage"), "dev.md : ajout gardé, bloc d’équipe du modèle, corrections reprises");
  verifier(JSON.stringify(historique("dev")) === JSON.stringify([fiches.dev]), "sa version modifiée est dans l’historique");
  verifier(JSON.stringify(lireJson(path.join(DONNEES, "agents-meta.json"))) === JSON.stringify(reglages), "réglages de Hugo (Code, violet) intacts");

  /* ─── « Garder ma version » ─── */
  await app.aller("/equipe?agent=redacteur&mode=maj");
  await dans(app, "Garder ma version");
  await app.cliquer("Garder ma version");
  await surFiche(app);
  verifier(lireJson(path.join(DONNEES, "mes-agents.json")).agents.redacteur.origine.ignoree === 2, "« Garder ma version » : la version 2 est écartée");
  verifier(empreinte(lire("redacteur")) === avant.redacteur && historique("redacteur").length === 0, "redacteur.md inchangé");
  texte = await app.texte();
  verifier(!texte.includes("nouvelle version") && !texte.includes("Ta version diffère"), "plus de bandeau pour Olivier");
  await app.ev(`document.querySelector('main button[aria-label="Plus d’options"]')?.click(); 0`);
  await app.quand("document.querySelector('[role=menu]')");
  verifier(((await app.ev("document.querySelector('[role=menu]')?.innerText")) ?? "").includes("Comparer au modèle KLYRA"), "la comparaison reste dans « Plus d’options »");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs[0]}` : ""}`);
  await app.fermer();

  /* ─── Redémarrage ─── */
  app = await lancerApp({ port: 9337, env });
  await app.aller("/equipe");
  await app.quand("document.querySelector('[role=tablist]')");
  c = await cartes(app);
  verifier(["qa", "motion"].every(aMaj) && ["val", "designer", "dev", "redacteur"].every((id) => !aMaj(id)), "après redémarrage : « Mise à jour » seulement pour qa (plus tard) et motion (échec)");
  verifier(c.find((x) => x.id === "val")?.texte.includes("Modèle KLYRA"), "Valérie : « Modèle KLYRA », à jour");
  verifier(["pelin-dev", "mon-dev", "perso", "qa", "motion", "redacteur"].every((id) => empreinte(lire(id)) === avant[id]), "fiches non choisies : identiques");
  const mes = lireJson(path.join(DONNEES, "mes-agents.json"));
  verifier(["pelin-dev", "mon-dev", "perso"].every((id) => JSON.stringify(mes.agents[id]) === JSON.stringify(mesAgents.agents[id])), "agent reçu (version 3 de Pelin) et agent publié : origine et version inchangées");
  verifier(readFileSync(path.join(DONNEES, "definitions-recues", "pelin-dev.md"), "utf8") === fiches["pelin-dev"], "la définition reçue de Pelin reste à sa version");
  const relues = lireJson(path.join(DONNEES, "conversations.json"));
  verifier(JSON.stringify(relues.chats[0].sessions) === JSON.stringify(conversations.chats[0].sessions) && relues.messages.some((m) => m.id === "m1"), "conversation et session de Valérie intactes");
  verifier(JSON.stringify(lireJson(path.join(DONNEES, "agents-meta.json"))) === JSON.stringify(reglages), "réglages intacts après redémarrage");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs[0]}` : ""}`);
  await app.fermer();
  app = null;
  await attendre(300);
} finally {
  if (app) await app.fermer();
  try {
    chmodSync(AGENTS, 0o755);
  } catch {
    /* déjà rendu */
  }
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
