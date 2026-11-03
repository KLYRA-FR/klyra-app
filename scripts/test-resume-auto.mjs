/**
 * Le résumé automatique (configuration KLYRA `resumeAuto`, src/lib/contexte.ts) dans l'app de bureau,
 * avec le vrai Claude Code face au faux fournisseur : aucun compte, aucune dépense.
 * 1. Un premier message crée la session ; la conversation est ensuite marquée très lourde (95 k jetons).
 * 2. Avant un message : le résumé passe d'abord (sa commande reste hors du fil), puis le message et sa réponse.
 * 3. Après 26 minutes de pause : la conversation est résumée seule, sans nouveau message de la personne.
 * Profil et dossier personnel temporaires. Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:resume-auto          (sous Linux sans bac à sable : -- --no-sandbox)
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
  console.log("Claude Code introuvable : test du résumé automatique sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-resume-auto-"));
const HOME = path.join(TMP, "home");
const DONNEES = path.join(TMP, "userdata");
mkdirSync(HOME, { recursive: true });
mkdirSync(DONNEES, { recursive: true });
const CONVERSATIONS = path.join(DONNEES, "conversations.json");
writeFileSync(CONVERSATIONS, JSON.stringify({ version: 1, chats: [], messages: [] }));
writeFileSync(path.join(DONNEES, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Sam", teinte: null }, agents: {} }));
writeFileSync(
  path.join(DONNEES, "reglages.json"),
  JSON.stringify({ configuration: { consignes: null, memoireAgents: true, proposition: "ecartee", resumeAuto: true } }),
);
const surDisque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));
const messages = () => surDisque().messages.filter((m) => m.chatId === "dm-principal");
const texte = (m) => m.parts.find((p) => p.type === "text")?.text ?? "";

/** Marque la conversation très lourde, mesurée il y a `minutes` minutes (comme si la session avait relu autant). */
function alourdir(minutes) {
  const etat = surDisque();
  const chat = etat.chats.find((c) => c.id === "dm-principal");
  chat.contexte = { principal: { jetons: 95_000, base: 15_000, le: new Date(Date.now() - minutes * 60_000).toISOString(), session: chat.sessions.principal } };
  writeFileSync(CONVERSATIONS, JSON.stringify(etat));
}

const fournisseur = await demarrerFournisseur([]);
const env = { HOME, KLYRA_USER_DATA: DONNEES, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" };
let app = null;

/** Écrit dans le composeur et attend que tout soit retombé (réponses finies, file vide, sauvegarde faite). */
async function dire(texteMessage, attendus) {
  await app.quand(`!!document.querySelector("textarea")`, 15000);
  await app.ev(`(() => { const t = document.querySelector("textarea"); t.focus(); return document.execCommand("insertText", false, ${JSON.stringify(texteMessage)}); })()`);
  await attendre(300);
  await app.ev(`document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))`);
  for (let i = 0; i < 90 && messages().filter((m) => m.statut === "fait").length < attendus; i++) await attendre(1000);
  await attendre(2500);
}

try {
  app = await lancerApp({ port: 9381, env });
  await app.aller("/chat?id=dm-principal");
  await dire("Bonjour, on commence.", 1);
  verifier(!!surDisque().chats.find((c) => c.id === "dm-principal")?.sessions?.principal, "le premier message crée la session de l’assistant");
  await app.fermer();

  /* 2. Avant un message, dans une conversation très lourde au cache encore chaud. */
  alourdir(1);
  app = await lancerApp({ port: 9381, env });
  await app.aller("/chat?id=dm-principal");
  const avant = messages().length;
  await dire("Et la suite ?", 3);
  const nouveaux = messages().slice(avant);
  const resume = nouveaux.find((m) => m.compactionAuto === "envoi");
  verifier(!!resume && resume.compaction === true && resume.statut === "fait" && /résumée automatiquement avant ton message/.test(texte(resume)), `avant un message : le résumé passe (${resume ? texte(resume).slice(0, 90) : "aucun"})`);
  const ordre = nouveaux.map((m) => (m.compactionAuto ? "résumé" : m.author.kind === "user" ? "message" : "réponse"));
  verifier(JSON.stringify(ordre) === JSON.stringify(["résumé", "message", "réponse"]), `puis le message et sa réponse, dans cet ordre (${ordre.join(", ")})`);
  verifier(!messages().some((m) => texte(m).startsWith("/compact")), "la commande du résumé n’apparaît pas dans la conversation");
  await app.fermer();

  /* 3. Après 26 minutes de pause, sans nouveau message. */
  alourdir(26);
  const avantPause = messages().length;
  app = await lancerApp({ port: 9381, env });
  await app.aller("/chat?id=dm-principal");
  for (let i = 0; i < 60 && !messages().slice(avantPause).some((m) => m.compactionAuto === "pause" && m.statut === "fait"); i++) await attendre(1000);
  await attendre(1500);
  const pause = messages().slice(avantPause);
  verifier(
    pause.length === 1 && pause[0].compactionAuto === "pause" && /pendant la pause, avant que le cache n’expire/.test(texte(pause[0])),
    `après une pause : la conversation est résumée seule (${pause.map((m) => m.compactionAuto ?? m.author.kind).join(", ") || "rien"})`,
  );
  const mesure = surDisque().chats.find((c) => c.id === "dm-principal")?.contexte?.principal;
  verifier(!!mesure && mesure.jetons < 95_000, `la taille est remise au socle et au résumé (${mesure?.jetons})`);
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
