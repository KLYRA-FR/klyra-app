/**
 * La Bibliothèque KLYRA entre deux comptes fictifs, chacun sur son ordinateur (deux profils
 * jetables ouverts en même temps), avec un backend Convex local et jetable (jamais un vrai
 * déploiement) et des e-mails simulés. Gestes de la spec d'Iris (§17, 9 à 17) :
 * - Alice crée « Nina » (chemin personnel, faux secret), l'aperçu remplace le chemin et bloque le
 *   secret ; secret retiré, elle partage. La ligne Convex ne contient que ce qui part.
 * - Bruno la voit, l'ajoute seule (« À configurer »), choisit le dossier, la renomme : toujours liée.
 *   Son assistant peut l'appeler (vrai Claude Code, faux fournisseur) ; pas l'autre définition d'Alice.
 * - Mises à jour : proposée sans rien écrire, « Plus tard », « Mettre à jour » (préférences et
 *   dossier gardés, ancienne version dans l'historique), modification locale puis « Garder ma
 *   version », « Remplacer », « Copier en privé ».
 * - Déconnexion, autre compte sur le même ordinateur, réseau coupé : rien d'effacé, rien d'un autre
 *   compte, liens suspendus ; rien de la bibliothèque sur le disque. Retrait par Alice.
 * Prérequis : `pnpm build && pnpm build:electron`, puis les variables du backend local
 * (KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY, KLYRA_TEST_CONVEX_SERVEUR, cf. test-profil).
 *   pnpm test:bibliotheque          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { demanderA, demarrerFournisseur, refuse, suivreEvenements } from "./faux-fournisseur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const CONVEX = process.env.KLYRA_TEST_CONVEX_URL;
const CLE_ADMIN = process.env.KLYRA_TEST_CONVEX_ADMIN_KEY;
const SERVEUR = process.env.KLYRA_TEST_CONVEX_SERVEUR;
if (!CONVEX || !CLE_ADMIN || !SERVEUR) {
  console.log("Backend Convex local absent (KLYRA_TEST_CONVEX_URL, KLYRA_TEST_CONVEX_ADMIN_KEY, KLYRA_TEST_CONVEX_SERVEUR) : test sauté.");
  process.exit(0);
}
const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude"].find((c) => c && existsSync(c));

const APP = path.resolve(import.meta.dirname, "..");
const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-bibliotheque-"));
const empreinte = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));

/** Toutes les empreintes d'un dossier (récursif). */
function empreintesDe(dossier) {
  const vues = {};
  const parcourir = (d) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      const st = lstatSync(p);
      if (st.isDirectory()) parcourir(p);
      else if (st.isFile()) vues[path.relative(dossier, p)] = empreinte(p);
    }
  };
  parcourir(dossier);
  return vues;
}
/** Le texte de tous les fichiers d'un dossier (pour chercher ce qui ne doit pas y être). Liens et sockets ignorés. */
function texteDe(dossier) {
  let tout = "";
  const parcourir = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      const st = lstatSync(p);
      if (st.isDirectory()) parcourir(p);
      else if (st.isFile() && st.size < 5_000_000) tout += readFileSync(p, "latin1");
    }
  };
  parcourir(dossier);
  return tout;
}

function profil(nom) {
  const racine = path.join(TMP, nom);
  const home = path.join(racine, "home");
  const agents = path.join(home, ".claude", "agents");
  const donnees = path.join(racine, "userdata");
  const dossierChoisi = path.join(racine, "Contrats");
  for (const d of [agents, donnees, dossierChoisi]) mkdirSync(d, { recursive: true });
  return {
    home,
    agents,
    donnees,
    dossierChoisi,
    env: { HOME: home, KLYRA_USER_DATA: donnees, KLYRA_CONVEX_URL: CONVEX, KLYRA_TEST_TROUSSEAU: "1", KLYRA_TEST_DOSSIER: dossierChoisi },
  };
}

/* ─── Le compte d'équipe local ──────────────────────────────────── */

const admin = new ConvexHttpClient(CONVEX);
admin.setAdminAuth(CLE_ADMIN);
const SUFFIXE = Math.random().toString(36).slice(2, 8);
const ALICE = { email: `alice-${SUFFIXE}@exemple.test`, nom: "Alice Test" };
const BRUNO = { email: `bruno-${SUFFIXE}@exemple.test`, nom: "Bruno Test" };
const courrielsRecus = (email) => admin.query(makeFunctionReference("courriels:nombreCourrielsSimules"), { a: email });

