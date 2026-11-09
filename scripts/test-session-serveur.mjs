/**
 * Ce que l'app lit et demande à Claude Code (electron/session-claude.ts, généré en serveur/session-claude.mjs),
 * sur un VPS : un vrai serveur KLYRA local, le vrai Claude Code face au faux fournisseur (cf. faux-fournisseur.mjs).
 *  - la réflexion arrive au journal (« reflexion »), la réponse finit avec son repère (`uuidFin`), la fenêtre est dite ;
 *  - les questions à choix arrivent (« question ») et la réponse de la personne revient au modèle ; sans l'app de
 *    bureau (le téléphone), elles sont refusées à l'agent ;
 *  - en mode plan, le plan arrive (« plan ») ; lancé, l'agent continue ;
 *  - une modification de fichier arrive avec son diff, annulable ; « annuler-modifications » remet le fichier ;
 *  - une commande écrit en direct (« sortie »), puis sa sortie entière à la fin de l'étape ;
 *  - les commandes « / » de la session, le contexte d'une session ouverte ;
 *  - « Revenir à avant » : la session reprend au repère, dans une copie (nouvelle session) ;
 *  - les routes des projets : fichiers (« @ »), autorisations retenues, branche de travail, sessions du terminal.
 * Prérequis : Claude Code (KLYRA_CLAUDE_PATH, ou sur le PATH), git.
 *   node scripts/test-session-serveur.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";

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

let echecs = 0;
const verifier = (ok, libelle) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${libelle}`);
  if (!ok) echecs += 1;
  return ok;
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-session-serveur-"));
const vpsHome = path.join(TMP, "home");
mkdirSync(path.join(vpsHome, ".local", "bin"), { recursive: true });
mkdirSync(path.join(vpsHome, ".claude"), { recursive: true });
symlinkSync(CLAUDE, path.join(vpsHome, ".local", "bin", "claude"));
/* Les sessions du poste : le dossier préparé de chaque agent y est lié (cf. preparation-fournisseur.ts). */
mkdirSync(path.join(vpsHome, ".claude", "projects"), { recursive: true });
writeFileSync(path.join(vpsHome, ".claude", ".credentials.json"), "{}");
/* Un projet du VPS : un dépôt git sous le dossier de klyra. */
const projet = path.join(vpsHome, "projets", "site");
mkdirSync(path.join(projet, "src"), { recursive: true });
writeFileSync(path.join(projet, "src", "page.tsx"), "export default 1;\n");
const git = (...args) => execFileSync("git", ["-c", "user.email=essai@klyra.fr", "-c", "user.name=Essai", ...args], { cwd: projet, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-qm", "départ");

const fournisseur = await demarrerFournisseur([]);
const port = 20000 + Math.floor(Math.random() * 20000);
const adresse = `http://127.0.0.1:${port}`;
const SERVEUR = path.resolve(import.meta.dirname, "..", "serveur", "klyra-serveur.mjs");
const envServeur = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k))),
  HOME: vpsHome,
  KLYRA_SERVEUR_DONNEES: path.join(TMP, "donnees"),
  KLYRA_SERVEUR_PORT: String(port),
  KLYRA_SERVEUR_HOTE: "127.0.0.1",
  KLYRA_SERVEUR_NOM: "Klyra-VPS",
  ANTHROPIC_BASE_URL: fournisseur.url,
  ANTHROPIC_API_KEY: "sk-faux-essai",
};
const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: ["ignore", "ignore", "inherit"] });

