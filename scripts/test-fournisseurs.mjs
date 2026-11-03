/**
 * Changer de fournisseur dans une conversation, dans l'app de bureau (export statique), avec le vrai
 * Claude Code et le vrai Codex face à deux faux fournisseurs locaux (Anthropic et OpenAI) : aucun
 * compte, aucune dépense. Dossier personnel, CODEX_HOME et données de l'app jetables.
 * Vérifie, par le choix rapide de l'en-tête :
 * - ChatGPT apparaît, avec les modèles que Codex annonce ; le choisir fait répondre Codex ;
 * - de retour sur Claude, l'agent reçoit la conversation, sa réponse ChatGPT marquée comme la sienne ;
 * - de retour sur ChatGPT, Codex reprend son fil et reçoit seulement ce qu'il n'a pas vu ;
 * - la conversation garde son fournisseur et les sessions de chacun sur le disque.
 * Prérequis : `pnpm build && pnpm build:electron`, Claude Code et Codex installés (sinon le test est sauté).
 *   KLYRA_CLAUDE_PATH=… KLYRA_CODEX_PATH=… xvfb-run -a node scripts/test-fournisseurs.mjs --no-sandbox
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";
import { lancerApp, verificateur } from "./pilote-app.mjs";

const { demarrerFauxOpenAI, configCodex } = createRequire(import.meta.url)("./faux-openai.cjs");

const premier = (...chemins) => chemins.find((c) => c && existsSync(c));
const CLAUDE = premier(process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude");
const CODEX = premier(process.env.KLYRA_CODEX_PATH, "/usr/local/bin/codex", "/opt/homebrew/bin/codex");
if (!CLAUDE || !CODEX) {
  console.log("Claude Code ou Codex introuvable : test sauté (KLYRA_CLAUDE_PATH, KLYRA_CODEX_PATH).");
  process.exit(0);
}

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-fournisseurs-"));
const HOME = path.join(TMP, "home");
const DONNEES = path.join(TMP, "donnees");
const CODEX_HOME = path.join(TMP, "codex");
for (const d of [HOME, DONNEES, CODEX_HOME]) mkdirSync(d, { recursive: true });

const anthropic = await demarrerFournisseur([]);
const openai = await demarrerFauxOpenAI();
writeFileSync(path.join(CODEX_HOME, "config.toml"), configCodex(openai.url));

const { echecs, verifier } = verificateur();
const app = await lancerApp({
  port: 9347,
  env: { HOME, KLYRA_USER_DATA: DONNEES, KLYRA_CLAUDE_PATH: CLAUDE, KLYRA_CODEX_PATH: CODEX, CODEX_HOME, FAUX_CLE: "sk-faux-essai", ANTHROPIC_BASE_URL: anthropic.url, ANTHROPIC_API_KEY: "sk-faux-essai" },
});

const BOUTON = `[...document.querySelectorAll('main header button[aria-haspopup="dialog"]')].find((b) => /^(Claude|ChatGPT) · /.test(b.title))`;
const PANNEAU = `document.querySelector('[role="dialog"][aria-label="Fournisseur, modèle et effort"]')`;

/** Ouvre le choix rapide, passe sur l'onglet de ce fournisseur et choisit ce modèle. */
async function choisir(fournisseurNom, modeleNom) {
  await app.ev(`${BOUTON}?.click()`);
  if (!(await app.quand(`${PANNEAU} && ${PANNEAU}.querySelector('[role="tab"][title="${fournisseurNom}"]')`))) return false;
  await app.ev(`${PANNEAU}.querySelector('[role="tab"][title="${fournisseurNom}"]').click()`);
  const radio = `[...${PANNEAU}.querySelectorAll('[role="radio"]')].find((r) => r.innerText.trim().startsWith(${JSON.stringify(modeleNom)}))`;
  if (!(await app.quand(radio))) return false;
  await app.ev(`${radio}.click()`);
  return app.quand(`${BOUTON}?.title.startsWith(${JSON.stringify(`${fournisseurNom} · `)})`);
}

/** Combien de fois ce texte est dans la conversation. */
const compter = (texte) => app.ev(`document.querySelector('main').innerText.split(${JSON.stringify(texte)}).length - 1`);

