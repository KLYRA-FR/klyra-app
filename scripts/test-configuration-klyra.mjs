/**
 * La configuration KLYRA (electron/configuration-klyra.ts) de bout en bout, avec le vrai Claude Code
 * face au faux fournisseur : aucun compte, aucune dépense.
 * - Par défaut : la carte « Des agents plus économes » sur l'Accueil ; pas de consignes KLYRA dans ce que
 *   reçoit le modèle ; la mémoire d'un agent (`memory: project`) est chargée.
 * - « Adopter » : réglages enregistrés, carte partie ; au message suivant, les consignes KLYRA sont dans la
 *   requête et la mémoire de l'agent n'est plus chargée (CLAUDE_CODE_DISABLE_AUTO_MEMORY), sans que sa
 *   fiche change.
 * - Réglages › Agents : « Adoptée », et l'interrupteur de la mémoire la rallume.
 * Profil et dossier personnel temporaires. Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:configuration          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demanderA, demarrerFournisseur, suivreEvenements } from "./faux-fournisseur.mjs";
import { attendre, lancerApp, verificateur } from "./pilote-app.mjs";

const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find(
  (c) => c && existsSync(c),
);
if (!CLAUDE) {
  console.log("Claude Code introuvable : test de la configuration KLYRA sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-configuration-"));
const HOME = path.join(TMP, "home");
const DONNEES = path.join(TMP, "userdata");
const AGENTS = path.join(HOME, ".claude", "agents");
mkdirSync(AGENTS, { recursive: true });
mkdirSync(DONNEES, { recursive: true });

const FICHE = `---\nname: alpha\ndisplayName: Alma\ndescription: "Essai — Alma. Appelle Alma pour l’essai."\nmemory: project\n---\n\n# Alma — Essai\n\nSOUS-AGENT-TEST-alpha\n`;
writeFileSync(path.join(AGENTS, "alpha.md"), FICHE);
writeFileSync(path.join(DONNEES, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [] }));
writeFileSync(
  path.join(DONNEES, "mes-agents.json"),
  JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Sam", teinte: null }, agents: { alpha: { actif: true, ajouteLe: 1, origine: { type: "local" }, empreinte: null } } }),
);
const empreinteFiche = () => createHash("sha256").update(readFileSync(path.join(AGENTS, "alpha.md"))).digest("hex");
const ficheAvant = empreinteFiche();
const reglagesSurDisque = () => {
  try {
    return JSON.parse(readFileSync(path.join(DONNEES, "reglages.json"), "utf8"));
  } catch {
    return null;
  }
};

const fournisseur = await demarrerFournisseur(["alpha"]);
const app = await lancerApp({
  port: 9379,
  env: { HOME, KLYRA_USER_DATA: DONNEES, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" },
});

/** Ce que reçoivent l'assistant et l'agent appelé, pour une demande « appelle alpha ». */
async function requetes() {
  const r = await demanderA(app, fournisseur, { agent: null, prompt: "appelle alpha" });
  const principal = r.requetes.find((q) => q.principal);
  const sousAgent = r.requetes.find((q) => q.sousAgent === "alpha");
  return { principal: JSON.stringify(principal?.corps ?? {}), sousAgent: sousAgent ? JSON.stringify(sousAgent.corps ?? {}) : null };
}
const cliquer = async (expression) => {
  const r = await app.ev(`(() => { const b = ${expression}; const box = b?.getBoundingClientRect(); b?.scrollIntoView({ block: "center" }); return !!box; })()`);
  if (!r) throw new Error(`introuvable : ${expression}`);
  await app.ev(`(${expression}).click()`);
  await attendre(800);
};

try {
  await suivreEvenements(app);
  await app.aller("/");
  await app.quand(`!!document.querySelector("[data-carte-configuration]")`, 15000).catch(() => {});
  verifier(await app.ev(`!!document.querySelector("[data-carte-configuration]")`), "par défaut : la carte « Des agents plus économes » est sur l’Accueil");

  const avant = await requetes();
  verifier(!avant.principal.includes("Consignes KLYRA"), "par défaut : pas de consignes KLYRA dans ce que reçoit l’assistant");
  verifier(!!avant.sousAgent && avant.sousAgent.includes("agent-memory"), "par défaut : la mémoire de l’agent (memory: project) est chargée");

  await app.aller("/");
  await cliquer(`[...document.querySelectorAll("[data-carte-configuration] button")].find((b) => b.innerText.trim() === "Adopter")`);
  await attendre(800);
  const reglages = reglagesSurDisque()?.configuration;
  verifier(
    reglages?.memoireAgents === false && reglages?.proposition === "adoptee" && /Cherche avant de lire/.test(reglages?.consignes?.texte ?? ""),
    `« Adopter » enregistre la configuration recommandée (${JSON.stringify(reglages)?.slice(0, 120)})`,
  );
  verifier(!(await app.ev(`!!document.querySelector("[data-carte-configuration]")`)), "la carte quitte l’Accueil une fois adoptée");

  const apres = await requetes();
  verifier(apres.principal.includes("Consignes KLYRA, choisies par la personne") && apres.principal.includes("Cherche avant de lire"), "adoptée : les consignes KLYRA sont dans ce que reçoit l’assistant");
  verifier(!!apres.sousAgent && !apres.sousAgent.includes("agent-memory"), "adoptée : la mémoire de l’agent n’est plus chargée");
  verifier(empreinteFiche() === ficheAvant, "la fiche de l’agent n’a pas changé (memory: project toujours écrit)");

  await app.aller("/reglages?section=agents");
  await app.quand(`!!document.getElementById("reglage-configuration-klyra")`, 15000).catch(() => {});
  verifier(await app.ev(`document.getElementById("reglage-configuration-klyra")?.innerText.includes("Adoptée") ?? false`), "Réglages › Agents : la configuration recommandée est dite adoptée");
  await cliquer(`document.querySelector('#reglage-memoire-agents [role="switch"]')`);
  verifier(reglagesSurDisque()?.configuration?.memoireAgents === true, "Réglages › Agents : l’interrupteur rallume la mémoire des agents");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page (${app.erreurs.join(" | ") || "aucune"})`);
} catch (erreur) {
  verifier(false, `parcours interrompu : ${erreur instanceof Error ? erreur.message : erreur}`);
} finally {
  await app.fermer();
  fournisseur.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nTout est bon.");
