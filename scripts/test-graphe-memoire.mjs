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
const preuves = process.env.KLYRA_GRAPHE_PREUVES;
if (preuves) mkdirSync(preuves, { recursive: true });
const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-graphe-"));
const maison = path.join(tmp, "maison"), donnees = path.join(tmp, "donnees");
const souvenir = (nom, description, corps = "", extra = "") => `---\nname: ${nom}\ndescription: ${description}\nmetadata:\n  type: project\n${extra}---\n\n${corps}\n`;
const ecrire = (fichier, texte) => { mkdirSync(path.dirname(fichier), { recursive: true }); writeFileSync(fichier, texte); };

const cicco = path.join(maison, ".claude", "projects", path.join(maison, ".klyra", "atelier", "principal").replace(/[^a-zA-Z0-9]/g, "-"), "memory");
ecrire(path.join(cicco, "MEMORY.md"), "- [GitHub](github.md)\n");
ecrire(path.join(cicco, "fonctionnement.md"), souvenir("fonctionnement-modifications", "Chaque modification passe par une PR fusionnée quand tout est vert", "Une fusion sur main vaut mise en ligne immédiate."));
ecrire(path.join(cicco, "github.md"), souvenir("github-klyra-app", "Dépôt de l’app via Composio", "Voir [[fonctionnement-modifications]]."));
const iris = path.join(maison, ".klyra", "atelier", "designer", ".claude", "agent-memory", "designer");
ecrire(path.join(iris, "brouillon.md"), souvenir("brouillon-iris", "Piste visuelle personnelle", "", "  prive: oui\n"));
const hugo = path.join(maison, ".klyra", "atelier", "dev", ".claude", "agent-memory", "dev");
for (let i = 0; i < NOMBRE; i++) {
  ecrire(path.join(hugo, `essai-${i}.md`), souvenir(`essai-${i}`, `Essai ${i} sujet${i % 40}`, `${i ? `Suite de [[essai-${i - 1}]].` : ""}${i === 250 ? " Les panneaux photovoltaïques du client sont posés." : ""}`));
}
// Entretien : un doublon chez Hugo, un souvenir remplacé chez Iris.
ecrire(path.join(hugo, "doublon-a.md"), souvenir("Déploiement du site", "Procédure de déploiement Vercel du site vitrine", "Étape 1 : vérifier la CI."));
ecrire(path.join(hugo, "doublon-b.md"), souvenir("Deploiement site", "Procédure de déploiement Vercel du site vitrine", "Étape 2 : fusionner la PR."));
ecrire(path.join(hugo, "MEMORY.md"), "- [Déploiement](doublon-a.md)\n- [Déploiement bis](doublon-b.md)\n");
ecrire(path.join(cicco, "relances.md"), souvenir("relances-impayes", "Relances clients impayés Qonto facturation mensuelle"));
ecrire(path.join(hugo, "qonto.md"), souvenir("qonto-script", "Script relances impayés Qonto facturation"));
ecrire(path.join(iris, "charte-v1.md"), souvenir("charte-v1", "Ancienne charte"));
ecrire(path.join(iris, "charte-v2.md"), souvenir("charte-v2", "Charte actuelle", "", "  remplace: charte-v1\n"));
const empreintes = () => [cicco, iris, hugo].flatMap((d) => readdirSync(d).map((f) => readFileSync(path.join(d, f), "utf8"))).join("\u0000");
const avant = empreintes();

const maquette = path.join(maison, ".klyra", "rendus", "designer", "maquette.md");
ecrire(maquette, "# Maquette du graphe\nUne palette nocturne pour le fond du graphe.");
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
  rendus: [{ id: "rendu-test", chemin: maquette, origine: path.join(maison, "maquette.md"), taille: 10, titre: "Maquette du graphe", description: "Vue graphe", type: "document", roleId: "designer", chatId: "klyra-fil-test", projectId: null, ajouteLe: maintenant, misAJour: maintenant }],
}));

