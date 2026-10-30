/**
 * Ce que l'assistant peut vraiment appeler, avec le vrai Claude Code lancé par l'app, face à un faux
 * fournisseur local (`faux-fournisseur.mjs`) : aucun compte, aucune dépense, réponses scriptées.
 * Profil jetable : `alpha` actif, `beta` désactivé, `gamma` sur l'ordinateur mais pas dans Mes agents,
 * `epsilon` rangé très profond (hors de ce que l'app lit : seul le contrôle à l'appel l'arrête).
 * Vérifie, pour la session de l'assistant comme pour un agent :
 * - la liste des agents montrée au modèle ne contient que les agents actifs (et ceux de Claude Code) ;
 * - un appel à un agent désactivé, absent ou non lu est refusé, en accès complet compris ;
 * - un agent actif répond ; `ouvrir_fil` refuse un agent hors de Mes agents ;
 * - une conversation directe avec un agent désactivé est refusée par le process principal ;
 * - ni les fiches ni les réglages de Claude Code ne changent.
 * Prérequis : `pnpm build && pnpm build:electron`, Claude Code installé (sinon le test est sauté).
 *   node scripts/test-delegation.mjs          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demanderA, demarrerFournisseur, refuse, sessionDe, suivreEvenements } from "./faux-fournisseur.mjs";
import { lancerApp, verificateur } from "./pilote-app.mjs";

const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find(
  (c) => c && existsSync(c),
);
if (!CLAUDE) {
  console.log("Claude Code introuvable : test de délégation sauté (KLYRA_CLAUDE_PATH).");
  process.exit(0);
}

const { echecs, verifier } = verificateur();
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-delegation-"));
const HOME = path.join(TMP, "home");
const DONNEES = path.join(TMP, "userdata");
const AGENTS = path.join(HOME, ".claude", "agents");
/* Rangée dans un sous-dossier (Claude Code la lit) ; `zeta`, plus profond que ce que l'app parcourt. */
const PROFOND = path.join(AGENTS, "a", "b", "c", "d");
const TRES_PROFOND = path.join(AGENTS, ...Array.from({ length: 10 }, (_, i) => `n${i}`));
mkdirSync(PROFOND, { recursive: true });
mkdirSync(TRES_PROFOND, { recursive: true });
mkdirSync(DONNEES, { recursive: true });

const fiche = (nom, prenom) => `---\nname: ${nom}\ndisplayName: ${prenom}\ndescription: "Essai — ${prenom}. Appelle ${prenom} pour l’essai."\n---\n\n# ${prenom} — Essai\n\nSOUS-AGENT-TEST-${nom}\n`;
writeFileSync(path.join(AGENTS, "alpha.md"), fiche("alpha", "Alma"));
writeFileSync(path.join(AGENTS, "beta.md"), fiche("beta", "Bea"));
writeFileSync(path.join(AGENTS, "gamma.md"), fiche("gamma", "Gaia"));
writeFileSync(path.join(PROFOND, "epsilon.md"), fiche("epsilon", "Eps"));
writeFileSync(path.join(TRES_PROFOND, "zeta.md"), fiche("zeta", "Zed"));
writeFileSync(path.join(HOME, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2));
writeFileSync(path.join(DONNEES, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [] }));
writeFileSync(
  path.join(DONNEES, "mes-agents.json"),
  JSON.stringify({
    version: 1,
    depart: "reprise",
    assistant: { nom: "Sam", teinte: null },
    agents: {
      alpha: { actif: true, ajouteLe: 1, origine: { type: "local" }, empreinte: null },
      beta: { actif: false, ajouteLe: 1, desactiveLe: 2, origine: { type: "local" }, empreinte: null },
    },
  }),
);

