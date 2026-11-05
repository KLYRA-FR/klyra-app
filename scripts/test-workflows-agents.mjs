/**
 * Un agent construit, puis lance un workflow, et la page Workflows le montre en direct. Dans l'app de
 * bureau (export statique), sur un profil jetable, avec le vrai Claude Code face au faux fournisseur
 * local (aucun compte, aucune dépense, cf. faux-fournisseur.mjs) :
 *  - « workflow essai » : l'assistant appelle `construire_workflow` ; son entrée arrive par morceaux.
 *    La page Workflows s'ouvre seule sur le workflow en construction (il n'existe pas encore), la
 *    pastille dit qui construit, les cartes en pointillés apparaissent une à une, le curseur de
 *    l'agent les suit ; à l'appel, le workflow est enregistré et les cartes « naissent ».
 *  - « lance essai » : l'assistant appelle `lancer_workflow` ; l'exécution passe (son étape agent
 *    répond dans la conversation du workflow), l'historique dit qui l'a lancée.
 *  - Sur un VPS (un vrai serveur KLYRA local, ce PC sans Claude Code) : l'assistant du serveur
 *    construit un workflow ; l'appel est relayé à ce PC, où tourne le moteur, et la page le montre
 *    se construire de la même façon. Le workflow appartient à ce serveur : Ce PC ne le montre pas.
 * Prérequis : `pnpm build && pnpm build:electron`, Claude Code (KLYRA_CLAUDE_PATH, ou sur le PATH).
 *   xvfb-run -a node scripts/test-workflows-agents.mjs   (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-workflows-agents-"));
const lireJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const home = path.join(TMP, "home");
const donnees = path.join(TMP, "userdata");
mkdirSync(path.join(home, ".claude", "agents"), { recursive: true });
mkdirSync(donnees, { recursive: true });

const surPath = () => {
  try {
    return execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude", surPath()].find((c) => c && existsSync(c));
if (!CLAUDE) {
  console.log("Claude Code introuvable (KLYRA_CLAUDE_PATH) : test sauté.");
  process.exit(0);
}

const conversations = () => lireJson(path.join(donnees, "conversations.json"));
async function surDisque(test, ms = 10000) {
  for (let t = 0; t < ms; t += 250) {
    try {
      if (test()) return true;
    } catch {
      /* fichier en cours d'écriture */
    }
    await attendre(250);
  }
  return false;
}

