/**
 * Banc de jetons : la même tâche donnée à Claude Code seul (comme dans Claude Desktop, onglet Code)
 * et à l'assistant de klyra avec son équipe d'agents, par le moteur du serveur (`serveur/agents.mjs`
 * de ce dépôt : les mêmes consignes que l'app, sans les outils propres au PC comme les fils).
 * Les deux bras utilisent le même Claude Code, le même compte, le même dossier personnel (donc les
 * mêmes fiches dans ~/.claude/agents) et le même modèle : seule change la couche klyra.
 *
 * Mesures lues dans la sortie stream-json de Claude Code (message `result`, cumulé sur le processus,
 * sous-agents compris) : jetons par modèle, coût équivalent API, durée, tours, agents appelés ; puis
 * le contrôle de la tâche (tests qui passent, fichier livré). Les agents de fond sont attendus, comme
 * dans l'app, avant de fermer.
 *
 * Coûte de vrais jetons, sur le compte du poste. Mac et Linux (bash).
 *   CLAUDE_CODE_OAUTH_TOKEN=… pnpm bench:jetons -- [--taches dev,offre,equipe] [--reps 1]
 *     [--modele sonnet] [--bras direct,klyra] [--agents dev,designer] [--assistant Cicco]
 * Sans `--agents` : toutes les fiches de ~/.claude/agents sont actives. Le jeton se crée avec
 * `claude setup-token` ; sans lui, il faut ~/.claude/.credentials.json. Les essais vont dans
 * ~/.klyra/banc/<date>/ (rapport.md, resultats.json, sorties brutes).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { creerAgents } from "../../serveur/agents.mjs";

const ICI = import.meta.dirname;
const HOME = os.homedir();
const DELAI_MS = 20 * 60 * 1000;

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : defaut;
};
const toutesTaches = JSON.parse(readFileSync(path.join(ICI, "taches.json"), "utf8"));
const ids = arg("taches", toutesTaches.filter((t) => !t.essai).map((t) => t.id).join(",")).split(",");
const taches = toutesTaches.filter((t) => ids.includes(t.id));
const reps = Number(arg("reps", "1"));
const modele = arg("modele", null);
const bras = arg("bras", "direct,klyra").split(",");

const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(HOME, ".local", "bin", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find((c) => c && existsSync(c));
if (!CLAUDE) {
  console.error("Claude Code introuvable (KLYRA_CLAUDE_PATH).");
  process.exit(1);
}
const jeton = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null;
if (!jeton && !existsSync(path.join(HOME, ".claude", ".credentials.json"))) {
  console.error("Pas de compte Claude lisible par le banc : lance-le avec CLAUDE_CODE_OAUTH_TOKEN (claude setup-token).");
  process.exit(1);
}
const envClaude = { ...process.env, ...(jeton ? { CLAUDE_CODE_OAUTH_TOKEN: jeton } : {}) };

/* L'équipe du bras klyra : les fiches du poste (ou `--agents`), comme « Mes agents » l'envoie au serveur. */
const DONNEES = mkdtempSync(path.join(os.tmpdir(), "klyra-banc-"));
const fiches = existsSync(path.join(HOME, ".claude", "agents")) ? readdirSync(path.join(HOME, ".claude", "agents")).filter((f) => f.endsWith(".md")) : [];
const choisis = arg("agents", null)?.split(",") ?? fiches.map((f) => f.replace(/\.md$/, ""));
const actifs = choisis.map((id) => {
  const fiche = path.join(HOME, ".claude", "agents", `${id}.md`);
  const nom = existsSync(fiche) ? readFileSync(fiche, "utf8").match(/^displayName:\s*"?([^"\n]+)"?/m)?.[1]?.trim() : null;
  return { id, nom: nom || id };
});
writeFileSync(path.join(DONNEES, "equipe.json"), JSON.stringify({ assistant: arg("assistant", null), actifs, empreinte: "banc" }));
if (jeton) writeFileSync(path.join(DONNEES, "claude-token"), jeton, { mode: 0o600 });

const horodatage = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
// Sous le dossier personnel : le moteur du serveur n'accepte pas un dossier de travail ailleurs.
const racine = path.join(HOME, ".klyra", "banc", horodatage);
mkdirSync(racine, { recursive: true });

/* ─── Bras A : Claude Code seul ───────────────────────────────────── */