const serveur = createServer(); await new Promise((r) => serveur.listen(0, "127.0.0.1", r)); const port = serveur.address().port; await new Promise((r) => serveur.close(r));
let app;
const verifier = (ok, message) => { assert.ok(ok, message); console.log(`OK ${message}`); };
const PRIVE = "[...document.querySelectorAll('[data-noeud^=\"souvenir:designer:\"] title')].some(t=>t.textContent.includes('brouillon-iris'))";
const HUGO = NOMBRE + 3;
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
  verifier(await app.quand(`document.querySelectorAll('[data-noeud^="souvenir:dev:"]').length===${HUGO}`, 30000), `${HUGO} souvenirs de Hugo dessinés (${Date.now() - t0} ms après l’ouverture)`);
  verifier(await compter("souvenir:principal:") === 3, "les 3 souvenirs de Cicco portent son nom d’agent");
  verifier(await app.ev(PRIVE), "le souvenir privé d’Iris est visible pour toi");
  verifier(await compter("fil:klyra-fil-test") === 1 && await compter("fichier:rendu-test") === 1, "le fil et le fichier publié sont dans le graphe");
  verifier(await app.ev("['agent:principal','agent:dev','agent:designer'].every(id=>document.querySelector(`[data-noeud=\"${id}\"]`))"), "un repère par agent");
  verifier(await app.ev("document.querySelectorAll('svg[aria-roledescription=graphe] line[stroke-dasharray]').length>0"), "des liens suggérés en pointillé");
  verifier(await app.ev("getComputedStyle(document.querySelector('svg[aria-roledescription=graphe]').parentElement).backgroundColor !== 'rgba(0, 0, 0, 0)'"), "les styles du build réel donnent un fond sombre au graphe");

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
  // Le nouveau graphe masque les libellés qui se chevaucheraient : vérifier une
  // vue cadrée et leur taille réelle plutôt que compter tous les titres masqués.
  await app.ev("document.querySelector('[aria-label=\"Tout voir\"]').click()");
  for (let i = 0; i < 24 && await app.ev("parseInt(document.querySelector('[aria-label=\"Niveau de zoom\"]').innerText)<100"); i++)
    await app.ev("document.querySelector('[aria-label=\"Zoomer\"]').click()");
  verifier(await app.quand("document.querySelectorAll('svg[aria-roledescription=graphe] text').length>1"), "les libellés visibles apparaissent en zoomant sans tous s'empiler");
  verifier(await app.ev("[...document.querySelectorAll('svg[aria-roledescription=graphe] text')].every(t=>t.getBoundingClientRect().height>=12)"), "les libellés gardent au moins 12 pixels de hauteur à l'écran");

  // Clavier : flèches sur le fond pour déplacer, puis navigation entre nœuds.
  await app.ev("document.querySelector('svg[aria-roledescription=graphe]').focus()");
  const cameraAvant = await app.ev("document.querySelector('[data-camera]').getAttribute('transform')");
  await app.touche("ArrowRight", "ArrowRight", 39);
  verifier(await app.ev("document.querySelector('[data-camera]').getAttribute('transform')") !== cameraAvant, "les flèches déplacent le fond comme dans Obsidian");
  await app.ev("document.querySelector('[data-noeud]').focus()");
  await app.touche("ArrowRight", "ArrowRight", 39);
  verifier(await app.quand("document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')"), "une flèche choisit un élément et ouvre son détail");
  // Un vrai clic système : pointerup est capturé par le SVG, pas par le nœud.
  await app.ev("document.querySelector('[aria-label=\"Fermer le détail\"]').click();document.querySelector('[aria-label=\"Tout voir\"]').click()");
  await attendre(250);
  const cibleCicco = await app.ev("[...document.querySelectorAll('[data-noeud^=\"souvenir:principal:\"]')].find(n=>/fonctionnement-modifications|github-klyra-app/.test(n.textContent)).dataset.noeud");
  const pointNoeud = (id) => app.ev(`(()=>{const n=[...document.querySelectorAll('[data-noeud]')].find(n=>n.dataset.noeud===${JSON.stringify(id)});const p=new DOMPoint(0,0).matrixTransform(n.getScreenCTM());return {x:p.x,y:p.y}})()`);
  const positionNoeud = (id) => app.ev(`(()=>{const n=[...document.querySelectorAll('[data-noeud]')].find(n=>n.dataset.noeud===${JSON.stringify(id)});const p=n.transform.baseVal.consolidate().matrix;return {x:p.e,y:p.f}})()`);
  const clic = async (p) => {
    await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
  };
  await clic(await pointNoeud(cibleCicco));
  verifier(await app.quand("/fonctionnement-modifications|github-klyra-app/.test(document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')?.textContent)"), "un clic sur un nœud ouvre son panneau");
  verifier(await app.ev("/Cicco/.test(document.querySelector('aside[aria-label=\"Détail de l’élément\"]').innerText) && /Source/.test(document.querySelector('aside[aria-label=\"Détail de l’élément\"]').innerText)"), "le panneau dit l’agent et la source");
  verifier(await app.ev("/Cite|Cité par/.test(document.querySelector('section[aria-label=\"Voisins\"]').innerText)"), "le panneau liste les voisins reliés par [[…]]");
  await app.touche("Escape", "Escape", 27);
  verifier(await app.quand("!document.querySelector('aside[aria-label=\"Détail de l’élément\"]')"), "Échap ferme le détail et rend le focus au graphe");
  await app.ev("document.querySelector('[aria-label=\"Tout voir\"]').click()");
  await attendre(250);
  const p0 = await pointNoeud(cibleCicco), monde0 = await positionNoeud(cibleCicco);
  const cameraGlisser = await app.ev("document.querySelector('[data-camera]').getAttribute('transform')");
  const voisinId = await app.ev(`(()=>{const l=[...document.querySelectorAll('line[data-de]')].find(l=>l.dataset.de===${JSON.stringify(cibleCicco)} || l.dataset.vers===${JSON.stringify(cibleCicco)});return l.dataset.de===${JSON.stringify(cibleCicco)}?l.dataset.vers:l.dataset.de})()`);
  const voisinAvant = await positionNoeud(voisinId);
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p0, button: "left", clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p0.x + i * 8, y: p0.y + i * 3, buttons: 1 });
    await attendre(20);
  }
  await attendre(400);
  const tenu = await pointNoeud(cibleCicco), voisinApres = await positionNoeud(voisinId);
  verifier(Math.hypot(tenu.x - p0.x - 96, tenu.y - p0.y - 36) < 2, "le nœud reste exactement sous la souris pendant le glisser");
  verifier(await app.ev("document.querySelector('[data-camera]').getAttribute('transform')") === cameraGlisser, "tirer un nœud ne déplace pas la caméra");
  verifier(Math.hypot(voisinApres.x - voisinAvant.x, voisinApres.y - voisinAvant.y) > 1, "le voisin relié suit le nœud tiré par un ressort");
  await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p0.x + 96, y: p0.y + 36, button: "left", clickCount: 1 });
  verifier(await app.ev("!document.querySelector('aside[aria-label=\"Détail de l’élément\"]')"), "relâcher après un glisser n'ouvre pas le détail");
  verifier(await app.quand("document.querySelector('svg[aria-roledescription=graphe]').dataset.simulation==='repos'", 12000), "la simulation finit son amortissement");
  const repos1 = await positionNoeud(cibleCicco); await attendre(300);
  const repos2 = await positionNoeud(cibleCicco);
  verifier(Math.hypot(repos1.x - repos2.x, repos1.y - repos2.y) < 0.01, "la simulation s'arrête une fois amortie");
  verifier(Math.hypot(repos1.x - monde0.x, repos1.y - monde0.y) > 5, "le graphe adopte sa nouvelle position après le glisser");

  // Zoom ample, bornes, puis retour à une vue utile.
  for (let i = 0; i < 30; i++) await app.ev("document.querySelector('[aria-label=\"Zoomer\"]').click()");
  verifier(await app.quand("document.querySelector('[aria-label=\"Niveau de zoom\"]').innerText==='1200 %' && document.querySelector('[aria-label=\"Zoomer\"]').disabled"), "zoom jusqu'à 1200 %, bouton désactivé à la borne");
  for (let i = 0; i < 35; i++) await app.ev("document.querySelector('[aria-label=\"Dézoomer\"]').click()");
  verifier(await app.quand("document.querySelector('[aria-label=\"Niveau de zoom\"]').innerText==='4 %' && document.querySelector('[aria-label=\"Dézoomer\"]').disabled"), "dézoom jusqu'à 4 %, bouton désactivé à la borne");
  await app.ev("document.querySelector('[aria-label=\"Tout voir\"]').click()");
  await attendre(300);
  // Pincement à deux doigts et annulation : aucun détail ne s'ouvre par accident.
  await app.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const zone = await app.ev("(()=>{const r=document.querySelector('svg[aria-roledescription=graphe]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  const zoomAvantPince = await app.ev("parseInt(document.querySelector('[aria-label=\"Niveau de zoom\"]').innerText)");
  await app.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: zone.x-50, y: zone.y, id: 1 }, { x: zone.x+50, y: zone.y, id: 2 }] });
  await app.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: zone.x-100, y: zone.y, id: 1 }, { x: zone.x+100, y: zone.y, id: 2 }] });
  await attendre(150);
  const zoomApresPince = await app.ev("parseInt(document.querySelector('[aria-label=\"Niveau de zoom\"]').innerText)");
  verifier(Math.abs(zoomApresPince / zoomAvantPince - 2) < 0.05, "un pincement à deux doigts double le zoom autour de son centre");
  await app.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await app.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  verifier(await app.quand("!document.querySelector('svg[aria-roledescription=graphe]').classList.contains('cursor-grabbing') && !document.querySelector('aside[aria-label=\"Détail de l’élément\"]')"), "annuler le geste libère les pointeurs sans ouvrir un détail");
  await app.ev("document.querySelector('[aria-label=\"Tout voir\"]').click()");
  await attendre(150);
  if (preuves) {
    const capture = await app.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(preuves, "01-vue-ensemble.png"), Buffer.from(capture.data, "base64"));
  }
  await clic(await pointNoeud(cibleCicco));
  verifier(await app.quand("document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')"), "le clic fonctionne encore après déplacement et changement de zoom");
  if (preuves) {
    const capture = await app.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(preuves, "02-noeud-detail.png"), Buffer.from(capture.data, "base64"));
  }
  await app.send("Emulation.setDeviceMetricsOverride", { width: 768, height: 900, deviceScaleFactor: 1, mobile: false });
  await attendre(150);
  verifier(await app.ev("(()=>{const p=document.querySelector('aside[aria-label=\"Détail de l’élément\"]');return getComputedStyle(p).position==='absolute' && p.getBoundingClientRect().right<=innerWidth && document.querySelector('svg[aria-roledescription=graphe]').getBoundingClientRect().width>300})()"), "à 768 px, le détail se superpose sans écraser le graphe");
  await app.send("Emulation.clearDeviceMetricsOverride");
  await app.touche("Escape", "Escape", 27);

  verifier(await app.quand("!document.querySelector('aside[aria-label=\"Détail de l’élément\"]')"), "Échap ferme le détail");

  await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await app.ev("document.querySelector('[aria-label=\"Tout voir\"]').click()");
  await attendre(150);
  const pr = await pointNoeud(cibleCicco);
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...pr, button: "left", clickCount: 1 });
  await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pr.x+30, y: pr.y+10, buttons: 1 });
  await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pr.x+30, y: pr.y+10, button: "left", clickCount: 1 });
  verifier(await app.quand("document.querySelector('svg[aria-roledescription=graphe]').dataset.simulation==='repos'", 3000), "la préférence de mouvement réduit supprime les oscillations prolongées");
  await app.send("Emulation.setEmulatedMedia", { features: [] });

  // Périmètre : vu par Hugo, le souvenir privé d'Iris disparaît.
  await choisirOption("Vu par", "Vu par Hugo");
  verifier(await app.quand(`!(${PRIVE}) && document.querySelectorAll('[data-noeud^="souvenir:dev:"]').length===${HUGO}`), "vu par Hugo, le nœud privé d’Iris n’apparaît pas");
  await choisirOption("Vu par", "Vu par Iris");
  verifier(await app.quand(PRIVE), "vu par Iris, son nœud privé apparaît");
  await choisirOption("Vu par", "Vu par toi (tout)");

  // Filtres et état vide.
  await choisirOption("Agent", "Cicco");
  verifier(await app.quand("document.querySelectorAll('[data-noeud^=\"souvenir:\"]').length===3"), "le filtre agent ne garde que Cicco");
  await choisirOption("Type", "Projets (0)");
  verifier(await app.quand("/Rien ne correspond à ces filtres/.test(document.body.innerText)"), "état vide quand aucun élément ne correspond");
  await choisirOption("Type", "Tous les types");
  await choisirOption("Agent", "Tous les agents");

  // Recherche : cinq éléments choisis, chacun trouvé en moins de 2 s, puis centré.
  const champ = 'input[aria-label="Rechercher dans la mémoire"]';
  for (const [requete, titre, ou] of [
    ["essai-421", "essai-421", "nom"],
    ["sujet17 essai 97", "essai-97", "résumé"],
    ["photovoltaique", "essai-250", "contenu"],
    ["palette nocturne", "Maquette du graphe", "contenu"],
    ["mise en ligne immediate", "fonctionnement-modifications", "contenu"],
  ]) {
    await app.saisir(champ, "");
    const debut = Date.now();
    await app.saisir(champ, requete);
    const trouve = await app.quand(`[...document.querySelectorAll('[role=listbox] [role=option]')].some(o=>o.innerText.includes(${JSON.stringify(titre)})&&o.innerText.includes(${JSON.stringify(ou)}))`, 5000);
    const duree = Date.now() - debut;
    verifier(trouve && duree < 2000, `« ${requete} » trouve ${titre} (${ou}) en ${duree} ms`);
  }
  verifier(await app.ev("document.querySelectorAll('[role=listbox] mark').length>0"), "les mots trouvés sont surlignés dans les résultats");
  verifier(await app.ev("document.querySelectorAll('[data-trouve]').length>=1"), "le résultat est surligné dans le graphe");
  await app.ev(`document.querySelector('${champ}').focus()`);
  await app.touche("Enter", "Enter", 13);
  verifier(await app.quand("document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')?.textContent==='fonctionnement-modifications'"), "Entrée ouvre l’élément trouvé et centre le graphe dessus");
  await app.saisir(champ, "piste visuelle personnelle");
  verifier(await app.quand("[...document.querySelectorAll('[role=option]')].some(o=>o.innerText.includes('brouillon-iris'))"), "vu par toi, le souvenir privé d’Iris se trouve");
  await choisirOption("Vu par", "Vu par Hugo");
  await app.saisir(champ, "");
  await app.saisir(champ, "piste visuelle personnelle");
  await attendre(1200);
  verifier(await app.ev("![...document.querySelectorAll('[role=option]')].some(o=>o.innerText.includes('brouillon-iris')) && /Aucun élément trouvé/.test(document.body.innerText)"), "vu par Hugo, la recherche ne trouve pas le souvenir privé d’Iris");
  await choisirOption("Vu par", "Vu par toi (tout)");
  await app.saisir(champ, "");

  // Vue liste.
  await app.aller("/memoire?vue=liste");
  verifier(await app.quand("document.querySelectorAll('ul[aria-label=\"Éléments de la mémoire\"] > li').length===200 && /de plus/.test(document.body.innerText)"), "la liste affiche 200 éléments puis « de plus »");
  await app.ev("document.querySelector('ul[aria-label=\"Éléments de la mémoire\"] button').click()");
  verifier(await app.quand("document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')"), "un élément de la liste ouvre son détail");

  verifier(empreintes() === avant, "aucun fichier de mémoire n’a été modifié");
  // Entretien : rien ne change sans confirmation, et chaque action s'annule.
  await app.aller("/memoire");
  verifier(await app.quand("[...document.querySelectorAll('button')].some(b=>/^Entretien \\(\\d+\\)$/.test(b.innerText.trim()))"), "le bouton Entretien compte les propositions");
  await app.ev("[...document.querySelectorAll('button')].find(b=>/^Entretien \\(/.test(b.innerText.trim())).click()");
  const panneau = "document.querySelector('aside[aria-label=\"Entretien de la mémoire\"]')";
  verifier(await app.quand(`/Déploiement du site/.test(${panneau}?.querySelector('section[aria-label=Doublons]')?.innerText)`), "le doublon de Hugo est signalé");
  verifier(await app.ev(`/charte-v1/.test(${panneau}.querySelector('section[aria-label=Obsolètes]').innerText) && /Remplacé par « charte-v2 »/.test(${panneau}.innerText)`), "le souvenir remplacé d’Iris est signalé obsolète");
  const a = path.join(hugo, "doublon-a.md"), b = path.join(hugo, "doublon-b.md");
  const avantA = readFileSync(a, "utf8"), avantB = readFileSync(b, "utf8");
  await app.ev(`[...[...${panneau}.querySelectorAll('section[aria-label=Doublons] li')].find(li=>/Déploiement du site/.test(li.innerText)).querySelectorAll('button')].find(b=>b.innerText==='Fusionner dans le plus récent').click()`);
  verifier(await app.quand("document.querySelector('[role=alertdialog]') && /Fusionner ces deux souvenirs/.test(document.querySelector('[role=alertdialog]').innerText)"), "fusionner demande d’abord une confirmation");
  verifier(readFileSync(a, "utf8") === avantA && readFileSync(b, "utf8") === avantB, "rien n’est écrit avant la confirmation");
  assert.ok(await app.cliquer("Fusionner", "document.querySelector('[role=alertdialog]')"));
  await attendre(800);
  const fusionne = [a, b].find((f) => { try { return /## Repris de/.test(readFileSync(f, "utf8")); } catch { return false; } });
  const archive = [a, b].find((f) => f !== fusionne);
  verifier(!!fusionne && !!archive && readFileSync(path.join(hugo, "archive", path.basename(archive)), "utf8") === (archive === a ? avantA : avantB), "fusion faite : l’un reprend l’autre, l’autre est archivé intact");
  verifier(!readFileSync(path.join(hugo, "MEMORY.md"), "utf8").includes(path.basename(archive)), "la ligne du souvenir archivé quitte MEMORY.md");
  await app.cliquer("Annuler");
  verifier(await app.quand("/Annuler cette action/.test(document.querySelector('[role=alertdialog]')?.innerText)"), "annuler demande confirmation");
  assert.ok(await app.cliquer("Annuler l’action", "document.querySelector('[role=alertdialog]')"));
  await attendre(800);
  verifier(readFileSync(a, "utf8") === avantA && readFileSync(b, "utf8") === avantB, "l’annulation remet les deux souvenirs à l’identique");
  await app.ev(`[...[...${panneau}.querySelectorAll('section[aria-label=Obsolètes] li')].find(li=>/charte-v1/.test(li.innerText)).querySelectorAll('button')].find(b=>b.innerText==='Archiver').click()`);
  assert.ok(await app.quand("/Archiver ce souvenir/.test(document.querySelector('[role=alertdialog]')?.innerText)"));
  assert.ok(await app.cliquer("Archiver", "document.querySelector('[role=alertdialog]')"));
  verifier(await app.quand(`!/charte-v1/.test(${panneau}.querySelector('section[aria-label=Obsolètes]').innerText)`) && readFileSync(path.join(iris, "archive", "charte-v1.md"), "utf8").includes("Ancienne charte"), "archiver déplace le souvenir dans archive/, sans le supprimer");
  await app.ev(`[...[...${panneau}.querySelectorAll('section[aria-label="Liens suggérés"] li')].find(li=>[...li.querySelectorAll('button')].some(b=>b.innerText==='Accepter')).querySelectorAll('button')].find(b=>b.innerText==='Accepter').click()`);
  assert.ok(await app.quand("/Écrire ce lien/.test(document.querySelector('[role=alertdialog]')?.innerText)"));
  assert.ok(await app.cliquer("Écrire le lien", "document.querySelector('[role=alertdialog]')"));
  await attendre(800);
  const ecrits = readdirSync(hugo).filter((f) => f.endsWith(".md")).filter((f) => /Voir aussi : \[\[/.test(readFileSync(path.join(hugo, f), "utf8")));
  verifier(ecrits.length === 1, `un lien accepté est écrit dans un seul souvenir (${ecrits.join(", ")})`);
  await app.ev(`[...[...${panneau}.querySelectorAll('section[aria-label="Liens suggérés"] li')][0].querySelectorAll('button')].find(b=>b.innerText==='Refuser').click()`);
  verifier(await app.quand("/Suggestion écartée/.test(document.body.innerText)"), "un lien refusé est écarté en un clic");
  const refus = JSON.parse(readFileSync(path.join(donnees, "graphe-entretien.json"), "utf8")).refuses;
  verifier(refus.length >= 1, `le refus est gardé dans les données de l’app, pas dans un souvenir (${JSON.stringify(refus)})`);

  verifier(app.erreurs.length === 0, `aucune exception de rendu (${app.erreurs.join(" | ")})`);
  console.log("Graphe commun vérifié.");
} catch (e) {
  if (app && preuves) {
    const capture = await app.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(preuves, "diagnostic.png"), Buffer.from(capture.data, "base64"));
    console.log("État du graphe", await app.ev("({zoom:document.querySelector('[aria-label=\"Niveau de zoom\"]')?.innerText,libelles:document.querySelectorAll('svg[aria-roledescription=graphe] text').length,detail:document.querySelector('aside[aria-label=\"Détail de l’élément\"] h2')?.textContent})"));
  }
  throw e;
} finally {
  await app?.fermer();
  rmSync(tmp, { recursive: true, force: true });
}