/** Empreintes de tout ce que l'app ne doit pas toucher : fiches et réglages de Claude Code. */
function empreintes() {
  const vues = {};
  const parcourir = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) parcourir(p);
      else if (f.endsWith(".md") || f === "settings.json") vues[path.relative(HOME, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  parcourir(path.join(HOME, ".claude"));
  return vues;
}
const avant = empreintes();

const fournisseur = await demarrerFournisseur(["alpha", "beta", "gamma", "epsilon", "zeta"]);
const app = await lancerApp({
  port: 9341,
  env: { HOME, KLYRA_USER_DATA: DONNEES, KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" },
});
await suivreEvenements(app);
const demander = (options) => demanderA(app, fournisseur, options);

try {
  /* 1. L'assistant : ce que le modèle voit, puis un appel à chaque sorte d'agent. */
  const beta = await demander({ agent: null, prompt: "appelle beta" });
  const vues = beta.requetes.find((q) => q.principal);
  verifier(!!vues, "l’app lance Claude Code et il parle au faux fournisseur");
  verifier(
    !!vues && vues.listes.includes("alpha") && ["beta", "gamma", "epsilon"].every((n) => !vues.listes.includes(n)),
    `le modèle ne voit que les agents actifs, sous-dossiers compris (vus : ${vues?.listes.join(", ") || "aucun"})`,
  );
  verifier(!!vues?.systeme.includes("tu es Sam"), "l’assistant connaît son nom (« tu es Sam »)");
  verifier(refuse(beta) && !beta.requetes.some((q) => q.sousAgent === "beta"), "appel à un agent désactivé : refusé, il ne tourne jamais");

  const sid = sessionDe(beta);
  const gamma = await demander({ agent: null, prompt: "appelle gamma", sessionId: sid });
  verifier(refuse(gamma) && !gamma.requetes.some((q) => q.sousAgent === "gamma"), "appel à une fiche hors de Mes agents : refusé");

  const epsilon = await demander({ agent: null, prompt: "appelle epsilon", sessionId: sid });
  verifier(refuse(epsilon) && !epsilon.requetes.some((q) => q.sousAgent === "epsilon"), "fiche rangée dans un sous-dossier : refusée");

  const zeta = await demander({ agent: null, prompt: "appelle zeta", sessionId: sid });
  const raisonZeta = zeta.requetes.flatMap((q) => q.resultats).map((x) => x.texte).join(" ");
  verifier(
    refuse(zeta) && !zeta.requetes.some((q) => q.sousAgent === "zeta"),
    `fiche hors de ce que l’app parcourt : refusée à l’appel (${/Mes agents/.test(raisonZeta) ? "contrôle de l’app" : "inconnue de Claude Code"})`,
  );

  const alpha = await demander({ agent: null, prompt: "appelle alpha", sessionId: sid });
  verifier(alpha.requetes.some((q) => q.sousAgent === "alpha") && !refuse(alpha), "appel à un agent actif : il répond");

  const fil = await demander({ agent: null, prompt: "fil beta", sessionId: sid });
  const raisonFil = fil.requetes.flatMap((q) => q.resultats).map((x) => x.texte).join(" ");
  const outilsVus = fil.requetes.find((q) => q.principal)?.outils.filter((o) => o.startsWith("mcp__klyra")) ?? [];
  verifier(refuse(fil) && /Agent inconnu|Mes agents/.test(raisonFil), `ouvrir_fil vers un agent désactivé : refusé par l’app (${raisonFil.slice(0, 160) || `outils de l’app vus : ${outilsVus.join(", ") || "aucun"}`})`);

  /* 2. Accès « demander » : même refus, sans rien demander à la personne. */
  const demande = await demander({ agent: null, prompt: "appelle beta", acces: "demander" });
  verifier(refuse(demande) && !demande.evts.some((e) => e.type === "autorisation"), "accès « demander » : refusé sans carte d’autorisation");

  /* 3. Un agent actif, à son tour, ne délègue qu'aux agents actifs. */
  const parAlpha = await demander({ agent: "alpha", prompt: "appelle beta", chatId: "dm-alpha" });
  verifier(refuse(parAlpha) && !parAlpha.requetes.some((q) => q.sousAgent === "beta"), "depuis alpha : beta refusé aussi");

  /* 4. Écrire directement à un agent désactivé : refusé par le process principal, sans lancer Claude Code. */
  const direct = await demander({ agent: "beta", prompt: "bonjour", chatId: "dm-beta" });
  verifier(
    direct.fin?.ok === false && /pas dans Mes agents/.test(direct.fin?.erreur ?? "") && !direct.evts.some((e) => e.type === "session"),
    `conversation directe avec un agent désactivé : refusée sans lancer Claude Code (${direct.fin?.erreur ?? "pas de fin"})`,
  );

  /* 5. Rien n'est écrit ailleurs que dans le dossier de l'app. */
  const apres = empreintes();
  verifier(Object.keys(avant).every((f) => avant[f] === apres[f]), `fiches et réglages de Claude Code inchangés (${Object.keys(avant).length} fichiers comparés)`);
  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` : ${app.erreurs[0]}` : ""}`);
} finally {
  await app.fermer();
  fournisseur.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout est bon.");
process.exit(echecs.length ? 1 : 0);