async function seConnecter(a, qui) {
  await a.aller("/reglages?section=equipe");
  if (await a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Changer d’adresse')", 3000)) await a.cliquer("Changer d’adresse");
  await a.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
  const avant = await courrielsRecus(qui.email);
  await a.saisir('input[aria-label="Adresse e-mail"]', qui.email);
  await attendre(200);
  await a.cliquer("Recevoir un lien");
  await a.quand(`document.querySelector('input[aria-label="Lien de connexion"]')`);
  let nouveau = false;
  for (let i = 0; i < 10 && !nouveau; i++) {
    nouveau = (await courrielsRecus(qui.email)) > avant;
    if (!nouveau) await attendre(500);
  }
  if (!nouveau) {
    await a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Renvoyer' && !b.disabled)", 70000);
    await a.cliquer("Renvoyer");
    for (let i = 0; i < 20 && !nouveau; i++) {
      nouveau = (await courrielsRecus(qui.email)) > avant;
      if (!nouveau) await attendre(500);
    }
  }
  const courriel = nouveau ? await admin.query(makeFunctionReference("courriels:dernierCourrielSimule"), { a: qui.email }) : null;
  const code = courriel?.texte.match(/\?code=([A-Za-z0-9]+)/)?.[1] ?? null;
  if (!code) throw new Error(`aucun lien simulé pour ${qui.email}`);
  await a.saisir('input[aria-label="Lien de connexion"]', `klyra://connexion?code=${code}`);
  await attendre(200);
  await a.cliquer("Se connecter");
  return a.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Se déconnecter')", 30000);
}
async function seDeconnecter(a) {
  await a.aller("/reglages?section=equipe");
  await a.cliquer("Se déconnecter");
  return a.quand(`document.querySelector('input[aria-label="Adresse e-mail"]')`);
}

/* ─── Gestes dans l'app ─────────────────────────────────────────── */

const ecrireDans = (a, selecteur, rang, valeur) =>
  a.ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(selecteur)})[${rang}]; if (!el) return false; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valeur)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