function lancerDirect(prompt, cwd, log) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
  if (modele) args.push("--model", modele);
  return new Promise((resolve) => {
    const child = spawn(path.join(ICI, "claude-tee.sh"), args, { cwd, env: { ...envClaude, BENCH_CLAUDE: CLAUDE, BENCH_LOG: log }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const minuterie = setTimeout(() => child.kill("SIGTERM"), DELAI_MS);
    child.on("close", (code) => {
      clearTimeout(minuterie);
      resolve({ ok: code === 0, erreur: code === 0 ? null : stderr.trim().slice(0, 500) || `code ${code}` });
    });
  });
}

/**
 * Fini quand plus aucune tâche de fond ne tourne, qu'un résultat est arrivé après le dernier
 * changement de tâches, et que la sortie n'a pas bougé depuis 15 s.
 */
const calme = { taille: -1, depuis: 0 };
function travailFini(log) {
  const brut = existsSync(log) ? readFileSync(log, "utf8") : "";
  if (brut.length !== calme.taille) {
    calme.taille = brut.length;
    calme.depuis = Date.now();
    return false;
  }
  if (Date.now() - calme.depuis < 15_000) return false;
  let taches = [];
  let resultatApres = false;
  for (const l of brut.split("\n")) {
    if (!l) continue;
    let m;
    try {
      m = JSON.parse(l);
    } catch {
      continue;
    }
    if (m.type === "system" && m.subtype === "background_tasks_changed") {
      taches = m.tasks ?? [];
      resultatApres = false;
    }
    if (m.type === "result") resultatApres = true;
  }
  return taches.length === 0 && resultatApres;
}

/* ─── Bras B : klyra-app (assistant + équipe), par le module du serveur ───── */

function lancerKlyra(prompt, cwd, log) {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const nosRequetes = new Set([requestId]);
    let fini = false;
    const agents = creerAgents({
      home: HOME,
      donnees: DONNEES,
      nomServeur: "banc",
      claude: path.join(ICI, "claude-tee.sh"),
      // Un agent de fond qui rend son travail rouvre un tour de l'assistant (réponse spontanée).
      spontane: () => {
        const id = randomUUID();
        nosRequetes.add(id);
        return id;
      },
      publier: (id, event) => {
        if (!nosRequetes.has(id) || fini) return;
        if (event.type === "autorisation") agents.autoriser(id, event.id, "oui");
        if (id !== requestId) return;
        if (event.type !== "fin" || attente) return;
        // Comme dans l'app, le processus reste ouvert : les agents lancés en arrière-plan
        // finissent et rouvrent un tour de l'assistant. On ferme quand tout est retombé.
        attente = setInterval(() => {
          if (!travailFini(log)) return;
          fini = true;
          clearInterval(attente);
          clearTimeout(minuterie);
          agents.fermerTout();
          resolve({ ok: !!event.ok, erreur: event.ok ? null : event.erreur ?? "échec" });
        }, 3000);
      },
    });
    let attente = null;
    const minuterie = setTimeout(() => {
      fini = true;
      clearInterval(attente);
      agents.fermerTout();
      resolve({ ok: false, erreur: "délai dépassé" });
    }, DELAI_MS);
    process.env.BENCH_CLAUDE = CLAUDE;
    process.env.BENCH_LOG = log;
    agents.envoyer(requestId, { prompt, agent: null, sessionId: null, acces: "tout", dossier: cwd, modele: modele ?? undefined });
  });
}

/* ─── Lecture de la sortie stream-json ────────────────────────────── */

