/**
 * Le VPS garde son espace, de bout en bout : un vrai serveur KLYRA local et l'app sur deux profils.
 * Le premier envoie ce qu'il avait pour ce serveur (rien de ce PC) ; un second appareil, tout neuf, le
 * retrouve en se reliant, tickets compris. Le workflow du VPS tourne sur lui, même sans aucune app ouverte.
 * Prérequis : `pnpm build && pnpm build:electron`. Linux : `xvfb-run -a node scripts/test-espace-serveur.mjs --no-sandbox`.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const RACINE = path.resolve(import.meta.dirname, "..");
const SERVEUR = path.join(RACINE, "serveur", "klyra-serveur.mjs");
const temp = mkdtempSync(path.join(os.tmpdir(), "klyra-espace-"));
const donnees = path.join(temp, "donnees");
const port = 20000 + Math.floor(Math.random() * 20000);
const adresse = `http://127.0.0.1:${port}`;
const envServeur = { ...process.env, HOME: path.join(temp, "home-vps"), KLYRA_SERVEUR_DONNEES: donnees, KLYRA_SERVEUR_PORT: String(port), KLYRA_SERVEUR_HOTE: "127.0.0.1", KLYRA_SERVEUR_NOM: "Klyra-VPS" };
mkdirSync(envServeur.HOME, { recursive: true });
const { echecs, verifier } = verificateur();

const il = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString();
const fil = (id, titre, lieu) => ({
  id, kind: "direct", projectId: null, title: titre, roleIds: ["principal"], updatedAt: il(1), sessions: {}, luJusqua: null,
  ...(lieu ? { lieu } : {}),
  fil: { roleId: "principal", statut: "ouvert", creeLe: il(2), lancePar: null, etape: "a-faire" },
});
const SECRET = "secret-du-webhook-1234";
const profilA = path.join(temp, "profil-a");
const profilB = path.join(temp, "profil-b");
mkdirSync(profilA, { recursive: true });
mkdirSync(profilB, { recursive: true });
const mes = JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Cicco", teinte: null }, agents: {} });
writeFileSync(path.join(profilA, "mes-agents.json"), mes);
writeFileSync(path.join(profilB, "mes-agents.json"), mes);
writeFileSync(
  path.join(profilA, "conversations.json"),
  JSON.stringify({
    version: 1,
    chats: [fil("klyra-fil-pc0000001", "Ticket du PC", null), fil("klyra-fil-vps000001", "Ticket du VPS", adresse)],
    messages: [{ id: "m-vps", chatId: "klyra-fil-vps000001", author: { kind: "user" }, createdAt: il(1), parts: [{ type: "text", text: "Message gardé par le VPS" }] }],
    projects: [],
    routines: [],
    taches: [],
    evenements: [],
    categories: [{ id: "perso", nom: "Perso", teinte: "bleu-k2", icone: "home-01" }],
    artefacts: [],
    workflows: [{
      id: "wf-vps",
      titre: "Workflow du VPS",
      lieu: adresse,
      webhooks: { depart: SECRET },
      graphe: {
        noeuds: [
          { id: "depart", type: "declencheur", at: { x: 0, y: 0 }, champs: { declencheur: "webhook" } },
          { id: "fin", type: "sortie", at: { x: 300, y: 0 }, champs: { cible: "conversation", titre: "Sortie du workflow" } },
        ],
        liens: [{ id: "l1", de: "depart", vers: "fin", port: "texte" }],
        traits: [],
      },
      projectId: null,
      creeLe: il(2),
      majLe: il(2),
      versions: [],
    }, { id: "wf-pc", titre: "Workflow du PC", graphe: { noeuds: [], liens: [] }, projectId: null, creeLe: il(2), majLe: il(2), versions: [] }],
    executions: [],
  }),
);

const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });
const relier = async (app) => {
  const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;
  await app.aller("/serveurs");
  await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`);
  await app.saisir('input[aria-label="Lien d’invitation"]', lien);
  await app.cliquer("Rejoindre");
  return app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`);
};
const surVps = (app) => app.ev(`(() => { localStorage.setItem("klyra:lieu-actif", ${JSON.stringify(adresse)}); window.dispatchEvent(new Event("klyra:lieu-actif")); })()`);
const conversationsServeur = () => {
  const dossier = path.join(donnees, "espace", "conversation");
  return existsSync(dossier) ? readdirSync(dossier).map((f) => JSON.parse(readFileSync(path.join(dossier, f), "utf8"))) : [];
};
const attendreQue = async (test, n = 60) => {
  for (let i = 0; i < n; i++) {
    if (test()) return true;
    await attendre(500);
  }
  return false;
};

let app;
try {
  for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
  const base = (profil, nom) => ({ env: { HOME: path.join(temp, `home-${nom}`), KLYRA_USER_DATA: profil }, port: 9500 + Math.floor(Math.random() * 400) });

  app = await lancerApp(base(profilA, "a"));
  verifier(await relier(app), "premier appareil : le VPS est relié");
  verifier(await attendreQue(() => conversationsServeur().some((c) => c.id === "klyra-fil-vps000001")), "le VPS reçoit le ticket qui est à lui");
  verifier(!conversationsServeur().some((c) => c.id === "klyra-fil-pc0000001"), "le ticket du PC ne part pas sur le VPS");
  const surDisque = conversationsServeur().find((c) => c.id === "klyra-fil-vps000001");
  verifier(surDisque?.valeur.messages.some((m) => m.id === "m-vps"), "le VPS garde aussi ses messages");
  const workflows = () => (existsSync(path.join(donnees, "espace", "workflow")) ? readdirSync(path.join(donnees, "espace", "workflow")).map((f) => JSON.parse(readFileSync(path.join(donnees, "espace", "workflow", f), "utf8")).id) : []);
  verifier(await attendreQue(() => workflows().includes("wf-vps")) && !workflows().includes("wf-pc"), "le VPS garde ses workflows, pas ceux du PC");
  verifier(JSON.parse(readFileSync(path.join(profilA, "conversations.json"), "utf8")).chats.some((c) => c.id === "klyra-fil-vps000001"), "ce PC en garde sa copie");
  await app.fermer();
  app = null;
  await attendre(1000);

  // Plus aucune app ouverte : le workflow du VPS part quand même, de lui-même.
  const webhook = await fetch(`${adresse}/klyra/v1/webhook/${SECRET}`, { method: "POST", body: "Bonjour du webhook" });
  verifier(webhook.status === 202, `PC fermé : le webhook du workflow répond (${webhook.status})`);
  verifier((await fetch(`${adresse}/klyra/v1/webhook/mauvais-secret-000`, { method: "POST", body: "x" })).status === 404, "un mauvais secret n’ouvre rien");
  const lireDossier = (type) => (existsSync(path.join(donnees, "espace", type)) ? readdirSync(path.join(donnees, "espace", type)).map((f) => JSON.parse(readFileSync(path.join(donnees, "espace", type, f), "utf8")).valeur) : []);
  verifier(await attendreQue(() => lireDossier("execution").some((e) => e.workflowId === "wf-vps" && e.statut === "fait"), 20), "PC fermé : l’exécution va au bout sur le serveur");
  verifier(conversationsServeur().find((c) => c.id === "wf-sortie-wf-vps")?.valeur.messages.at(-1).parts[0].text === "Bonjour du webhook", "PC fermé : sa sortie entre dans une conversation du serveur");

  // Un appareil tout neuf : il retrouve l'espace du serveur.
  app = await lancerApp(base(profilB, "b"));
  verifier(await relier(app), "second appareil, tout neuf : le VPS est relié");
  await surVps(app);
  await app.aller("/tickets");
  verifier(await app.quand(`document.querySelector('section[aria-label="À faire"]')?.innerText.includes("Ticket du VPS")`, 20000), "second appareil : il retrouve le ticket du VPS");
  verifier(!(await app.ev(`document.querySelector('section[aria-label="À faire"]')?.innerText ?? ""`)).includes("Ticket du PC"), "second appareil : le ticket de l’autre PC n’y est pas");
  verifier(await attendreQue(() => JSON.parse(readFileSync(path.join(profilB, "conversations.json"), "utf8")).chats?.find((c) => c.id === "klyra-fil-vps000001")), "second appareil : il en garde une copie");

  verifier(await app.ev(`document.querySelector('[data-ticket="klyra-fil-vps000001"]') !== null`), "second appareil : la carte du ticket");

  // Le workflow lancé depuis l'app part sur le serveur, et l'app le suit en direct.
  await app.aller("/routines?vue=workflows");
  verifier(await app.quand(`document.body.innerText.includes("Workflow du VPS")`, 20000), "second appareil : le workflow du VPS");
  verifier(!(await app.ev(`document.body.innerText`)).includes("Workflow du PC"), "second appareil : pas celui de l’autre PC");
  verifier(!(await app.ev(`document.body.innerText`)).includes("pas encore à jour"), "le serveur est à jour : pas d’avertissement sur le moteur");
  const lancees = () => lireDossier("execution").filter((e) => e.workflowId === "wf-vps").length;
  const avant = lancees();
  verifier(await app.cliquer("Lancer le workflow"), "second appareil : on lance le workflow");
  verifier(await attendreQue(() => lancees() === avant + 1, 20), "l’exécution part sur le serveur, pas dans l’app");
  verifier(await app.quand(`document.body.innerText.includes("Sortie du workflow") || [...document.querySelectorAll("*")].some((e) => /Réussie|réussie|Terminé/.test(e.textContent ?? ""))`, 10000), "l’app voit l’exécution finie");
  let surProfil = null;
  for (let i = 0; i < 30 && !surProfil; i++) {
    await attendre(500);
    surProfil = JSON.parse(readFileSync(path.join(profilB, "conversations.json"), "utf8")).executions?.find((e) => e.workflowId === "wf-vps" && e.statut === "fait");
  }
  verifier(!!surProfil, "second appareil : l’exécution du serveur est dans sa copie");

  // Un autre appareil change la conversation sans changer sa date : l'app la prend, et personne ne réécrit plus.
  const fichierEtat = path.join(donnees, "espace", "etat.json");
  const revision = () => JSON.parse(readFileSync(fichierEtat, "utf8")).revision;
  const titreIci = () => JSON.parse(readFileSync(path.join(profilB, "conversations.json"), "utf8")).chats?.find((c) => c.id === "klyra-fil-vps000001")?.title;
  const titreServeur = () => conversationsServeur().find((c) => c.id === "klyra-fil-vps000001")?.valeur.chat.title;
  const copie = conversationsServeur().find((c) => c.id === "klyra-fil-vps000001").valeur;
  const autreAppareil = { type: "conversation", id: "klyra-fil-vps000001", valeur: { ...copie, chat: { ...copie.chat, title: "Renommé ailleurs" } } };
  const ecrit = await app.ev(`window.klyra.espace.ecrire(${JSON.stringify(adresse)}, { elements: [${JSON.stringify(autreAppareil)}], supprimes: [] })`);
  verifier(ecrit?.ok === true, "un autre appareil écrit la même conversation, à la même date");
  verifier(await attendreQue(() => titreIci() === "Renommé ailleurs", 200), `à date égale, l'app prend ce qu'un autre appareil a écrit (${titreIci()})`);
  verifier(titreServeur() === "Renommé ailleurs", `elle ne réécrit pas son ancienne copie sur le serveur (${titreServeur()})`);
  const revisionAvant = revision();
  await attendre(65_000);
  verifier(revision() === revisionAvant, `une relecture plus tard, plus aucune écriture (révision ${revisionAvant} → ${revision()})`);
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
} finally {
  await app?.fermer();
  serveur.kill();
  rmSync(temp, { recursive: true, force: true });
}
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nEspace du serveur : tout est bon.");