async function nommer(a, nom) {
  await a.quand("document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await a.saisir("main form input", nom);
  await a.cliquer("Commencer");
  return a.quand("!document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
}
async function creerAgent(a, { id, nom, role, description, fiche }) {
  await a.aller("/equipe?nouveau=1");
  await a.quand("document.querySelector('main input')");
  await ecrireDans(a, "main input", 0, nom);
  await ecrireDans(a, "main input", 1, role);
  // L'identifiant, dans les réglages avancés repliés (sinon déduit du nom).
  await a.ev(`document.querySelector('main details').open = true; 0`);
  await ecrireDans(a, "main details input", 0, id);
  await ecrireDans(a, "main textarea", 0, description);
  await ecrireDans(a, "main textarea", 1, fiche);
  await attendre(200);
  await a.cliquer("Créer l’agent");
  return a.quand("new URL(location.href).searchParams.get('agent') && !new URL(location.href).searchParams.get('nouveau')");
}
async function modifierFiche(a, id, fiche) {
  await a.aller(`/equipe?agent=${id}&mode=modifier`);
  await a.quand("document.querySelectorAll('main textarea').length === 2");
  await ecrireDans(a, "main textarea", 1, fiche);
  await attendre(200);
  await a.cliquer("Enregistrer");
}
async function menuFiche(a, id, ligne) {
  await a.aller(`/equipe?agent=${id}`);
  await a.quand(`document.querySelector('main button[aria-label="Plus d’options"]')`);
  await a.ev(`document.querySelector('main button[aria-label="Plus d’options"]').click(); 0`);
  await a.quand("document.querySelector('[role=menu]')");
  // Une ligne peut attendre la session ou le réseau (grisée avec sa raison) : on lui laisse le temps.
  await a.quand(`[...document.querySelectorAll('[role=menuitem]')].some((x) => x.innerText.trim() === ${JSON.stringify(ligne)} && x.getAttribute('aria-disabled') !== 'true')`, 10000);
  return a.cliquer(ligne, "document.querySelector('[role=menu]')");
}
const dialogue = (a) => a.ev("document.querySelector('[role=dialog], [role=alertdialog]')?.innerText ?? ''");
/** Partager ou publier depuis le « … » de la fiche : faux si la ligne, la fenêtre ou le bouton manque. */
async function publier(a, id, ligne, bouton) {
  if (!(await menuFiche(a, id, ligne))) return false;
  if (!(await a.quand("document.querySelector('[role=dialog]')"))) return false;
  if (!(await a.quand(`[...document.querySelectorAll('[role=dialog] button')].some((b) => b.innerText.trim() === ${JSON.stringify(bouton)} && !b.disabled)`))) {
    console.log(`   (fenêtre : ${(await dialogue(a)).replace(/\s+/g, " ").slice(0, 300)})`);
    return false;
  }
  await a.cliquer(bouton, "document.querySelector('[role=dialog]')");
  return a.quand("!document.querySelector('[role=dialog]')", 20000);
}
const cartes = (a) =>
  a.ev(`[...document.querySelectorAll('main a[href^="/equipe?agent="]')].filter((x) => x.querySelector('h2')).map((x) => ({ id: new URL(x.href).searchParams.get('agent'), texte: x.innerText.replace(/\\s+/g, ' ').trim() }))`);
async function carte(a, id) {
  await a.aller("/equipe");
  await a.quand("document.querySelector('[role=tablist]')");
  return (await cartes(a)).find((x) => x.id === id) ?? null;
}
function lignesConvex() {
  const env = { ...process.env, CONVEX_SELF_HOSTED_URL: CONVEX, CONVEX_SELF_HOSTED_ADMIN_KEY: CLE_ADMIN };
  const sortie = execFileSync("corepack", ["pnpm", "exec", "convex", "data", "definitionsAgents", "--format", "jsonArray", "--limit", "50"], { cwd: APP, env, encoding: "utf8" });
  return JSON.parse(sortie.slice(sortie.indexOf("[")));
}

/* ─── Le parcours ───────────────────────────────────────────────── */

const FICHE = (version, secret = false) =>
  [
    "# Nina — Juriste",
    "",
    "Je relis les contrats rangés dans /Users/alice/Clients/Contrats et je réponds en clair.",
    "SOUS-AGENT-TEST-juriste",
    "",
    "## Comment je travaille",
    "",
    "1. Je lis le contrat en entier.",
    ...(secret ? ["api_key = sk-test-ABCDEFGHIJKLMNOPQRSTUV"] : []),
    ...(version > 1 ? [`2. Version ${version} de la consigne.`] : []),
  ].join("\n");

await admin.mutation(makeFunctionReference("equipe:initialiser"), { admins: [ALICE, BRUNO] });
const fournisseur = await demarrerFournisseur(["juriste", "comptable"]);
const A = profil("alice");
const B = profil("bruno");
const claudeB = CLAUDE ? { KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" } : {};
let a;
let b;
try {
  a = await lancerApp({ port: 9351, env: A.env });
  b = await lancerApp({ port: 9352, env: { ...B.env, ...claudeB } });

  /* Alice : premier lancement, deux agents, connexion. */
  verifier(await nommer(a, "Sam"), "Alice : premier lancement, assistant nommé « Sam »");
  verifier(
    await creerAgent(a, { id: "juriste", nom: "Nina", role: "Juriste", description: "Juriste — contrats, CGV. Appelle Nina dès qu’il faut relire un contrat.", fiche: FICHE(1, true) }),
    "Alice crée Nina (chemin personnel, faux secret)",
  );
  verifier(
    await creerAgent(a, { id: "comptable", nom: "Léo", role: "Compta", description: "Comptable — factures. Appelle Léo pour une facture.", fiche: "# Léo — Comptable\n\nSOUS-AGENT-TEST-comptable\n\nJe range les factures." }),
    "Alice crée Léo",
  );
  verifier(await seConnecter(a, ALICE), "Alice se connecte (lien simulé)");

  /* Partager : l'aperçu, le secret qui bloque, puis la publication. */
  const ficheAlice = path.join(A.agents, "juriste.md");
  await menuFiche(a, "juriste", "Partager avec l’équipe");
  await a.quand("document.querySelector('[role=dialog]')");
  await attendre(500);
  let texte = await dialogue(a);
  verifier(texte.includes("Ce qui part") && texte.includes("/Users/alice/Clients/Contrats"), "aperçu : ce qui part, et le chemin personnel remplacé");
  verifier(
    (await a.ev("[...document.querySelectorAll('[role=dialog] button')].find((x) => x.innerText.trim() === 'Partager')?.disabled")) === true && /cl[ée]/i.test(texte),
    "un secret dans la fiche bloque « Partager »",
  );
  await a.cliquer("Annuler", "document.querySelector('[role=dialog]')");
  await modifierFiche(a, "juriste", FICHE(1));
  await a.quand("new URL(location.href).searchParams.get('mode') === null");
  const avantPartage = empreinte(ficheAlice);
  verifier(await publier(a, "juriste", "Partager avec l’équipe", "Partager"), "secret retiré : Nina partagée");
  verifier(await publier(a, "comptable", "Partager avec l’équipe", "Partager"), "Léo partagé aussi");
  verifier(empreinte(ficheAlice) === avantPartage, "la fiche d’Alice n’a pas changé en partageant");
  verifier(lireJson(path.join(A.donnees, "mes-agents.json")).agents.juriste.origine.publie?.version === 1, "Alice : Nina publiée en version 1");
  const lignes = lignesConvex();
  const nina = lignes.find((l) => l.slug === "juriste");
  const champs = Object.keys(nina ?? {}).filter((k) => !k.startsWith("_")).sort();
  verifier(
    JSON.stringify(champs) === JSON.stringify(["auteurId", "capacites", "contenu", "dependances", "description", "majLe", "modele", "nom", "retireeLe", "role", "slug", "version"]),
    `Convex : seulement les champs de « Ce qui part » (${champs.join(", ")})`,
  );
  verifier(
    !!nina && nina.contenu.includes("{{chemin:contrats}}") && !/\/Users\/alice|sk-test|memory:|teinte|couleur/.test(JSON.stringify(nina)),
    "Convex : le chemin est une dépendance nommée ; ni chemin, ni secret, ni mémoire, ni couleur",
  );

  /* Bruno : premier lancement, connexion, la bibliothèque. */
  verifier(await nommer(b, "Nova"), "Bruno : premier lancement, assistant « Nova »");
  verifier(await seConnecter(b, BRUNO), "Bruno se connecte");
  await b.aller("/equipe?vue=bibliotheque");
  verifier(await b.quand("document.querySelector('main')?.innerText.includes('Nina') && document.querySelector('main')?.innerText.includes('Alice Test')", 20000), "Bruno voit Nina, par Alice Test");
  await b.ev(`document.querySelector('button[aria-label="Ajouter Nina à tes agents"]')?.click(); 0`);
  await b.quand("document.querySelector('[role=dialog]')");
  verifier((await dialogue(b)).includes("Dossier « contrats »") || (await dialogue(b)).includes("contrats"), "la fenêtre d’ajout montre la dépendance à configurer");
  await b.cliquer("Ajouter", "document.querySelector('[role=dialog]')");
  await b.quand("!document.querySelector('[role=dialog]')");
  let mesB = lireJson(path.join(B.donnees, "mes-agents.json"));
  verifier(
    Object.keys(mesB.agents).join(",") === "juriste" && mesB.agents.juriste.origine.type === "bibliotheque" && mesB.agents.juriste.origine.version === 1,
    "Bruno ajoute seulement Nina (version 1, liée à la bibliothèque)",
  );
  const ficheBruno = path.join(B.agents, "juriste.md");
  verifier(existsSync(ficheBruno) && readFileSync(ficheBruno, "utf8").includes("{{chemin:contrats}}") && !existsSync(path.join(B.agents, "comptable.md")), "sa fiche locale attend son dossier ; Léo n’est pas ajouté");
  let c = await carte(b, "juriste");
  verifier(!!c && c.texte.includes("À configurer") && !/prêt/i.test(c.texte), `carte « À configurer », jamais « prêt » (${c?.texte})`);
  verifier((await b.ev(`[...document.querySelectorAll('nav[aria-label="Agents et conversations"] section')][0]?.innerText ?? ''`)).includes("Nina"), "Nina entre dans le panneau de Bruno");

  /* Le dossier choisi, puis le nom et la couleur à soi : toujours liée. */
  await b.aller("/equipe?agent=juriste");
  await b.quand("[...document.querySelectorAll('main button')].some((x) => x.innerText.trim() === 'Choisir un dossier')");
  await b.cliquer("Choisir un dossier");
  let ecrit = false;
  for (let i = 0; i < 40 && !ecrit; i++) {
    const contenu = readFileSync(ficheBruno, "utf8");
    ecrit = contenu.includes(B.dossierChoisi) && !contenu.includes("{{chemin:");
    if (!ecrit) await attendre(250);
  }
  verifier(ecrit, "dossier choisi : écrit dans sa fiche locale");
  c = await carte(b, "juriste");
  verifier(!!c && !c.texte.includes("À configurer") && c.texte.includes("De Alice Test"), `l’étiquette « À configurer » disparaît (${c?.texte})`);
  const avantNom = empreinte(ficheBruno);
  await b.aller("/equipe?agent=juriste&mode=modifier");
  await b.quand("document.querySelector('main input')");
  await ecrireDans(b, "main input", 0, "Juju");
  await b.ev(`document.querySelector('[role=radiogroup] [role=radio][aria-checked=false]')?.click(); 0`);
  await attendre(200);
  await b.cliquer("Enregistrer");
  await b.quand("new URL(location.href).searchParams.get('mode') === null");
  mesB = lireJson(path.join(B.donnees, "mes-agents.json"));
  verifier(
    mesB.agents.juriste.origine.type === "bibliotheque" && empreinte(ficheBruno) === avantNom && lireJson(path.join(B.donnees, "agents-meta.json")).juriste?.nom === "Juju",
    "renommée « Juju », couleur changée : fiche intacte, toujours liée",
  );
  verifier(!(await b.texte()).includes("Publier une mise à jour") && !(await b.texte()).includes("Retirer de la bibliothèque"), "Bruno n’a aucune action d’auteur sur Nina");

  /* L'assistant de Bruno peut appeler Nina, pas Léo. */
  if (CLAUDE) {
    await suivreEvenements(b);
    const appelNina = await demanderA(b, fournisseur, { agent: null, prompt: "appelle juriste" });
    verifier(appelNina.requetes.some((q) => q.sousAgent === "juriste") && !refuse(appelNina), "l’assistant de Bruno appelle Nina (vrai Claude Code)");
    const appelLeo = await demanderA(b, fournisseur, { agent: null, prompt: "appelle comptable" });
    verifier(refuse(appelLeo) && !appelLeo.requetes.some((q) => q.sousAgent === "comptable"), "il ne peut pas appeler Léo, jamais ajouté");
  } else console.log("(Claude Code absent : délégation de Bruno non testée.)");

  /* Mise à jour v2 : proposée, « Plus tard », puis « Mettre à jour ». */
  await modifierFiche(a, "juriste", FICHE(2));
  await a.quand("new URL(location.href).searchParams.get('mode') === null");
  verifier(await publier(a, "juriste", "Publier une mise à jour", "Publier"), "Alice publie la version 2");
  const avantMaj = empreinte(ficheBruno);
  verifier(await b.quand("true", 1) && (await (async () => { for (let i = 0; i < 30; i++) { const x = await carte(b, "juriste"); if (x?.texte.includes("Mise à jour")) return true; await attendre(1000); } return false; })()), "chez Bruno : étiquette « Mise à jour »");
  verifier(empreinte(ficheBruno) === avantMaj, "rien n’est écrit tant que Bruno ne choisit pas");
  await b.aller("/equipe?agent=juriste&mode=maj");
  await b.quand("[...document.querySelectorAll('main button')].some((x) => x.innerText.trim() === 'Plus tard')", 20000);
  await b.cliquer("Plus tard");
  await attendre(800);
  verifier(empreinte(ficheBruno) === avantMaj, "« Plus tard » : rien ne change");
  await b.aller("/equipe?agent=juriste&mode=maj");
  await b.quand("[...document.querySelectorAll('main button')].some((x) => x.innerText.trim() === 'Mettre à jour')", 20000);
  await b.cliquer("Mettre à jour");
  await b.quand("new URL(location.href).searchParams.get('mode') === null", 20000);
  let contenuB = readFileSync(ficheBruno, "utf8");
  mesB = lireJson(path.join(B.donnees, "mes-agents.json"));
  verifier(contenuB.includes("Version 2") && contenuB.includes(B.dossierChoisi) && mesB.agents.juriste.origine.version === 2, "« Mettre à jour » : consigne v2, dossier gardé");
  verifier(lireJson(path.join(B.donnees, "agents-meta.json")).juriste?.nom === "Juju", "le nom « Juju » est gardé");
  verifier(readdirSync(path.join(B.donnees, "historique-agents", "juriste")).length >= 1, "l’ancienne version est dans l’historique");

  /* Modification hors de l'app, v3 : « Garder ma version ». v4 : « Remplacer ». */
  writeFileSync(ficheBruno, `${contenuB.trimEnd()}\n\nNote de Bruno, ajoutée dans le terminal.\n`);
  const versionBruno = readFileSync(ficheBruno, "utf8");
  await modifierFiche(a, "juriste", FICHE(3));
  await a.quand("new URL(location.href).searchParams.get('mode') === null");
  await publier(a, "juriste", "Publier une mise à jour", "Publier");
  await b.aller("/equipe?agent=juriste&mode=maj");
  verifier(await b.quand("[...document.querySelectorAll('main button')].some((x) => x.innerText.trim() === 'Garder ma version')", 30000), "modification locale + v3 : les trois choix");
  await b.cliquer("Garder ma version");
  await attendre(1000);
  mesB = lireJson(path.join(B.donnees, "mes-agents.json"));
  verifier(readFileSync(ficheBruno, "utf8") === versionBruno && mesB.agents.juriste.origine.ignoree === 3, "« Garder ma version » : fichier inchangé, v3 plus proposée");
  await modifierFiche(a, "juriste", FICHE(4));
  await a.quand("new URL(location.href).searchParams.get('mode') === null");
  await publier(a, "juriste", "Publier une mise à jour", "Publier");
  await b.aller("/equipe?agent=juriste&mode=maj");
  await b.quand("[...document.querySelectorAll('main button')].some((x) => x.innerText.trim() === 'Remplacer')", 30000);
  await b.cliquer("Remplacer");
  await b.quand("new URL(location.href).searchParams.get('mode') === null", 20000);
  contenuB = readFileSync(ficheBruno, "utf8");
  const historique = readdirSync(path.join(B.donnees, "historique-agents", "juriste")).map((f) => readFileSync(path.join(B.donnees, "historique-agents", "juriste", f), "utf8"));
  verifier(contenuB.includes("Version 4") && !contenuB.includes("Note de Bruno") && historique.some((h) => h.includes("Note de Bruno")), "« Remplacer » : v4 écrite, la version de Bruno dans l’historique");

  /* Déconnexion, autre compte, réseau coupé : rien d'effacé, rien d'un autre compte. */
  const disque = () => JSON.stringify([empreintesDe(B.agents), empreinte(path.join(B.donnees, "mes-agents.json")), empreintesDe(path.join(B.donnees, "definitions-recues")), empreinte(path.join(B.donnees, "conversations.json"))]);
  const avantDeconnexion = disque();
  verifier(await seDeconnecter(b), "Bruno se déconnecte");
  await attendre(1500);
  verifier(disque() === avantDeconnexion, "déconnexion : fiches, Mes agents, définitions reçues et conversations identiques");
  await b.aller("/equipe");
  await b.quand("document.querySelector('[role=tablist]')");
  texte = await b.texte();
  verifier(texte.includes("Non connecté : les liens de 1 agent reçu de la bibliothèque sont suspendus."), "la ligne « Non connecté » en tête de Mes agents");
  await b.aller("/equipe?agent=juriste");
  await b.quand("document.querySelector('main')?.innerText.includes('lien suspendu')");
  texte = await b.texte();
  verifier(texte.includes("Reçu de la bibliothèque · lien suspendu") && !texte.includes("Alice"), "sa fiche : lien suspendu, sans nom d’auteur ni version");
  await b.aller("/equipe?vue=bibliotheque");
  verifier(await b.quand("document.querySelector('main')?.innerText.includes('Connecte-toi à ton compte d’équipe pour voir les agents que les membres partagent.')"), "bibliothèque : invitation à se connecter, modèles KLYRA toujours là");

  verifier(await seConnecter(b, ALICE), "Alice se connecte sur l’ordinateur de Bruno");
  await b.aller("/equipe?agent=juriste");
  await b.quand("document.querySelector('main')?.innerText.includes('lien suspendu')");
  texte = await b.texte();
  verifier(texte.includes("lien suspendu") && !texte.includes("Bruno"), "sous le compte d’Alice : Nina reçue par Bruno reste « lien suspendu »");
  verifier(disque() === avantDeconnexion, "changement de compte : rien de modifié sur l’ordinateur de Bruno");
  await seDeconnecter(b);
  verifier(await seConnecter(b, BRUNO), "Bruno se reconnecte");
  c = await carte(b, "juriste");
  verifier(!!c && c.texte.includes("De Alice Test"), "ses étiquettes reviennent");

  execSync(`${SERVEUR} stop`, { stdio: "ignore" });
  await b.aller("/equipe?vue=bibliotheque");
  verifier(await b.quand("document.querySelector('main')?.innerText.includes('Tes agents marchent. La bibliothèque attend le réseau.')", 30000), "réseau coupé : « Tes agents marchent. La bibliothèque attend le réseau. »");
  execSync(`${SERVEUR} start`, { stdio: "ignore" });
  verifier(await b.quand("document.querySelector('main')?.innerText.includes('Nina')", 60000), "réseau rétabli : la bibliothèque revient seule");

  /* Copie privée (v5), puis retrait par Alice. */
  await modifierFiche(a, "juriste", FICHE(5));
  await a.quand("new URL(location.href).searchParams.get('mode') === null");
  await publier(a, "juriste", "Publier une mise à jour", "Publier");
  await b.aller("/equipe?agent=juriste&mode=maj");
  await b.quand("[...document.querySelectorAll('main button')].some((x) => x.innerText.trim() === 'Mettre à jour' || x.innerText.trim() === 'Copier en privé')", 30000);
  if (!(await b.cliquer("Copier en privé"))) {
    // Sans modification locale, la copie privée se fait en modifiant la consigne dans l'éditeur.
    await modifierFiche(b, "juriste", `${readFileSync(ficheBruno, "utf8").split("---").slice(2).join("---").trim()}\n\nUne règle de Bruno.`);
    await b.quand("document.querySelector('[role=alertdialog]')");
    await b.cliquer("Créer ma copie privée", "document.querySelector('[role=alertdialog]')");
    await b.quand("new URL(location.href).searchParams.get('mode') === null", 20000);
  }
  await attendre(1000);
  mesB = lireJson(path.join(B.donnees, "mes-agents.json"));
  verifier(mesB.agents.juriste.origine.type === "copie", "Nina devient la copie privée de Bruno (même agent)");
  c = await carte(b, "juriste");
  verifier(!!c && !c.texte.includes("Mise à jour") && c.texte.includes("Copie privée"), "plus aucune proposition de mise à jour");

  await menuFiche(a, "juriste", "Retirer de la bibliothèque");
  await a.quand("document.querySelector('[role=dialog], [role=alertdialog]')");
  await a.cliquer("Retirer", "document.querySelector('[role=dialog], [role=alertdialog]')");
  await attendre(1500);
  await b.aller("/equipe?vue=bibliotheque");
  await attendre(2000);
  verifier(!(await b.texte()).includes("Nina") || !(await b.texte()).includes("Par Alice"), "retirée : Nina n’est plus dans la bibliothèque");
  verifier(existsSync(ficheBruno), "la copie de Bruno reste sur son ordinateur");

  /* Rien de la bibliothèque des membres sur le disque de Bruno. */
  verifier(!texteDe(B.donnees).includes("Léo") && !texteDe(B.donnees).includes("SOUS-AGENT-TEST-comptable"), "aucune donnée de la bibliothèque (Léo) dans le dossier de l’app de Bruno");
  verifier(a.erreurs.length === 0 && b.erreurs.filter((e) => !/Failed to fetch/.test(e ?? "")).length === 0, `aucune erreur dans les pages${[...a.erreurs, ...b.erreurs].length ? ` : ${[...a.erreurs, ...b.erreurs][0]}` : ""}`);
} finally {
  await a?.fermer();
  await b?.fermer();
  fournisseur.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