try {
  for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
  const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
  const appaire = await fetch(`${adresse}/klyra/v1/appairer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, appareil: "Essai" }) }).then((r) => r.json());
  const jeton = appaire.jeton;
  verifier(typeof jeton === "string", "un appareil relié");
  const appel = (chemin, methode, corps) =>
    fetch(`${adresse}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const equipe = await appel("/klyra/v1/agents/fiches", "PUT", { fiches: [], assistant: "Iris", configuration: {}, empreinte: "essai-session" });
  verifier(equipe.status === 200, `l'équipe est sur le serveur (${equipe.status})`);

  /* Le journal, lu en direct pendant tout l'essai. */
  const lus = [];
  const flux = new AbortController();
  void fetch(`${adresse}/klyra/v1/agent/evenements?depuis=0`, { headers: { Authorization: `Bearer ${jeton}` }, signal: flux.signal })
    .then(async (r) => {
      const lecteur = r.body.getReader();
      let tampon = "";
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        tampon += new TextDecoder().decode(value);
        const blocs = tampon.split("\n\n");
        tampon = blocs.pop() ?? "";
        for (const b of blocs) {
          const data = b.split("\n").find((l) => l.startsWith("data:"));
          if (data) {
            try {
              lus.push(JSON.parse(data.slice(5)));
            } catch {
              /* ligne de service */
            }
          }
        }
      }
    })
    .catch(() => undefined);
  const quand = async (test, ms) => {
    for (let i = 0; i < ms / 200 && !test(); i++) await attendre(200);
    return test();
  };
  const evts = (id) => lus.filter((x) => x.event && x.requestId === id).map((x) => x.event);
  let session = null;
  let n = 0;
  /** Envoie un message à l'assistant (dans le projet), et attend un événement ou la fin. */
  const envoyer = async (prompt, options = {}, jusqua = (e) => e.type === "fin") => {
    const id = `essai-${++n}`;
    const r = await appel("/klyra/v1/agent/envoyer", "POST", { requestId: id, options: { agent: null, prompt, sessionId: session, acces: "tout", dossier: projet, conversation: "conv-session", questions: true, ...options } });
    verifier(r.status === 202, `« ${prompt} » part (${r.status})`);
    await quand(() => evts(id).some(jusqua), 60000);
    const s = evts(id).find((e) => e.type === "session")?.sessionId;
    if (s && !options.garderSession) session = s;
    return id;
  };

  /* Réflexion, repère de fin, fenêtre, commandes. */
  const r1 = await envoyer("pense couleur");
  const reflexion = evts(r1).filter((e) => e.type === "reflexion").map((e) => e.texte).join("");
  verifier(reflexion.includes("Je pèse la question couleur"), `la réflexion arrive au journal (« ${reflexion.trim()} »)`);
  verifier(evts(r1).some((e) => e.type === "texte" && e.delta.includes("réponse pensée")), "puis la réponse");
  const fin1 = evts(r1).find((e) => e.type === "fin");
  verifier(fin1?.ok === true && typeof fin1.uuidFin === "string", "la réponse finit avec son repère (uuidFin)");
  verifier(evts(r1).some((e) => e.type === "fenetre" && e.jetons > 0), "la fenêtre du modèle est dite");
  await quand(() => lus.some((x) => x.event?.type === "commandes"), 10000);
  verifier(lus.some((x) => x.event?.type === "commandes" && Array.isArray(x.event.commandes)), "les commandes « / » de la session arrivent");
  const contexte = await appel("/klyra/v1/agent/contexte", "POST", { requestId: "demande", sessionId: session });
  verifier(contexte.status === 200 && contexte.json?.usage?.max > 0, `le contexte d'une session ouverte se lit (${contexte.json?.usage?.total} / ${contexte.json?.usage?.max})`);

  /* Questions à choix : la réponse de la personne revient au modèle. */
  const r2 = await envoyer("question logo", {}, (e) => e.type === "question" || e.type === "fin");
  const question = evts(r2).find((e) => e.type === "question");
  verifier(question?.questions?.[0]?.question === "Quelle couleur pour logo ?" && question.questions[0].options.length === 2, "les questions à choix arrivent, avec leurs options");
  if (question) {
    const rep = await appel("/klyra/v1/agent/autoriser", "POST", { requestId: r2, demandeId: question.id, decision: "oui", reponses: { "Quelle couleur pour logo ?": "Rouge" } });
    verifier(rep.json?.ok === true, "la réponse de la personne part");
    await quand(() => evts(r2).some((e) => e.type === "fin"), 60000);
    verifier(evts(r2).some((e) => e.type === "autorisation-fin" && e.accepte), "la carte se ferme, répondue");
    verifier(evts(r2).some((e) => e.type === "texte" && e.delta.includes("Rouge")), "le modèle reçoit « Rouge »");
  }
  /* Venu du téléphone (sans l'app de bureau) : l'agent ne peut pas poser de questions à choix. */
  const r3 = await envoyer("question tel", { questions: undefined });
  verifier(!evts(r3).some((e) => e.type === "question") && evts(r3).some((e) => e.type === "texte" && e.delta.includes("fin REFUS")), "depuis le téléphone, les questions à choix sont refusées à l'agent");

  /* Mode plan : le plan arrive ; lancé, l'agent continue. */
  const r4 = await envoyer("plan menu", { plan: true }, (e) => e.type === "plan" || e.type === "fin");
  const plan = evts(r4).find((e) => e.type === "plan");
  if (!verifier(plan?.plan?.startsWith("# Plan menu"), "en mode plan, le plan arrive") && process.env.DEBOGUER) console.log(JSON.stringify(evts(r4)).slice(0, 3000));
  if (plan) {
    await appel("/klyra/v1/agent/autoriser", "POST", { requestId: r4, demandeId: plan.id, decision: "oui" });
    await quand(() => evts(r4).some((e) => e.type === "fin"), 60000);
    verifier(evts(r4).some((e) => e.type === "texte" && e.delta.includes("fin OK")), "lancé, l'agent continue");
  }

  /* Une modification de fichier : son diff, annulable, puis annulée. */
  const r5 = await envoyer("ecris note");
  const cree = evts(r5).find((e) => e.type === "modification");
  const fichier = path.join(projet, "note.txt");
  verifier(cree?.cree === true && cree.annulable && cree.lignes.includes("+bonjour note") && existsSync(fichier), "un fichier créé arrive avec son diff, annulable");
  const r6 = await envoyer("modifie note");
  const modifie = evts(r6).find((e) => e.type === "modification");
  verifier(modifie?.ajouts === 1 && modifie.retraits === 1 && readFileSync(fichier, "utf8") === "salut note\n", "une modification arrive avec son diff (+1 −1)");
  const annule = await appel("/klyra/v1/agent/annuler-modifications", "POST", { requestId: "demande", conversation: "conv-session", ids: [modifie?.id] });
  verifier(annule.json?.resultat?.fichiers?.[0]?.etat === "annule" && readFileSync(fichier, "utf8") === "bonjour note\n", "annulée : le fichier revient comme avant");
  const annuleCree = await appel("/klyra/v1/agent/annuler-modifications", "POST", { requestId: "demande", conversation: "conv-session", ids: [cree?.id] });
  verifier(annuleCree.json?.resultat?.fichiers?.[0]?.etat === "annule" && !existsSync(fichier), "le fichier créé est retiré (à la corbeille du serveur)");

  /* Une commande : sa sortie en direct, puis entière. */
  const r7 = await envoyer("commande compte");
  const sorties = evts(r7).filter((e) => e.type === "sortie");
  if (!verifier(sorties.length > 0 && sorties.some((e) => e.texte.includes("ligne 1")), `la sortie arrive pendant que la commande tourne (${sorties.length} fois)`) && process.env.DEBOGUER) console.log(JSON.stringify(evts(r7).map((e) => e.type)));
  verifier(evts(r7).some((e) => e.type === "etape-fin" && typeof e.sortie === "string" && e.sortie.includes("ligne 6")), "puis entière, à la fin de l'étape");

  /* Revenir à avant : la session reprend au repère de la première réponse, dans une copie. */
  const avant = session;
  const r8 = await envoyer("pense reprise", { reprendreA: fin1?.uuidFin, garderSession: true });
  const nouvelle = evts(r8).find((e) => e.type === "session")?.sessionId;
  verifier(evts(r8).some((e) => e.type === "fin" && e.ok) && !!nouvelle && nouvelle !== avant, "reprise au repère : une nouvelle session (copie), la réponse arrive");

  /* Les routes des projets. */
  const q = `dossier=${encodeURIComponent(projet)}`;
  const liste = await appel(`/klyra/v1/fichiers/liste?${q}`, "GET");
  verifier(liste.json?.fichiers?.includes("src/page.tsx"), "les fichiers du projet pour « @ »");
  mkdirSync(path.join(projet, ".claude"), { recursive: true });
  writeFileSync(path.join(projet, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test:*)", "Read(./src/**)"] } }));
  const regles = await appel(`/klyra/v1/fichiers/regles?${q}`, "GET");
  verifier(regles.json?.regles?.allow?.length === 2, "les autorisations retenues du projet");
  const retire = await appel(`/klyra/v1/fichiers/regles?${q}`, "POST", { liste: "allow", regle: "Bash(npm test:*)" });
  verifier(JSON.stringify(retire.json?.regles?.allow) === JSON.stringify(["Read(./src/**)"]), "une règle retirée");
  const branche = await appel(`/klyra/v1/fichiers/branche?${q}`, "POST", { nom: "essai menu" });
  verifier(branche.json?.branche?.branche === "klyra/essai-menu" && existsSync(path.join(branche.json.branche.dossier, "src", "page.tsx")), "une branche de travail sur le serveur");
  const retireBranche = await appel(`/klyra/v1/fichiers/branche?${encodeURIComponent("dossier")}=${encodeURIComponent(branche.json?.branche?.dossier ?? "")}`, "POST", { retirer: true });
  verifier(retireBranche.json?.retiree === true, "et son dossier retiré");
  const horsKlyra = await appel(`/klyra/v1/fichiers/liste?dossier=${encodeURIComponent(TMP)}`, "GET");
  verifier(horsKlyra.status === 400, "un dossier hors du dossier de klyra est refusé");
  /* Une session lancée au terminal dans ce projet, à côté de celles de l'app. */
  const terminal = "33333333-3333-4333-8333-333333333333";
  const dossierSessions = path.join(vpsHome, ".claude", "projects", projet.replace(/[^a-zA-Z0-9]/g, "-"));
  writeFileSync(
    path.join(dossierSessions, `${terminal}.jsonl`),
    [{ type: "user", message: { role: "user", content: "Corrige le menu" }, timestamp: "2026-11-09T08:00:00Z" }, { type: "assistant", message: { content: [{ type: "text", text: "Corrigé." }] }, timestamp: "2026-11-09T08:00:05Z" }].map((x) => JSON.stringify(x)).join("\n"),
  );
  const sessions = await appel(`/klyra/v1/fichiers/sessions?${q}`, "GET");
  const liste2 = sessions.json?.sessions ?? [];
  if (!verifier(liste2.some((s) => s.id === terminal && s.titre === "Corrige le menu" && !s.deLApp) && liste2.some((s) => s.id === avant), `les sessions du projet sont listées, celle du terminal comprise (${liste2.length})`) && process.env.DEBOGUER) console.log(execFileSync("find", [path.join(vpsHome, ".claude"), "-maxdepth", "4"], { encoding: "utf8" }).slice(0, 3000));
  const lue = await appel(`/klyra/v1/fichiers/session?${q}&id=${terminal}`, "GET");
  verifier(JSON.stringify(lue.json?.messages?.map((m) => [m.auteur, m.texte])) === JSON.stringify([["personne", "Corrige le menu"], ["agent", "Corrigé."]]), "les messages d'une session du terminal se lisent");
  /* Reprise dans l'app : la conversation garde cette session, la suite s'y écrit. */
  session = terminal;
  const r9 = await envoyer("pense suite");
  verifier(evts(r9).find((e) => e.type === "session")?.sessionId === terminal && evts(r9).some((e) => e.type === "fin" && e.ok), "la session du terminal reprend dans l'app (même session)");
  flux.abort();
} finally {
  serveur.kill();
  fournisseur.fermer?.();
  await attendre(500);
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (echecs) {
  console.error(`${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log("Session de Claude Code sur un VPS : tout est vert.");
