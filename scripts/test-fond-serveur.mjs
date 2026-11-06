/**
 * Ce qu'un agent d'un VPS fait encore en arrière-plan, réponse rendue (electron/taches-fond.ts, généré en
 * serveur/taches-fond.mjs) : un vrai serveur KLYRA local, le vrai Claude Code face au faux fournisseur
 * (cf. faux-fournisseur.mjs, ordre « fond »).
 *  - l'assistant lance une commande en fond (Bash, `run_in_background`) et rend sa réponse ;
 *  - le journal dit, après la fin de cette réponse et par elle, la commande en cours (« Capture video ») ;
 *  - la commande finie : la liste se vide, puis la reprise (Claude Code fait reparler l'agent) ;
 *  - la réponse spontanée « fond terminé » arrive, et la reprise se termine.
 * Prérequis : Claude Code (KLYRA_CLAUDE_PATH, ou sur le PATH).
 *   node scripts/test-fond-serveur.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-fond-serveur-"));
const vpsHome = path.join(TMP, "home");
mkdirSync(path.join(vpsHome, ".local", "bin"), { recursive: true });
mkdirSync(path.join(vpsHome, ".claude"), { recursive: true });
symlinkSync(CLAUDE, path.join(vpsHome, ".local", "bin", "claude"));
writeFileSync(path.join(vpsHome, ".claude", ".credentials.json"), "{}");

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
const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });

try {
  for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
  const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
  const appaire = await fetch(`${adresse}/klyra/v1/appairer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, appareil: "Essai" }) }).then((r) => r.json());
  const jeton = appaire.jeton;
  verifier(typeof jeton === "string", "un appareil relié (sans app : rien n'écoute le journal)");
  const appel = (chemin, methode, corps) =>
    fetch(`${adresse}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: corps === undefined ? undefined : JSON.stringify(corps) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  const equipe = await appel("/klyra/v1/agents/fiches", "PUT", { fiches: [], assistant: "Iris", configuration: {}, empreinte: "essai-fond" });
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

  const envoi = await appel("/klyra/v1/agent/envoyer", "POST", { requestId: "essai-fond-1", options: { agent: null, prompt: "fond video", sessionId: null, acces: "tout", conversation: "dm-principal" } });
  verifier(envoi.status === 202, `l'assistant reçoit « fond video » (${envoi.status})`);
  const quand = async (test, ms) => {
    for (let i = 0; i < ms / 200 && !test(); i++) await attendre(200);
    return test();
  };
  const evts = () => lus.filter((x) => x.event).map((x) => ({ id: x.requestId, e: x.event }));
  const finie = await quand(() => evts().some((x) => x.id === "essai-fond-1" && x.e.type === "fin"), 60000);
  verifier(finie, "sa réponse est rendue");
  const iFin = evts().findIndex((x) => x.id === "essai-fond-1" && x.e.type === "fin");
  const fonds = () => evts().filter((x) => x.e.type === "fond");
  verifier(
    fonds().some((x) => x.id === "essai-fond-1" && x.e.taches.length === 1 && x.e.taches[0].description === "Capture video" && x.e.taches[0].genre === "commande"),
    "le journal dit la commande en fond, par la réponse qui l'a lancée",
  );
  const spontanee = await quand(() => evts().some((x) => x.id !== "essai-fond-1" && x.e.type === "texte" && x.e.delta.includes("fond terminé")), 30000);
  verifier(spontanee, "la commande finie, l'agent reprend la parole de lui-même (« fond terminé »)");
  await quand(() => fonds().at(-1)?.e.reprise === false && fonds().length >= 4, 15000);
  const apres = evts().slice(iFin + 1).filter((x) => x.e.type === "fond");
  verifier(apres[0]?.id === "essai-fond-1" && apres[0].e.taches.length === 0 && !apres[0].e.reprise, "après la fin de la réponse : la liste se vide, par la même réponse");
  verifier(apres[1]?.id === "essai-fond-1" && apres[1].e.reprise === true, "puis la reprise, avant la réponse spontanée");
  verifier(fonds().at(-1)?.e.reprise === false, "la reprise se termine avec la réponse spontanée");
  console.log(fonds().map((x) => `${x.id === "essai-fond-1" ? "réponse" : "spontanée"} : ${JSON.stringify({ taches: x.e.taches.map((t) => t.description), reprise: x.e.reprise })}`).join("\n"));
  flux.abort();
} finally {
  serveur.kill();
  fournisseur.fermer?.();
  rmSync(TMP, { recursive: true, force: true });
}
if (echecs) {
  console.error(`${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log("Tâches de fond sur un VPS : tout est vert.");
