/**
 * Ce que pèse le socle d'une conversation : tout ce que Claude Code envoie au modèle avec le premier
 * message (consignes de Claude Code, consignes de l'app, outils, agents listés, CLAUDE.md…), capté par
 * le faux fournisseur, sans compte ni dépense, puis découpé morceau par morceau.
 * Profils : l'assistant seul (nouveau profil), puis l'assistant avec les onze modèles KLYRA actifs.
 * - `--poste` : avec le vrai dossier personnel, pour voir ce que le poste ajoute (son ~/.claude :
 *   CLAUDE.md, plugins, serveurs MCP). Sans cette option, un dossier personnel vierge : l'app seule.
 * - `--reel` : avec le vrai Claude Code et le compte du poste (Haiku, quelques centimes ;
 *   `CLAUDE_CODE_OAUTH_TOKEN` ou une connexion du poste), par un relais local qui garde une copie de la
 *   requête. Une session sur abonnement n'envoie pas la même chose qu'une session sur clé d'API (le faux
 *   fournisseur) : c'est la mesure qui fait foi. Elle donne aussi le rapport caractères/jeton.
 * - `--json` : la mesure brute ; `MESURE_BRUT=<dossier>` (avec `--reel`) y garde les requêtes entières.
 * Prérequis : `pnpm build && pnpm build:electron`, Claude Code (`KLYRA_CLAUDE_PATH` au besoin).
 *   pnpm mesure:socle          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import os from "node:os";
import path from "node:path";
import { demanderA, demarrerFournisseur, suivreEvenements } from "./faux-fournisseur.mjs";
import { lancerApp } from "./pilote-app.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const options = new Set(process.argv.slice(2));
/** Caractères par jeton, mesuré le 03/11/2026 (Claude Code 2.1.317) ; `--calibrer` le recalcule. */
const CARACTERES_PAR_JETON_DEFAUT = 3.4;
const PORT = 9375;

const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find(
  (c) => c && existsSync(c),
);
if (!CLAUDE) {
  console.log("Claude Code introuvable (KLYRA_CLAUDE_PATH).");
  process.exit(1);
}

/* ─── Les profils ───────────────────────────────────────────────── */