function analyser(log) {
  const lignes = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  let resultat = null;
  let init = null;
  const outils = {};
  const agentsAppeles = [];
  let messagesSousAgents = 0;
  /* Jetons par sous-agent : usage des messages rattachés à l'appel Agent (un message par id). */
  const typeDAppel = {};
  const vus = new Set();
  const parSousAgent = {};
  let texteFinal = "";
  for (const l of lignes) {
    let m;
    try {
      m = JSON.parse(l);
    } catch {
      continue;
    }
    if (m.type === "system" && m.subtype === "init" && !init) init = m;
    if (m.type === "result") {
      resultat = m;
      if (typeof m.result === "string" && m.result) texteFinal = m.result;
    }
    if (m.type === "assistant") {
      if (m.parent_tool_use_id) messagesSousAgents++;
      const u = m.message?.usage;
      if (m.parent_tool_use_id && u && m.message?.id && !vus.has(m.message.id)) {
        vus.add(m.message.id);
        const qui = typeDAppel[m.parent_tool_use_id] ?? "?";
        parSousAgent[qui] = (parSousAgent[qui] ?? 0) + (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      }
      for (const b of m.message?.content ?? []) {
        if (b.type !== "tool_use") continue;
        outils[b.name] = (outils[b.name] ?? 0) + 1;
        if (b.name === "Agent" || b.name === "Task") {
          agentsAppeles.push(b.input?.subagent_type ?? "?");
          typeDAppel[b.id] = b.input?.subagent_type ?? "?";
        }
      }
    }
  }
  const parModele = {};
  const total = { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 };
  for (const [nom, u] of Object.entries(resultat?.modelUsage ?? {})) {
    const j = { entree: u.inputTokens ?? 0, sortie: u.outputTokens ?? 0, cacheLu: u.cacheReadInputTokens ?? 0, cacheEcrit: u.cacheCreationInputTokens ?? 0, coutUsd: u.costUSD ?? 0 };
    parModele[nom] = j;
    for (const k of Object.keys(total)) total[k] += j[k];
  }
  return {
    parModele,
    jetons: { ...total, total: total.entree + total.sortie + total.cacheLu + total.cacheEcrit },
    coutUsd: resultat?.total_cost_usd ?? null,
    dureeApiMs: resultat?.duration_api_ms ?? null,
    tours: resultat?.num_turns ?? null,
    outilsDisponibles: init?.tools?.length ?? null,
    serveursMcp: (init?.mcp_servers ?? []).map((s) => s.name),
    outils,
    agentsAppeles,
    messagesSousAgents,
    parSousAgent,
    texteFinal,
  };
}

/* ─── Boucle ───────────────────────────────────────────────────────── */

const resultats = [];
for (const tache of taches) {
  for (let rep = 1; rep <= reps; rep++) {
    for (const b of bras) {
      const nom = `${tache.id}-${b}-${rep}`;
      const cwd = path.join(racine, nom);
      const log = path.join(racine, `${nom}.jsonl`);
      if (tache.fixture) cpSync(path.join(ICI, "fixtures", tache.fixture), cwd, { recursive: true });
      else mkdirSync(cwd, { recursive: true });
      process.stderr.write(`▶ ${nom}… `);
      const debut = Date.now();
      const issue = b === "direct" ? await lancerDirect(tache.prompt, cwd, log) : await lancerKlyra(tache.promptKlyra ? `${tache.prompt}\n\n${tache.promptKlyra}` : tache.prompt, cwd, log);
      const dureeMs = Date.now() - debut;
      const controle = tache.controle ? spawnSync("bash", ["-c", tache.controle], { cwd, encoding: "utf8", env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` } }) : null;
      const mesure = analyser(log);
      const ligne = { tache: tache.id, bras: b, rep, ...issue, dureeMs, controleOk: controle ? controle.status === 0 : null, ...mesure };
      writeFileSync(path.join(racine, `${nom}.reponse.md`), mesure.texteFinal);
      resultats.push(ligne);
      process.stderr.write(`${issue.ok ? "ok" : `échec (${issue.erreur})`} · ${mesure.jetons.total} jetons · ${mesure.coutUsd ?? "?"} $ · ${Math.round(dureeMs / 1000)} s\n`);
      writeFileSync(path.join(racine, "resultats.json"), JSON.stringify({ modele, reps, resultats }, null, 2));
    }
  }
}

/* ─── Rapport ──────────────────────────────────────────────────────── */

const fmt = (n) => (n == null ? "—" : n.toLocaleString("fr-FR"));
const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
let md = `# Banc jetons — Claude Code seul vs klyra-app (${horodatage})\n\nModèle demandé : ${modele ?? "défaut du compte"} · répétitions : ${reps} · agents actifs : ${actifs.map((a) => a.nom).join(", ") || "aucun"}\n\n`;
md += "| Tâche | Bras | Rép. | OK | Contrôle | Entrée | Sortie | Cache lu | Cache écrit | Total | Coût éq. API | Durée | Tours | Agents appelés |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
for (const r of resultats) {
  md += `| ${r.tache} | ${r.bras} | ${r.rep} | ${r.ok ? "oui" : "non"} | ${r.controleOk == null ? "—" : r.controleOk ? "oui" : "non"} | ${fmt(r.jetons.entree)} | ${fmt(r.jetons.sortie)} | ${fmt(r.jetons.cacheLu)} | ${fmt(r.jetons.cacheEcrit)} | ${fmt(r.jetons.total)} | ${r.coutUsd == null ? "—" : `${r.coutUsd.toFixed(3)} $`} | ${Math.round(r.dureeMs / 1000)} s | ${r.tours ?? "—"} | ${r.agentsAppeles.join(", ") || "aucun"} |\n`;
}
md += "\n## Écart moyen klyra / direct\n\n| Tâche | Coût | Jetons totaux | Sortie | Durée |\n|---|---|---|---|---|\n";
for (const tache of taches) {
  const de = (b) => resultats.filter((r) => r.tache === tache.id && r.bras === b);
  const ratio = (f) => {
    const a = moyenne(de("direct").map(f));
    const k = moyenne(de("klyra").map(f));
    return a && k != null ? `×${(k / a).toFixed(2)}` : "—";
  };
  md += `| ${tache.id} | ${ratio((r) => r.coutUsd ?? 0)} | ${ratio((r) => r.jetons.total)} | ${ratio((r) => r.jetons.sortie)} | ${ratio((r) => r.dureeMs)} |\n`;
}
md += "\n## Détail par modèle\n\n";
for (const r of resultats) {
  md += `- **${r.tache}-${r.bras}-${r.rep}** : ${Object.entries(r.parModele).map(([m, j]) => `${m} ${fmt(j.entree + j.sortie + j.cacheLu + j.cacheEcrit)} jetons / ${j.coutUsd.toFixed(3)} $`).join(" · ") || "—"} · outils dispo ${r.outilsDisponibles ?? "—"} · MCP ${r.serveursMcp.join(", ") || "aucun"} · sous-agents ${Object.entries(r.parSousAgent).map(([a, n]) => `${a} ${fmt(n)}`).join(", ") || "aucun"} · outils utilisés ${Object.entries(r.outils).map(([o, n]) => `${o}×${n}`).join(", ") || "aucun"}\n`;
}
writeFileSync(path.join(racine, "rapport.md"), md);
console.log(md);
console.log(`\nDossier : ${racine}`);
