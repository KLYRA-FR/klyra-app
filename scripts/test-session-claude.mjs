/**
 * Ce que l'app reprend de Claude Code (Desktop) dans une conversation, à l'écran, avec le vrai Claude Code face au
 * faux fournisseur (aucun compte, aucune dépense) : profil, dossier personnel et projet temporaires.
 *  1. la réflexion, repliée, s'ouvre d'un clic ; la jauge du contexte apparaît ;
 *  2. une question à choix : la carte, une option, « Répondre », la réponse revient au modèle ;
 *  3. le mode plan (bouton, Maj + Tab, « /plan ») : le plan arrive, « Lancer le plan » ;
 *  4. un fichier créé puis modifié : leurs diffs, « Annuler » remet le fichier ;
 *  5. une commande : sa sortie en direct, puis entière dans les étapes ;
 *  6. « Envoyer maintenant » : l'agent s'arrête et lit le message en attente ;
 *  7. « Revenir à avant ce message » : le fichier créé est retiré, les messages suivants aussi, le texte revient
 *     dans le champ, et la session reprend au repère (une copie) ;
 *  8. « @ » propose les fichiers du projet ; « / » les commandes de l'app et de Claude Code ;
 *  9. la fiche du projet : autorisations retenues (Retirer), sessions du terminal (Reprendre ici), branche de travail ;
 * 10. la commande qui reprend la session dans un terminal.
 * Prérequis : `pnpm build && pnpm build:electron`, Claude Code (KLYRA_CLAUDE_PATH), git.
 *   xvfb-run -a pnpm test:session-claude:app -- --no-sandbox
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const surPath = () => {
  try {
    return execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude", surPath()].find((c) => c && existsSync(c));
if (!CLAUDE) {
  console.log("Claude Code introuvable : test sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-session-app-"));
const HOME = path.join(TMP, "home");
const DONNEES = path.join(TMP, "userdata");
const PROJET = path.join(TMP, "site");
mkdirSync(path.join(HOME, ".claude", "projects"), { recursive: true });
mkdirSync(DONNEES, { recursive: true });
mkdirSync(path.join(PROJET, "src"), { recursive: true });
writeFileSync(path.join(PROJET, "src", "page.tsx"), "export default 1;\n");
const git = (...args) => execFileSync("git", ["-c", "user.email=essai@klyra.fr", "-c", "user.name=Essai", ...args], { cwd: PROJET, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-qm", "départ");

const CONVERSATIONS = path.join(DONNEES, "conversations.json");
const maintenant = new Date().toISOString();
writeFileSync(
  CONVERSATIONS,
  JSON.stringify({
    version: 1,
    acces: "tout",
    projects: [{ id: "site", name: "Site", subtitle: "essai", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: PROJET, files: [], updatedAt: maintenant }],
    chats: [{ id: "conv-site", kind: "equipe", projectId: "site", title: "Essai", roleIds: ["principal"], updatedAt: maintenant, sessions: {}, luJusqua: null }],
    messages: [],
  }),
);
writeFileSync(path.join(DONNEES, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Sam", teinte: null }, agents: {} }));
writeFileSync(path.join(DONNEES, "reglages.json"), JSON.stringify({ configuration: { consignes: null, memoireAgents: true, proposition: "ecartee", resumeAuto: false } }));
const disque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));
const chat = (id = "conv-site") => disque().chats.find((c) => c.id === id);
const messages = (id = "conv-site") => disque().messages.filter((m) => m.chatId === id);
const reponses = () => messages().filter((m) => m.author.kind === "role");

const fournisseur = await demarrerFournisseur([]);
const env = { HOME, KLYRA_USER_DATA: DONNEES, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" };
let app = null;

/** Écrit dans le champ comme une personne (sans envoyer). */
const ecrire = async (texte) => {
  await app.quand(`!!document.querySelector("textarea")`, 15000);
  await app.ev(`(() => { const t = document.querySelector("textarea"); t.focus(); return document.execCommand("insertText", false, ${JSON.stringify(texte)}); })()`);
  await attendre(300);
};
const entree = () => app.ev(`document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))`);
/** Envoie un message et attend `n` réponses finies (faites ou arrêtées) dans la conversation. */
const dire = async (texte, n) => {
  await ecrire(texte);
  await entree();
  for (let i = 0; i < 90 && reponses().filter((m) => m.statut && m.statut !== "en-cours").length < n; i++) await attendre(1000);
  await attendre(1200);
};
const cliquerDans = (selecteur, libelle) =>
  app.ev(`(() => { const z = document.querySelector(${JSON.stringify(selecteur)}); const b = z && [...z.querySelectorAll("button")].find((x) => x.innerText.trim().startsWith(${JSON.stringify(libelle)}) && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const corps = () => app.ev(`document.body.innerText`);

try {
  app = await lancerApp({ port: 9391, env });
  await app.aller("/chat?id=conv-site");

  /* 1. Réflexion repliée, jauge du contexte. */
  await dire("pense couleur", 1);
  verifier(await app.quand(`!!document.querySelector("[data-reflexion]")`, 5000), "la réflexion est dans le fil, repliée");
  verifier(!(await corps()).includes("Je pèse la question couleur"), "repliée : son texte n'est pas affiché");
  await cliquerDans("[data-reflexion]", "Réflexion");
  verifier(await app.quand(`document.body.innerText.includes("Je pèse la question couleur")`, 3000), "un clic l'ouvre");
  verifier(typeof reponses()[0]?.uuidFin === "string", "la réponse garde son repère de session (uuidFin)");
  verifier(chat()?.fenetres?.principal > 0, `la fenêtre du modèle est notée (${chat()?.fenetres?.principal})`);
  verifier(await app.quand(`!!document.querySelector("[data-jauge-contexte]")`, 5000), "la jauge du contexte est dans le composeur");

  /* 2. Question à choix. */
  await ecrire("question logo");
  await entree();
  verifier(await app.quand(`!!document.querySelector('[data-questions="attente"]')`, 60000), "la carte des questions arrive");
  verifier((await corps()).includes("Quelle couleur pour logo ?") && (await corps()).includes("Sam attend ta réponse"), "la question est lisible, Sam attend ta réponse");
  await app.ev(`[...document.querySelectorAll('[data-questions="attente"] [role="radio"]')].find((b) => b.innerText.includes("Rouge"))?.click()`);
  await attendre(200);
  await cliquerDans('[data-questions="attente"]', "Répondre");
  for (let i = 0; i < 60 && reponses().filter((m) => m.statut === "fait").length < 2; i++) await attendre(1000);
  verifier(await app.quand(`!!document.querySelector('[data-questions="repondue"]')`, 5000), "la carte se résume, répondue");
  verifier(JSON.stringify(reponses()[1]?.parts).includes("Rouge") && reponses()[1]?.parts.some((p) => p.type === "text" && p.text.includes("Rouge")), "le modèle a reçu « Rouge »");

  /* 3. Mode plan. */
  await cliquerDans("form", "Plan");
  verifier(await app.quand(`!!document.querySelector("[data-mode-plan]")`, 3000), "le bouton Plan met le mode plan (et le dit sous le champ)");
  await attendre(500);
  verifier(chat()?.modePlan === true, "le mode plan est gardé par la conversation");
  await ecrire("plan menu");
  await entree();
  verifier(await app.quand(`!!document.querySelector('[data-plan="attente"]')`, 60000), "le plan arrive dans une carte");
  verifier((await corps()).includes("Plan menu"), "le plan est lisible");
  await cliquerDans('[data-plan="attente"]', "Lancer le plan");
  for (let i = 0; i < 60 && reponses().filter((m) => m.statut === "fait").length < 3; i++) await attendre(1000);
  await attendre(800);
  verifier(await app.quand(`!!document.querySelector('[data-plan="lance"]')`, 5000), "« Lancer le plan » : la carte le dit");
  verifier(chat()?.modePlan === false && !(await app.ev(`!!document.querySelector("[data-mode-plan]")`)), "la conversation sort du mode plan");
  /* Maj + Tab et « /plan » le remettent et l'enlèvent. */
  await app.ev(`(() => { const t = document.querySelector("textarea"); t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", shiftKey: true, bubbles: true })); })()`);
  verifier(await app.quand(`!!document.querySelector("[data-mode-plan]")`, 3000), "Maj + Tab met le mode plan");
  await ecrire("/plan");
  await entree();
  verifier(await app.quand(`!document.querySelector("[data-mode-plan]")`, 3000), "« /plan » l'enlève, sans rien envoyer");
  verifier(reponses().length === 3, "rien n'est parti à l'agent");

  /* 4. Fichier créé, puis modifié ; « Annuler » sur la modification. */
  await dire("ecris note", 4);
  const note = path.join(PROJET, "note.txt");
  verifier(existsSync(note), "l'agent a créé note.txt");
  verifier(await app.quand(`[...document.querySelectorAll("[data-modifications]")].some((s) => s.innerText.includes("1 fichier modifié") && s.innerText.includes("créé"))`, 5000), "sous la réponse : 1 fichier modifié, créé");
  await dire("modifie note", 5);
  verifier(readFileSync(note, "utf8") === "salut note\n", "puis l'a modifié");
  await app.ev(`(() => { const s = [...document.querySelectorAll("[data-modifications]")].at(-1); s.querySelector("[data-fichier-modifie] button")?.click(); })()`);
  verifier(await app.quand(`!!document.querySelector("[data-modifications] [data-diff]")`, 3000), "un clic sur le fichier montre son diff");
  verifier(await app.ev(`[...document.querySelectorAll("[data-modifications]")].at(-1).innerText.includes("salut note")`), "le diff montre la ligne ajoutée");
  await app.ev(`(() => { const s = [...document.querySelectorAll("[data-modifications]")].at(-1); [...s.querySelectorAll("button")].find((b) => b.innerText.trim() === "Annuler")?.click(); })()`);
  for (let i = 0; i < 20 && readFileSync(note, "utf8") !== "bonjour note\n"; i++) await attendre(250);
  verifier(readFileSync(note, "utf8") === "bonjour note\n", "« Annuler » remet le fichier comme avant la réponse");
  verifier(await app.quand(`!![...document.querySelectorAll("[data-modifications]")].at(-1).querySelector('[data-fichier-modifie="annulee"]')`, 3000), "la ligne dit « Annulé »");
  await attendre(800);
  verifier((chat()?.annulations ?? []).some((a) => a.fichiers.includes(note)), "l'annulation est notée pour l'agent");

  /* 5. Une commande : sa sortie en direct, puis entière. */
  await ecrire("commande compte");
  await entree();
  verifier(await app.quand(`[...document.querySelectorAll('[data-sortie="en-cours"]')].some((p) => p.innerText.includes("ligne"))`, 30000), "la sortie de la commande s'affiche pendant qu'elle tourne");
  for (let i = 0; i < 60 && reponses().filter((m) => m.statut === "fait").length < 6; i++) await attendre(1000);
  const etapeCommande = reponses().at(-1)?.parts.find((p) => p.type === "etapes")?.etapes.find((e) => e.outil === "Bash");
  verifier(etapeCommande?.sortie?.includes("ligne 6") && typeof etapeCommande.debut === "number" && typeof etapeCommande.fin === "number", "la sortie entière et la durée sont gardées avec l'étape");
  verifier(fournisseur.requetes.at(-1) && JSON.stringify(fournisseur.requetes.filter((q) => JSON.stringify(q.corps ?? {}).includes("commande compte"))[0]?.corps ?? {}).includes("annulé des modifications"), "l'agent a appris l'annulation à son message suivant");

  /* 6. « Envoyer maintenant » : l'agent s'arrête et lit le message en attente. */
  await ecrire("commande longue");
  await entree();
  await app.quand(`!!document.querySelector('[data-etape="Bash"]') || !!document.querySelector('[data-sortie="en-cours"]') || document.body.innerText.includes("Compte longue")`, 30000);
  await ecrire("pense vite");
  await entree();
  verifier(await app.quand(`document.body.innerText.includes("Envoyer maintenant")`, 5000), "le message attend dans la file, avec « Envoyer maintenant »");
  await app.cliquer("Envoyer maintenant");
  for (let i = 0; i < 60 && reponses().filter((m) => m.statut && m.statut !== "en-cours").length < 8; i++) await attendre(1000);
  const [arretee, suivante] = reponses().slice(-2);
  verifier(arretee?.statut === "erreur" && arretee.erreur === "Arrêté par toi." && suivante?.statut === "fait", "l'agent s'arrête là où il en est, puis répond au message");

  /* 7. Revenir à avant « ecris note ». */
  const ecrisNote = messages().find((m) => m.author.kind === "user" && m.parts.some((p) => p.type === "text" && p.text === "ecris note"));
  const repereAvant = reponses()[2]?.uuidFin;
  const sessionAvant = chat()?.sessions?.principal;
  await app.ev(`document.querySelector('[data-message="${ecrisNote?.id}"] [data-cherchable]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 300, clientY: 300 }))`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="menuitem"]')].some((x) => x.innerText.includes("Revenir à avant ce message"))`, 3000), "le clic droit sur un message propose « Revenir à avant ce message »");
  await app.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((x) => x.innerText.includes("Revenir à avant ce message"))?.click()`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="dialog"]')].some((d) => d.innerText.includes("Remettre les fichiers comme avant") && d.innerText.includes("1 fichier modifié"))`, 3000), "la fenêtre propose les fichiers (1 modifié depuis) et la conversation");
  await app.ev(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim() === "Revenir")?.click()`);
  for (let i = 0; i < 20 && existsSync(note); i++) await attendre(250);
  await attendre(800);
  verifier(!existsSync(note), "le fichier créé depuis est retiré");
  verifier(!messages().some((m) => m.id === ecrisNote?.id) && reponses().length === 3, `les messages depuis sont retirés (${reponses().length} réponses restent)`);
  verifier((await app.ev(`document.querySelector("textarea").value`)).includes("ecris note"), "le texte du message revient dans le champ");
  verifier(chat()?.reprises?.principal === repereAvant, "la session reprendra au repère de la réponse d'avant");
  await app.saisir("textarea", "");
  await attendre(300);
  await dire("pense apres", 4);
  verifier(chat()?.sessions?.principal && chat().sessions.principal !== sessionAvant && !chat()?.reprises?.principal, "le message suivant part d'une copie de la session, reprise au repère");
  const derniere = fournisseur.requetes.filter((q) => JSON.stringify(q.corps ?? {}).includes("pense apres")).at(-1);
  verifier(!!derniere && !JSON.stringify(derniere.corps).includes("modifie note"), "le modèle ne relit rien d'après le repère");

  /* 8. « @ » et « / ». */
  await ecrire("regarde @pag");
  verifier(await app.quand(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].some((o) => o.innerText.includes("page.tsx"))`, 8000), "« @ » propose les fichiers du projet");
  await entree();
  await attendre(300);
  verifier((await app.ev(`document.querySelector("textarea").value`)) === "regarde @src/page.tsx ", "Entrée insère « @src/page.tsx »");
  await app.saisir("textarea", "");
  await attendre(200);
  await ecrire("/");
  const commandes = await app.ev(`[...document.querySelectorAll('[role="listbox"][aria-label="Compétences"] [role="option"]')].map((o) => o.innerText.split("\\n")[0])`);
  verifier(commandes.includes("/plan") && commandes.includes("/compact") && commandes.includes("/clear"), `« / » propose les commandes de l'app (${commandes.slice(0, 6).join(" ")})`);
  await ecrire("sec");
  verifier(await app.quand(`[...document.querySelectorAll('[role="listbox"][aria-label="Compétences"] [role="option"]')].some((o) => o.innerText.includes("/security-review"))`, 3000), "et celles que la session de Claude Code annonce (/security-review)");
  await app.saisir("textarea", "/");
  await ecrire("doc");
  verifier(!(await app.ev(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].some((o) => o.innerText.includes("/doctor"))`)), "sans celles réservées au terminal (/doctor)");
  await app.saisir("textarea", "");

  /* 10. La commande du terminal. */
  const commande = await app.ev(`window.klyra.claude.commandeTerminal("principal", { dossier: ${JSON.stringify(PROJET)}, sessionId: ${JSON.stringify(chat()?.sessions?.principal)}, lieu: null }).then((r) => r.ok ? r.data : r.message)`);
  verifier(commande === `cd '${PROJET}' && claude --resume ${chat()?.sessions?.principal}`, `la commande du terminal (${commande})`);
  await app.ev(`document.querySelector('button[aria-label="Plus d’options"]')?.click()`);
  verifier(await app.quand(`[...document.querySelectorAll('[role="menuitem"]')].some((x) => x.innerText.includes("Copier la commande du terminal"))`, 3000), "le « … » de la conversation propose « Copier la commande du terminal »");
  await app.touche("Escape", "Escape", 27);

  /* 9. La fiche du projet. */
  mkdirSync(path.join(PROJET, ".claude"), { recursive: true });
  writeFileSync(path.join(PROJET, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test:*)"] } }));
  const terminal = "44444444-4444-4444-8444-444444444444";
  const dossierSessions = path.join(HOME, ".claude", "projects", PROJET.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dossierSessions, { recursive: true });
  writeFileSync(
    path.join(dossierSessions, `${terminal}.jsonl`),
    [{ type: "user", message: { role: "user", content: "Corrige le pied de page" }, timestamp: "2026-11-09T08:00:00Z" }, { type: "assistant", message: { content: [{ type: "text", text: "Pied de page corrigé." }] }, timestamp: "2026-11-09T08:00:05Z" }].map((x) => JSON.stringify(x)).join("\n"),
  );
  await app.aller("/projet?id=site&nouvelle=1");
  verifier(await app.quand(`!!document.querySelector("[data-autorisations-projet]") && document.querySelector("[data-autorisations-projet]").innerText.includes("les commandes « npm test… »")`, 10000), "la fiche du projet montre les autorisations retenues, en mots");
  await cliquerDans("[data-autorisations-projet]", "Retirer");
  for (let i = 0; i < 20 && readFileSync(path.join(PROJET, ".claude", "settings.local.json"), "utf8").includes("npm test"); i++) await attendre(250);
  verifier(!readFileSync(path.join(PROJET, ".claude", "settings.local.json"), "utf8").includes("npm test"), "« Retirer » l'enlève des réglages du projet");
  verifier(await app.quand(`!!document.querySelector("[data-sessions-terminal]") && document.querySelector("[data-sessions-terminal]").innerText.includes("Corrige le pied de page")`, 10000), "les sessions du terminal du projet sont proposées (sans celles de l'app)");
  verifier(!(await app.ev(`document.querySelector("[data-sessions-terminal]").innerText.includes("pense couleur")`)), "celles de l'app n'y sont pas");
  await cliquerDans("[data-sessions-terminal]", "Reprendre ici");
  await app.quand(`location.search.includes("id=") && !location.pathname.includes("projet")`, 8000);
  await attendre(1000);
  const reprise = disque().chats.find((c) => c.sessions?.principal === terminal);
  verifier(!!reprise && messages(reprise.id).length === 2 && (await corps()).includes("Pied de page corrigé."), "« Reprendre ici » ouvre une conversation avec ses messages, sur la même session");
  /* Branche de travail, depuis le « … » de la fiche du projet. */
  await app.aller("/projet?id=site&nouvelle=1");
  await app.quand(`!!document.querySelector('button[aria-label="Options du projet"]')`, 8000);
  await app.ev(`document.querySelector('button[aria-label="Options du projet"]').click()`);
  await app.quand(`[...document.querySelectorAll('[role="menuitem"]')].some((x) => x.innerText.includes("Nouvelle branche de travail"))`, 3000);
  await app.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((x) => x.innerText.includes("Nouvelle branche de travail"))?.click()`);
  await app.quand(`!!document.querySelector('[role="dialog"] input')`, 3000);
  await app.saisir('[role="dialog"] input', "essai menu");
  await attendre(200);
  await app.ev(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim() === "Créer la branche")?.click()`);
  for (let i = 0; i < 30 && !disque().projects.some((p) => p.brancheDe === "site"); i++) await attendre(300);
  const branche = disque().projects.find((p) => p.brancheDe === "site");
  verifier(branche?.branche === "klyra/essai-menu" && existsSync(path.join(branche.folder, "src", "page.tsx")), `une branche de travail devient un projet à part (${branche?.name})`);
  verifier(!git("status", "--porcelain").includes("worktrees"), "la branche de travail n'apparaît pas dans les changements du dépôt principal");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page (${app.erreurs.join(" | ") || "aucune"})`);
} catch (erreur) {
  verifier(false, `parcours interrompu : ${erreur instanceof Error ? erreur.stack : erreur}`);
} finally {
  app?.fermer();
  fournisseur.fermer?.();
  await attendre(500);
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (echecs.length) {
  console.error(`${echecs.length} vérification(s) en échec.`);
  process.exit(1);
}
console.log("Ce que l'app reprend de Claude Code : tout est vert.");