/** Écrit dans le message et l'envoie (Entrée), puis attend une réponse de plus qui contient ce texte. */
async function ecrire(texte, attendu) {
  const avant = await compter(attendu);
  await app.ev(`document.querySelector('textarea[aria-label="Message"]').focus()`);
  await app.saisir('textarea[aria-label="Message"]', texte);
  await app.touche("Enter", "Enter", 13);
  return app.quand(`document.querySelector('main').innerText.split(${JSON.stringify(attendu)}).length - 1 > ${avant}`, 60_000);
}

/** Avec KLYRA_CAPTURES=<dossier> : une capture de la fenêtre, pour relire l'écran. */
async function capturer(nom) {
  if (!process.env.KLYRA_CAPTURES) return;
  const { data } = await app.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(process.env.KLYRA_CAPTURES, `${nom}.png`), Buffer.from(data, "base64"));
}

const conversation = () => JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8")).chats.find((c) => c.id === "dm-principal");

try {
  await app.aller("/chat?id=dm-principal");
  verifier(await app.quand(BOUTON), "le choix rapide est dans l’en-tête, sur Claude");

  /* 1. Passer sur ChatGPT par le panneau, et lui écrire. */
  verifier(await choisir("ChatGPT", "GPT-6.1-Sol"), "ChatGPT apparaît avec les modèles de Codex ; GPT-6.1-Sol choisi");
  verifier(await ecrire("TEXTE bonjour", "Bonjour de ChatGPT"), "Codex répond dans la conversation");
  verifier(openai.requetes.length === 1 && openai.requetes[0].model === "gpt-6.1-sol", `Codex a appelé OpenAI avec le modèle choisi (${openai.requetes[0]?.model})`);
  verifier(anthropic.requetes.length === 0, "Claude n’a rien reçu pendant ce temps");

  /* 2. Revenir sur Claude : il reçoit la conversation, la réponse de ChatGPT marquée comme la sienne. */
  verifier(await choisir("Claude", "Claude Opus 5.5"), "retour sur Claude par le panneau");
  const avantClaude = anthropic.requetes.length;
  verifier(await ecrire("Et maintenant ?", "\nok"), "Claude répond");
  const recu = anthropic.requetes.slice(avantClaude).map((r) => r.message).find((m) => m.includes("Et maintenant ?")) ?? "";
  verifier(recu.includes("TEXTE bonjour") && recu.includes("(toi, avec ChatGPT) : Bonjour de ChatGPT"), "Claude reçoit la conversation, avec sa réponse ChatGPT marquée comme la sienne");

  /* 3. Revenir sur ChatGPT : Codex reprend son fil et reçoit seulement ce qu'il n'a pas vu. */
  await app.ev(`${BOUTON}?.click()`);
  await app.quand(`${PANNEAU}`);
  await capturer("1-panneau-claude");
  await app.ev(`${PANNEAU}.querySelector('[role="tab"][title="ChatGPT"]').click()`);
  await app.quand(`${PANNEAU}.querySelectorAll('[role="radio"]').length > 3`);
  await capturer("2-panneau-chatgpt");
  await app.touche("Escape", "Escape", 27);
  verifier(await choisir("ChatGPT", "GPT-6.1-Sol"), "de nouveau sur ChatGPT");
  const avantCodex = openai.requetes.length;
  verifier(await ecrire("TEXTE encore", "Bonjour de ChatGPT"), "Codex répond de nouveau");
  const requete = openai.requetes.slice(avantCodex).at(-1);
  const demande = openai.derniereDemande(requete ?? {});
  verifier(JSON.stringify(requete?.input ?? []).includes("TEXTE bonjour"), "Codex a gardé son fil : le premier message y est encore");
  verifier(demande.includes("Et maintenant ?") && demande.includes("(toi, avec Claude) : ok") && !demande.includes("TEXTE bonjour"), "Codex reçoit seulement ce qui s’est dit avec Claude");

  await capturer("3-conversation");
  /* 4. Sur le disque : le fournisseur et les sessions de chacun. */
  await app.quand("false", 1500);
  const c = conversation();
  verifier(c?.fournisseur === "codex", `la conversation garde ChatGPT (${c?.fournisseur})`);
  verifier(!!c?.sessions?.principal && !!c?.sessionsParMoteur?.claude?.principal && c.sessions.principal !== c.sessionsParMoteur.claude.principal, "la session de Codex est active, celle de Claude gardée de côté");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs[0]}` : ""}`);
} finally {
  await app.fermer();
  anthropic.fermer();
  openai.fermer();
  rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
