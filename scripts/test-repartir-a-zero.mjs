/**
 * « Repartir à zéro » (src/lib/contexte.ts) dans l'app de bureau, avec le vrai Claude Code face au
 * faux fournisseur : aucun compte, aucune dépense.
 * 1. Un premier échange crée la session. Le « … » propose de repartir ; on repart.
 * 2. Les messages restent lisibles, un séparateur les coupe, le « … » est grisé tant que rien n'a suivi,
 *    et « Réessayer » a disparu de l'ancienne réponse.
 * 3. Le message suivant ouvre une session neuve : le modèle ne reçoit rien de ce qui précède.
 * 4. Après un redémarrage, le séparateur est toujours là et l'ancien échange reste oublié.
 * Profil et dossier personnel temporaires. Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:repartir-a-zero          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find(
  (c) => c && existsSync(c),
);
if (!CLAUDE) {
  console.log("Claude Code introuvable : test de « Repartir à zéro » sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-repartir-"));
const HOME = path.join(TMP, "home");
const DONNEES = path.join(TMP, "userdata");
mkdirSync(HOME, { recursive: true });
mkdirSync(DONNEES, { recursive: true });
const CONVERSATIONS = path.join(DONNEES, "conversations.json");
writeFileSync(CONVERSATIONS, JSON.stringify({ version: 1, chats: [], messages: [] }));
writeFileSync(path.join(DONNEES, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Sam", teinte: null }, agents: {} }));
writeFileSync(path.join(DONNEES, "reglages.json"), JSON.stringify({ configuration: { consignes: null, memoireAgents: true, proposition: "ecartee", resumeAuto: false } }));
const surDisque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));
const chat = () => surDisque().chats.find((c) => c.id === "dm-principal");
const messages = () => surDisque().messages.filter((m) => m.chatId === "dm-principal");
const SECRET = "MOT-SECRET-AVANT-LE-DEPART";

const fournisseur = await demarrerFournisseur([]);
const env = { HOME, KLYRA_USER_DATA: DONNEES, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" };
let app = null;

async function dire(texte, attendus) {
  await app.quand(`!!document.querySelector("textarea")`, 15000);
  await app.ev(`(() => { const t = document.querySelector("textarea"); t.focus(); return document.execCommand("insertText", false, ${JSON.stringify(texte)}); })()`);
  await attendre(300);
  await app.ev(`document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))`);
  for (let i = 0; i < 90 && messages().filter((m) => m.statut === "fait").length < attendus; i++) await attendre(1000);
  await attendre(2500);
}

const ouvrirMenu = () => app.ev(`document.querySelector('button[aria-label="Plus d’options"]')?.click()`);
const ligneRepartir = () =>
  app.ev(`(() => {
    const l = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.innerText.includes("Repartir à zéro"));
    return l ? { grisee: l.getAttribute("aria-disabled") === "true" || l.disabled === true, texte: l.innerText } : null;
  })()`);
const separateurs = () => app.ev(`document.querySelectorAll("[data-depart]").length`);

try {
  app = await lancerApp({ port: 9383, env });
  await app.aller("/chat?id=dm-principal");
  await dire(`Retiens ceci : ${SECRET}.`, 1);
  const ancienne = chat()?.sessions?.principal;
  verifier(!!ancienne, "le premier message crée la session de l’assistant");
  verifier(fournisseur.requetes.some((q) => JSON.stringify(q).includes(SECRET)), "le modèle a bien reçu le premier message");

  await ouvrirMenu();
  await attendre(300);
  const avant = await ligneRepartir();
  verifier(!!avant && !avant.grisee, `le « … » propose de repartir à zéro (${avant?.texte ?? "absent"})`);
  await app.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((x) => x.innerText.includes("Repartir à zéro"))?.click()`);
  await attendre(1500);

  verifier((await separateurs()) === 1, "un séparateur coupe la conversation");
  verifier(await app.ev(`document.body.innerText.includes(${JSON.stringify(SECRET)})`), "l’ancien message reste lisible");
  await ouvrirMenu();
  await attendre(300);
  const apres = await ligneRepartir();
  verifier(!!apres?.grisee, `rien depuis le départ : la ligne est grisée (${apres?.texte ?? "absente"})`);
  await app.touche("Escape", "Escape", 27);

  const fin = await app.ev(`(() => {
    const boutons = [...document.querySelectorAll('[data-auteur="role"] button')];
    const plus = boutons.find((b) => /plus d.actions|actions/i.test(b.getAttribute("aria-label") ?? ""));
    plus?.click();
    return !!plus;
  })()`);
  await attendre(300);
  verifier(fin && !(await app.ev(`[...document.querySelectorAll('[role="menu"][aria-label="Actions sur la réponse"] [role="menuitem"]')].some((x) => x.innerText.includes("Réessayer"))`)), "l’ancienne réponse ne propose plus « Réessayer »");
  await app.touche("Escape", "Escape", 27);
  await app.fermer();

  const disque = chat();
  verifier(disque?.departs?.length === 1 && Object.keys(disque.sessions).length === 0, "le départ est enregistré, sans session");

  const debut = fournisseur.requetes.length;
  app = await lancerApp({ port: 9383, env });
  await app.aller("/chat?id=dm-principal");
  await app.quand(`!!document.querySelector("[data-depart]")`, 15000);
  verifier(true, "après un redémarrage, le séparateur est toujours là");
  await dire("Autre sujet, sans rapport.", 2);

  const nouvelles = fournisseur.requetes.slice(debut);
  verifier(nouvelles.length > 0, `le modèle a reçu le nouveau message (${nouvelles.length} requête(s))`);
  verifier(!nouvelles.some((q) => JSON.stringify(q).includes(SECRET)), "le modèle ne reçoit rien de ce qui précède le départ");
  const session = chat()?.sessions?.principal;
  verifier(!!session && session !== ancienne, `une session neuve (${session?.slice(0, 8)} ≠ ${ancienne?.slice(0, 8)})`);
  verifier((await separateurs()) === 1, "toujours un seul séparateur, au-dessus du nouveau message");
  verifier(await app.ev(`(() => {
    const s = document.querySelector("[data-depart]");
    const apres = [...document.querySelectorAll("[data-message]")].filter((m) => s.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING);
    return apres.length >= 2 && !apres.some((m) => m.innerText.includes(${JSON.stringify(SECRET)}));
  })()`), "le séparateur tombe entre l’ancien échange et le nouveau");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page (${app.erreurs.join(" | ") || "aucune"})`);
} catch (erreur) {
  verifier(false, `parcours interrompu : ${erreur instanceof Error ? erreur.message : erreur}`);
} finally {
  await app?.fermer().catch(() => {});
  fournisseur.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nTout est bon.");