let app;
const fournisseur = await demarrerFournisseur([]);
try {
  /* Le premier lancement : nommer l'assistant ; puis l'accès complet, pour que le lancement ne demande rien. */
  app = await lancerApp({ port: 9343, env: { HOME: home, KLYRA_USER_DATA: donnees, PATH: "/usr/bin:/bin" } });
  await app.quand("document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await app.saisir("main form input", "Cicco");
  await app.touche("Enter", "Enter", 13);
  await app.quand("!document.querySelector('main')?.innerText.includes('donne un nom à ton assistant')");
  await app.fermer();
  const conv = conversations();
  writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify({ ...conv, acces: "tout" }));

  app = await lancerApp({
    port: 9343,
    env: { HOME: home, KLYRA_USER_DATA: donnees, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" },
  });
  await app.aller("/chat?id=dm-principal");
  const ecrire = async (texte) => {
    await app.saisir("main textarea", texte);
    await app.ev("document.querySelector('main textarea')?.focus(); 0");
    await app.touche("Enter", "Enter", 13);
  };

  /* ─── Construire ─── */
  await ecrire("workflow essai");
  await app.aller("/routines?vue=workflows");
  const pastille = "document.querySelector('main [role=status]')";
  verifier(await app.quand(`${pastille}?.innerText.includes('construit ce workflow')`, 60000), "la pastille : l’assistant construit ce workflow");
  verifier(await app.quand("document.querySelector('header')?.innerText.includes('En construction')"), "l’en-tête : « En construction »");
  verifier((await app.ev("document.querySelector('header')?.innerText ?? ''")).includes("Bonjour essai"), "le titre du workflow pendant qu’il s’écrit");
  // Les cartes paraissent une à une pendant que l'outil s'écrit : on compte, à intervalles.
  const comptes = [];
  for (let i = 0; i < 60; i++) {
    const n = await app.ev("document.querySelectorAll('[data-chantier=\"fantome\"], [data-chantier=\"ecrit\"]').length");
    if (!comptes.includes(n)) comptes.push(n);
    if (await app.ev(`!!${pastille}?.innerText.includes('a construit ce workflow')`)) break;
    await attendre(100);
  }
  verifier(comptes.filter((n) => n > 0).length >= 2, `les cartes paraissent l’une après l’autre (vu : ${comptes.join(" → ")})`);
  verifier(!(await surDisque(() => conversations().workflows?.length > 0, 1)) || comptes.length > 1, "rien d’enregistré avant l’appel de l’outil");
  verifier(await app.quand(`${pastille}?.innerText.includes('a construit ce workflow')`, 60000), "la pastille : « a construit ce workflow »");
  verifier(await app.quand("document.querySelectorAll('[data-chantier=\"ne\"]').length === 3"), "les trois cartes « naissent » à l’enregistrement");
  verifier(
    await surDisque(() => {
      const wf = conversations().workflows?.[0];
      return wf?.titre === "Bonjour essai" && wf.graphe.noeuds.length === 3 && wf.graphe.liens.length === 2;
    }),
    "le workflow est enregistré : trois étapes, deux liens",
  );
  verifier(
    fournisseur.requetes.some((q) => q.resultats.some((r) => !r.erreur && r.texte.includes("Workflow créé"))),
    "l’outil répond à l’assistant : « Workflow créé »",
  );
  verifier(await app.quand(`!${pastille}`, 8000), "la pastille s’en va après la fin");
  verifier(!(await app.ev("document.querySelector('header')?.innerText.includes('En construction')")), "plus « En construction »");
  verifier(await app.quand("[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Lancer le workflow' && !b.disabled)"), "le workflow se lance à nouveau à la main");

  /* ─── Lancer ─── */
  await app.aller("/chat?id=dm-principal");
  await ecrire("lance essai");
  await app.aller("/routines?vue=workflows");
  verifier(
    await surDisque(() => conversations().executions?.some((e) => e.lancePar?.roleId === "principal"), 60000),
    "lancer_workflow : une exécution lancée par l’assistant",
  );
  verifier(await surDisque(() => conversations().executions?.[0]?.statut === "fait", 120000), "l’exécution va au bout (étape agent, puis sortie)");
  // L'historique des exécutions dit qui l'a lancée.
  await app.ev("[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Exécutions')?.click(); 0");
  verifier(
    await app.quand("[...document.querySelectorAll('aside[aria-label=\"Exécutions\"] li')].some((li) => li.innerText.includes('Exécution 1') && li.innerText.includes('Cicco') && li.innerText.includes('Réussie'))"),
    "l’historique : exécution 1, réussie, lancée par Cicco",
  );
  const exec = conversations().executions[0];
  if (exec.statut !== "fait") {
    const c = conversations();
    console.log("DIAG exec", JSON.stringify({ statut: exec.statut, erreur: exec.erreur, etapes: exec.etapes.map((e) => [e.noeudId, e.statut, e.erreur]) }));
    console.log("DIAG chat", JSON.stringify(c.messages.filter((m) => m.chatId === exec.chatId).map((m) => ({ a: m.author, s: m.statut, e: m.erreur, t: JSON.stringify(m.parts).slice(0, 300) }))));
    console.log("DIAG requetes", fournisseur.requetes.slice(-4).map((q) => q.message.slice(0, 200)).join(" || "));
  }
  verifier(exec.etapes.find((e) => e.noeudId === "salut")?.statut === "fait", "l’étape agent a répondu dans la conversation du workflow");
  verifier(conversations().messages.some((m) => m.chatId === exec.chatId && m.author.kind === "role"), "sa réponse est dans la conversation du workflow");
  verifier(conversations().workflows[0].versions.some((v) => v.raison === "execution"), "une version gardée avant l’exécution");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
  await app.fermer();
  app = null;

  /* ─── Sur un VPS : un vrai serveur KLYRA local, le même outil ───── */
  const vps = path.join(TMP, "vps");
  const vpsHome = path.join(vps, "home");
  mkdirSync(path.join(vpsHome, ".local", "bin"), { recursive: true });
  mkdirSync(path.join(vpsHome, ".claude"), { recursive: true });
  symlinkSync(CLAUDE, path.join(vpsHome, ".local", "bin", "claude"));
  writeFileSync(path.join(vpsHome, ".claude", ".credentials.json"), "{}");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const SERVEUR = path.resolve(import.meta.dirname, "..", "serveur", "klyra-serveur.mjs");
  const envServeur = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k))),
    HOME: vpsHome,
    KLYRA_SERVEUR_DONNEES: path.join(vps, "donnees"),
    KLYRA_SERVEUR_PORT: String(port),
    KLYRA_SERVEUR_HOTE: "127.0.0.1",
    KLYRA_SERVEUR_NOM: "Klyra-VPS",
    ANTHROPIC_BASE_URL: fournisseur.url,
    ANTHROPIC_API_KEY: "sk-faux-essai",
  };
  const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });
  try {
    const adresse = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
    const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
    const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;
    // Sans Claude Code sur ce PC : seul le VPS fait répondre l'assistant.
    app = await lancerApp({ port: 9343, env: { HOME: home, KLYRA_USER_DATA: donnees, PATH: "/usr/bin:/bin" } });
    const bouton = `document.querySelector('nav button[aria-haspopup="menu"][aria-label*="Serveur : "]')`;
    const ligneServeurs = `document.querySelector('[role="menu"][aria-label="Compte"] [aria-haspopup="menu"]')`;
    const ouvrir = async () => {
      if ((await app.ev(`${bouton}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${bouton}.click()`);
      await app.quand(`document.querySelector('[role="menu"][aria-label="Compte"]')`);
      if ((await app.ev(`${ligneServeurs}?.getAttribute('aria-expanded')`)) !== "true") await app.ev(`${ligneServeurs}.click()`);
      return app.quand(`document.querySelector('[role="menu"][aria-label="Serveurs"]')`);
    };
    await ouvrir();
    await app.cliquer("Ajouter un serveur");
    await app.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`);
    await app.saisir('input[aria-label="Lien d’invitation"]', lien);
    await app.cliquer("Rejoindre");
    verifier(await app.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`), "VPS : Klyra-VPS rejoint par le lien");
    await app.aller("/chat?id=dm-principal");
    await ouvrir();
    await app.quand(`[...document.querySelectorAll('[role="menuitemradio"]')].some((b) => b.innerText.includes("Répond"))`);
    await app.ev(`[...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.innerText.split("\\n")[0].trim() === "Klyra-VPS")?.click(); 0`);
    const hote = new URL(adresse).host;
    verifier(await app.quand(`new URLSearchParams(location.search).get("id") === ${JSON.stringify(`dm-principal@${hote}`)}`), "VPS : la conversation de l’assistant sur Klyra-VPS");
    await app.touche("Escape", "Escape", 27);

    const avant = conversations().workflows.length;
    await ecrire("workflow vps");
    await app.aller("/routines?vue=workflows");
    verifier(await app.quand(`${pastille}?.innerText.includes('construit ce workflow')`, 90000), "VPS : la pastille, l’assistant du serveur construit ce workflow");
    const vus = [];
    for (let i = 0; i < 80; i++) {
      const n = await app.ev("document.querySelectorAll('[data-chantier=\"fantome\"], [data-chantier=\"ecrit\"]').length");
      if (!vus.includes(n)) vus.push(n);
      if (await app.ev(`!!${pastille}?.innerText.includes('a construit ce workflow')`)) break;
      await attendre(100);
    }
    verifier(vus.filter((n) => n > 0).length >= 2, `VPS : les cartes paraissent l’une après l’autre (vu : ${vus.join(" → ")})`);
    verifier(await app.quand(`${pastille}?.innerText.includes('a construit ce workflow')`, 60000), "VPS : l’appel relayé à ce PC enregistre le workflow");
    verifier(
      await surDisque(() => conversations().workflows.length === avant + 1 && conversations().workflows.some((w) => w.titre === "Bonjour vps" && w.graphe.noeuds.length === 3)),
      "VPS : le workflow, trois étapes",
    );
    verifier(conversations().workflows.find((w) => w.titre === "Bonjour vps")?.lieu === adresse, "VPS : le workflow appartient à ce serveur");
    verifier(!(await app.ev(`document.body.innerText`)).includes("Bonjour essai"), "VPS : les workflows de ce PC ne sont pas proposés");
    await app.ev(`(() => { localStorage.removeItem("klyra:lieu-actif"); window.dispatchEvent(new Event("klyra:lieu-actif")); })()`);
    verifier(await app.quand(`!document.body.innerText.includes("Bonjour vps")`), "Ce PC : le workflow du VPS n’y est pas");
    verifier(fournisseur.requetes.some((q) => q.resultats.some((r) => !r.erreur && r.texte.includes("Workflow créé : « Bonjour vps »"))), "VPS : la réponse revient à l’agent du serveur");
    verifier(app.erreurs.length === 0, `VPS : aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs.join(" | ")}` : ""}`);
  } finally {
    serveur.kill();
  }
} finally {
  await app?.fermer().catch(() => {});
  fournisseur.fermer();
  rmSync(TMP, { recursive: true, force: true });
}
if (echecs.length) {
  console.error(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nUn agent construit et lance un workflow, en direct sur la page : OK.");
