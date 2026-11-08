/**
 * Graphe commun de la page Mémoire, dans la vraie app Electron exportée (après `pnpm build` et `build:electron`).
 * Profil et dossiers de mémoire jetables : 600 souvenirs de Hugo, 2 de Cicco, 1 souvenir privé d'Iris.
 * Vérifie l'agent de chaque nœud, le clavier, la liste, le périmètre privé, la fluidité, et que rien n'est écrit.
 * Lancer : `xvfb-run -a node scripts/test-graphe-memoire.mjs --no-sandbox` sous Linux.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp } from "./pilote-app.mjs";

const NOMBRE = 600;
const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-graphe-"));
const maison = path.join(tmp, "maison"), donnees = path.join(tmp, "donnees");
const souvenir = (nom, description, corps = "", extra = "") => `---\nname: ${nom}\ndescription: ${description}\nmetadata:\n  type: project\n${extra}---\n\n${corps}\n`;
const ecrire = (fichier, texte) => { mkdirSync(path.dirname(fichier), { recursive: true }); writeFileSync(fichier, texte); };

const cicco = path.join(maison, ".claude", "projects", path.join(maison, ".klyra", "atelier", "principal").replace(/[^a-zA-Z0-9]/g, "-"), "memory");
ecrire(path.join(cicco, "MEMORY.md"), "- [GitHub](github.md)\n");
ecrire(path.join(cicco, "fonctionnement.md"), souvenir("fonctionnement-modifications", "Chaque modification passe par une PR fusionnée quand tout est vert"));
ecrire(path.join(cicco, "github.md"), souvenir("github-klyra-app", "Dépôt de l’app via Composio", "Voir [[fonctionnement-modifications]]."));
const iris = path.join(maison, ".klyra", "atelier", "designer", ".claude", "agent-memory", "designer");
ecrire(path.join(iris, "brouillon.md"), souvenir("brouillon-iris", "Piste visuelle personnelle", "", "  prive: oui\n"));
const hugo = path.join(maison, ".klyra", "atelier", "dev", ".claude", "agent-memory", "dev");
for (let i = 0; i < NOMBRE; i++) {
  ecrire(path.join(hugo, `essai-${i}.md`), souvenir(`essai-${i}`, `Essai ${i} sujet${i % 40} groupe${i % 40}`, i ? `Suite de [[essai-${i - 1}]].` : ""));
}
const empreintes = () => [cicco, iris, hugo].flatMap((d) => readdirSync(d).map((f) => readFileSync(path.join(d, f), "utf8"))).join("\u0000");
const avant = empreintes();

const fiche = (id, nom) => `---\nname: ${id}\ndisplayName: ${nom}\ndescription: ${nom}\n---\nFiche de test.\n`;
ecrire(path.join(donnees, "equipe", "dev.md"), fiche("dev", "Hugo"));
ecrire(path.join(donnees, "equipe", "designer.md"), fiche("designer", "Iris"));
const actif = { actif: true, ajouteLe: 1, origine: { type: "local" }, empreinte: null };
writeFileSync(path.join(donnees, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Cicco", teinte: null }, agents: { dev: actif, designer: actif } }));
const maintenant = new Date().toISOString();
writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify({
  version: 1,
  chats: [{ id: "klyra-fil-test", kind: "direct", projectId: null, title: "Refonte page Mémoire", roleIds: ["dev"], updatedAt: maintenant, sessions: {}, luJusqua: null, fil: { roleId: "dev", statut: "ouvert", creeLe: maintenant } }],
  messages: [], projects: [], routines: [], artefacts: [], workflows: [],
  rendus: [{ id: "rendu-test", chemin: path.join(maison, ".klyra", "rendus", "designer", "maquette.png"), origine: path.join(maison, "maquette.png"), taille: 10, titre: "Maquette du graphe", description: "Vue graphe", type: "image", roleId: "designer", chatId: "klyra-fil-test", projectId: null, ajouteLe: maintenant, misAJour: maintenant }],
}));

const serveur = createServer(); await new Promise((r) => serveur.listen(0, "127.0.0.1", r)); const port = serveur.address().port; await new Promise((r) => serveur.close(r));
let app;
const verifier = (ok, message) => { assert.ok(ok, message); console.log(`OK ${message}`); };
const compter = (prefixe) => app.ev(`document.querySelectorAll('[data-noeud^="${prefixe}"]').length`);
const choisirOption = async (libelle, option) => {
  await app.ev(`document.querySelector('button[aria-label="${libelle}"]').click()`);
  verifier(await app.quand(`[...document.querySelectorAll('[role=option]')].some(o=>o.innerText.trim()===${JSON.stringify(option)})`), `option « ${option} » proposée`);
  await app.ev(`[...document.querySelectorAll('[role=option]')].find(o=>o.innerText.trim()===${JSON.stringify(option)}).click()`);
  await attendre(300);
};
try {
  app = await lancerApp({ port, env: { HOME: maison, USERPROFILE: maison, KLYRA_USER_DATA: donnees, CLAUDE_CONFIG_DIR: path.join(maison, ".claude"), CODEX_HOME: path.join(maison, ".codex"), KLYRA_SANS_VEILLE: "1" } });
  const t0 = Date.now();
  await app.aller("/memoire");
  verifier(await app.quand(`document.querySelectorAll('[data-noeud^="souvenir:dev:"]').length===${NOMBRE}`, 30000), `${NOMBRE} souvenirs de Hugo dessinés (${Date.now() - t0} ms après l’ouverture)`);
  verifier(await compter("souvenir:principal:") === 2, "les 2 souvenirs de Cicco portent son nom d’agent");
  verifier(await compter("souvenir:designer:") === 1, "le souvenir privé d’Iris est visible pour toi");
  verifier(await compter("fil:klyra-fil-test") === 1 && await compter("fichier:rendu-test") === 1, "le fil et le fichier publié sont dans le graphe");
  verifier(await app.ev("['agent:principal','agent:dev','agent:designer'].every(id=>document.querySelector(`[data-noeud=\"${id}\"]`))"), "un repère par agent");
  verifier(await app.ev("document.querySelectorAll('svg[aria-roledescription=graphe] line[stroke-dasharray]').length>0"), "des liens suggérés en pointillé");

  // Fluidité : temps d'image pendant un glisser de 40 pas sur 600+ nœuds.
  await app.ev("window.__images=[];(function f(t){window.__images.push(t);if(window.__images.length<400)requestAnimationFrame(f)})(performance.now())");
  const debutGlisser = Date.now();
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 400, button: "left", clickCount: 1 });
  for (let i = 0; i < 40; i++) await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400 + i * 6, y: 400 + i * 3, button: "left", buttons: 1 });
  await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 520, button: "left", clickCount: 1 });
  const dureeGlisser = Date.now() - debutGlisser;
  const images = await app.ev("(()=>{const t=window.__images;const d=t.slice(1).map((x,i)=>x-t[i]);d.sort((a,b)=>a-b);return {n:d.length,mediane:d[Math.floor(d.length/2)],p95:d[Math.floor(d.length*0.95)]}})()");
  verifier(dureeGlisser < 2500 && images.mediane < 50, `glisser fluide : 40 pas en ${dureeGlisser} ms, image médiane ${Math.round(images.mediane)} ms, 95e centile ${Math.round(images.p95)} ms`);
  const debutZoom = Date.now();
  for (let i = 0; i < 10; i++) await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 500, y: 400, deltaX: 0, deltaY: -100 });
  verifier(Date.now() - debutZoom < 1500, `10 crans de zoom en ${Date.now() - debutZoom} ms`);
  verifier(await app.quand("document.querySelectorAll('svg[aria-roledescription=graphe] text').length>20"), "les libellés apparaissent en zoomant");

  // Clavier : focus sur le graphe, flèche, panneau.
  await app.ev("document.querySelector('svg[aria-roledescription=graphe]').focus()");
  await app.touche("ArrowRight", "ArrowRight", 39);
  verifier(await app.quand("document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')"), "une flèche choisit un élément et ouvre son détail");
  await app.ev("document.querySelector('[data-noeud^=\"souvenir:principal:\"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:1,clientY:1,pointerId:1}))");
  await app.ev("document.querySelector('[data-noeud^=\"souvenir:principal:\"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:1,clientY:1,pointerId:1}))");
  verifier(await app.quand("/fonctionnement-modifications|github-klyra-app/.test(document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')?.textContent)"), "un clic sur un nœud ouvre son panneau");
  verifier(await app.ev("/Cicco/.test(document.querySelector('aside[aria-label=\"Détail de l’élément\"]').innerText) && /Source/.test(document.querySelector('aside[aria-label=\"Détail de l’élément\"]').innerText)"), "le panneau dit l’agent et la source");
  verifier(await app.ev("/Cite|Cité par/.test(document.querySelector('section[aria-label=\"Voisins\"]').innerText)"), "le panneau liste les voisins reliés par [[…]]");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand("!document.querySelector('aside[aria-label=\"Détail de l’élément\"]')"), "Échap ferme le détail");

  // Périmètre : vu par Hugo, le souvenir privé d'Iris disparaît.
  await choisirOption("Vu par", "Vu par Hugo");
  verifier(await app.quand(`document.querySelectorAll('[data-noeud^="souvenir:designer:"]').length===0 && document.querySelectorAll('[data-noeud^="souvenir:dev:"]').length===${NOMBRE}`), "vu par Hugo, le nœud privé d’Iris n’apparaît pas");
  await choisirOption("Vu par", "Vu par Iris");
  verifier(await app.quand(`document.querySelectorAll('[data-noeud^="souvenir:designer:"]').length===1`), "vu par Iris, son nœud privé apparaît");
  await choisirOption("Vu par", "Vu par toi (tout)");

  // Filtres et état vide.
  await choisirOption("Agent", "Cicco");
  verifier(await app.quand("document.querySelectorAll('[data-noeud^=\"souvenir:\"]').length===2"), "le filtre agent ne garde que Cicco");
  await choisirOption("Type", "Projets (0)");
  verifier(await app.quand("/Rien ne correspond à ces filtres/.test(document.body.innerText)"), "état vide quand aucun élément ne correspond");
  await choisirOption("Type", "Tous les types");
  await choisirOption("Agent", "Tous les agents");

  // Vue liste.
  await app.aller("/memoire?vue=liste");
  verifier(await app.quand("document.querySelectorAll('ul[aria-label=\"Éléments de la mémoire\"] > li').length===200 && /de plus/.test(document.body.innerText)"), "la liste affiche 200 éléments puis « de plus »");
  await app.ev("document.querySelector('ul[aria-label=\"Éléments de la mémoire\"] button').click()");
  verifier(await app.quand("document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')"), "un élément de la liste ouvre son détail");

  verifier(empreintes() === avant, "aucun fichier de mémoire n’a été modifié");
  verifier(app.erreurs.length === 0, `aucune exception de rendu (${app.erreurs.join(" | ")})`);
  console.log("Graphe commun vérifié.");
} finally {
  await app?.fermer();
  rmSync(tmp, { recursive: true, force: true });
}