function preparerProfil(nom, { equipe }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `klyra-socle-${nom}-`));
  const home = options.has("--poste") ? os.homedir() : path.join(tmp, "home");
  const donnees = path.join(tmp, "userdata");
  mkdirSync(donnees, { recursive: true });
  const agents = {};
  if (equipe && !options.has("--poste")) {
    const dossier = path.join(home, ".claude", "agents");
    mkdirSync(dossier, { recursive: true });
    for (const f of readdirSync(path.join(APP, "agents-equipe")).filter((f) => f.endsWith(".md"))) {
      cpSync(path.join(APP, "agents-equipe", f), path.join(dossier, f));
      agents[f.replace(/\.md$/, "")] = { actif: true, ajouteLe: 1, origine: { type: "local" }, empreinte: null };
    }
  }
  writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [] }));
  writeFileSync(path.join(donnees, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Sam", teinte: null }, agents }));
  return { tmp, env: { HOME: home, KLYRA_USER_DATA: donnees, KLYRA_CLAUDE_PATH: CLAUDE } };
}

/* ─── Le découpage d'une requête ────────────────────────────────── */

/** Le début de chaque consigne de l'app (electron/claude.ts), pour les retrouver dans le système. */
const CONSIGNES_APP = [
  ["Planning", "La personne avec qui tu parles a, dans cette app"],
  ["Fils", "Dans cette app, une tâche = un fil"],
  ["Artefacts", "Où ranger :"],
  ["Composio", "Pour Composio,"],
  ["Composio Connect", "Pour les apps de la personne"],
  ["Assistant, équipe et règles communes", "Dans cette app, tu es"],
  ["Agent, équipe et règles communes", "Dans cette app, les agents que la personne"],
  ["Agent sans équipe et règles communes", "Dans cette app, la personne n'a pas d'autre agent"],
  ["Computer Use", "Computer Use"],
];

function texteDe(contenu) {
  if (typeof contenu === "string") return [contenu];
  return (contenu ?? []).map((b) => (b.type === "text" ? b.text : JSON.stringify(b)));
}

/** Les morceaux d'une requête, en caractères : { groupe, nom, caracteres }. */
export function decouper(corps) {
  const morceaux = [];
  const ajouter = (groupe, nom, caracteres) => caracteres > 0 && morceaux.push({ groupe, nom, caracteres });

  // Le système : les consignes de Claude Code, puis celles de l'app (--append-system-prompt).
  const systeme = texteDe(corps.system).join("\n");
  const reperes = CONSIGNES_APP.map(([nom, debut]) => ({ nom, pos: systeme.indexOf(debut) }))
    .filter((r) => r.pos >= 0)
    .sort((a, b) => a.pos - b.pos);
  const debutApp = reperes[0]?.pos ?? systeme.length;
  ajouter("Claude Code", "Consignes de Claude Code (système)", debutApp);
  reperes.forEach((r, i) => ajouter("App", `Consigne : ${r.nom}`, (reperes[i + 1]?.pos ?? systeme.length) - r.pos));

  // Les outils, chacun avec sa description et son schéma.
  for (const outil of corps.tools ?? []) {
    const taille = JSON.stringify(outil).length;
    const nom = outil.name ?? "?";
    if (nom === "Agent" || nom === "Task") ajouter("Agents", "Outil Agent (avec la liste des agents)", taille);
    else if (nom.startsWith("mcp__klyra__")) ajouter("App", `Outil de l'app : ${nom.slice(12)}`, taille);
    else if (nom.startsWith("mcp__ordinateur__")) ajouter("App", `Computer Use : ${nom.slice(17)}`, taille);
    else if (nom.startsWith("mcp__")) ajouter("Poste", `MCP ${nom.split("__")[1]} : ${nom.split("__").slice(2).join("__")}`, taille);
    else ajouter("Claude Code", `Outil ${nom}`, taille);
  }

  // Les messages « système » de Claude Code : l'environnement (dossier, plateforme, date) et ses rappels.
  for (const m of (corps.messages ?? []).filter((m) => m.role === "system")) ajouter("Claude Code", "Environnement et rappels (message système)", texteDe(m.content).join("\n").length);

  // Le premier message : les rappels de Claude Code (CLAUDE.md, outils à la demande, skills…) et le texte.
  const premier = (corps.messages ?? []).find((m) => m.role === "user");
  for (const bloc of texteDe(premier?.content)) {
    if (!bloc.includes("<system-reminder>")) {
      ajouter("Message", "Le message de la personne", bloc.length);
      continue;
    }
    if (/Contents of [^\n]*(CLAUDE|AGENTS)\.md/.test(bloc)) ajouter("Poste", "CLAUDE.md / AGENTS.md chargés", bloc.length);
    else if (/deferred|ToolSearch/i.test(bloc)) ajouter("Claude Code", "Liste des outils chargés à la demande", bloc.length);
    else if (/skill/i.test(bloc)) ajouter("Poste", "Skills disponibles", bloc.length);
    else if (/agent/i.test(bloc)) ajouter("Agents", "Rappel : agents disponibles", bloc.length);
    else ajouter("Claude Code", "Autres rappels de Claude Code", bloc.length);
  }
  return morceaux;
}

/* ─── Les mesures ───────────────────────────────────────────────── */

async function capter(nom, profil) {
  const { tmp, env } = preparerProfil(nom, profil);
  const fournisseur = await demarrerFournisseur([]);
  const app = await lancerApp({ port: PORT, env: { ...env, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" } });
  try {
    await suivreEvenements(app);
    const r = await demanderA(app, fournisseur, { agent: null, prompt: "bonjour" });
    const requete = r.requetes.find((q) => q.principal) ?? r.requetes.findLast((q) => (q.corps?.tools ?? []).length);
    if (!requete) throw new Error(`profil ${nom} : aucune requête principale captée`);
    return decouper(requete.corps);
  } finally {
    await app.fermer();
    fournisseur.fermer();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Un relais local vers l'API d'Anthropic : il laisse passer chaque appel tel quel (avec le compte du
 * poste) et en garde une copie. Sert à mesurer la vraie requête d'une session sur abonnement, qui
 * n'est pas celle d'une session sur clé d'API (le faux fournisseur).
 */
async function demarrerRelais() {
  const copies = [];
  const serveur = createServer((req, res) => {
    const morceaux = [];
    req.on("data", (d) => morceaux.push(d));
    req.on("end", () => {
      const brut = Buffer.concat(morceaux);
      if (req.url.startsWith("/v1/messages") && !req.url.includes("count_tokens")) {
        try {
          copies.push(JSON.parse(brut.toString("utf8")));
        } catch {
          /* pas du JSON : rien à mesurer */
        }
      }
      const entetes = { ...req.headers, host: "api.anthropic.com" };
      delete entetes["content-length"];
      const amont = httpsRequest({ host: "api.anthropic.com", path: req.url, method: req.method, headers: { ...entetes, "content-length": brut.length } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      amont.on("error", () => res.writeHead(502).end());
      amont.end(brut);
    });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${serveur.address().port}`, copies, fermer: () => serveur.close() };
}

/** La vraie requête (assistant seul, Haiku) et ce qu'elle a relu, en jetons (événement `contexte` de l'app). */
async function mesurerVraiment(nom, profil) {
  const { tmp, env } = preparerProfil(nom, profil);
  const relais = await demarrerRelais();
  const app = await lancerApp({ port: PORT, env: { ...env, ANTHROPIC_BASE_URL: relais.url, ...(process.env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN } : {}) } });
  try {
    await suivreEvenements(app);
    const id = "calibrage";
    await app.ev(`window.klyra.claude.stream("${id}", ${JSON.stringify({ dossier: null, sessionId: null, chatId: "dm-principal", acces: "tout", agent: null, prompt: "bonjour", modele: "haiku" })}).then(() => 0)`);
    await app.quand(`window.__evts.some((x) => x.id === "${id}" && x.e.type === "fin")`, 120000);
    const evts = await app.ev(`window.__evts.filter((x) => x.id === "${id}").map((x) => x.e)`);
    const contexte = evts.find((e) => e.type === "contexte");
    if (!contexte) throw new Error(`pas de mesure réelle (${JSON.stringify(evts.find((e) => e.type === "fin"))})`);
    // La requête principale : celle qui porte l'outil Agent (Claude Code fait aussi de petits appels annexes).
    const corps = relais.copies.find((c) => (c.tools ?? []).some((t) => t.name === "Agent" || t.name === "Task")) ?? relais.copies.at(-1);
    if (process.env.MESURE_BRUT && corps) writeFileSync(path.join(process.env.MESURE_BRUT, `requete-${nom}.json`), JSON.stringify(corps, null, 1));
    return { jetons: contexte.jetons, morceaux: corps ? decouper(corps) : [] };
  } finally {
    await app.fermer();
    relais.fermer();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const profils = [
  ["assistant seul", { equipe: false }],
  ["assistant et 11 modèles KLYRA", { equipe: true }],
];
const reel = options.has("--reel");
const resultats = [];
let caracteresParJeton = CARACTERES_PAR_JETON_DEFAUT;
let calibrage = null;
for (const [nom, profil] of profils) {
  const id = nom.replace(/\W+/g, "-");
  if (!reel) {
    resultats.push({ profil: nom, morceaux: await capter(id, profil) });
    continue;
  }
  // Vrai compte : le total exact en jetons, et le rapport caractères/jeton qui en découle.
  const { jetons: total, morceaux } = await mesurerVraiment(id, profil);
  const caracteres = morceaux.reduce((s, m) => s + m.caracteres, 0);
  if (!calibrage && total) {
    caracteresParJeton = caracteres / total;
    calibrage = { jetons: total, caracteres, caracteresParJeton: Number(caracteresParJeton.toFixed(2)) };
  }
  resultats.push({ profil: nom, morceaux, jetonsReels: total });
}

const jetons = (c) => Math.round(c / caracteresParJeton);
if (options.has("--json")) {
  console.log(JSON.stringify({ caracteresParJeton, calibrage, resultats: resultats.map((r) => ({ ...r, morceaux: r.morceaux.map((m) => ({ ...m, jetons: jetons(m.caracteres) })) })) }, null, 2));
  process.exit(0);
}

console.log(`Socle d'une conversation (${options.has("--poste") ? "avec le dossier personnel du poste" : "dossier personnel vierge : l'app seule"}, ${reel ? "vrai Claude Code sur le compte du poste" : "faux fournisseur, session sur clé d'API"}), en jetons estimés à ${caracteresParJeton.toFixed(2)} caractères par jeton${calibrage ? ` (calibré sur ${calibrage.jetons} jetons réels)` : ""}.\n`);
for (const { profil, morceaux, jetonsReels } of resultats) {
  const total = morceaux.reduce((s, m) => s + m.caracteres, 0);
  console.log(`## ${profil} : ${jetons(total).toLocaleString("fr-FR")} jetons${jetonsReels ? ` (réels : ${jetonsReels.toLocaleString("fr-FR")})` : ""}`);
  const parGroupe = {};
  for (const m of morceaux) parGroupe[m.groupe] = (parGroupe[m.groupe] ?? 0) + m.caracteres;
  for (const [g, c] of Object.entries(parGroupe).sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(12)} ${String(jetons(c).toLocaleString("fr-FR")).padStart(7)}  ${Math.round((100 * c) / total)} %`);
  console.log("  Détail (au-dessus de 150 jetons) :");
  for (const m of [...morceaux].sort((a, b) => b.caracteres - a.caracteres).filter((m) => jetons(m.caracteres) >= 150))
    console.log(`    ${String(jetons(m.caracteres).toLocaleString("fr-FR")).padStart(7)}  ${m.groupe} · ${m.nom}`);
  console.log("");
}
