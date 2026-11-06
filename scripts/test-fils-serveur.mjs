/**
 * Les fils sur un VPS, PC fermé, de bout en bout : un vrai serveur KLYRA local, le vrai Claude Code face au
 * faux fournisseur local (aucun compte, aucune dépense, cf. faux-fournisseur.mjs), et aucune app qui écoute.
 *  - l'assistant du serveur reçoit « fil hugo » : il appelle `ouvrir_fil` ; le serveur crée le fil dans son
 *    espace et fait travailler Hugo ;
 *  - Hugo répond : la réponse est rangée dans le fil, le ticket passe « à valider » ;
 *  - la réponse revient à l'assistant, dans sa conversation (« Fil terminé »), et il y répond ;
 *  - le journal note que le serveur a fait ce retour (`retourFil`), pour que l'app ne le refasse pas.
 * Prérequis : Claude Code (KLYRA_CLAUDE_PATH, ou sur le PATH).
 *   node scripts/test-fils-serveur.mjs
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

const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-fils-serveur-"));
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

  // L'équipe du serveur : l'assistant Cicco et Hugo.
  const fiche = "---\nname: hugo\ndescription: Dev frontend et backend.\n---\nTu es Hugo, développeur. SOUS-AGENT-TEST-hugo\n";
  const equipe = await appel("/klyra/v1/agents/fiches", "PUT", { fiches: [{ id: "hugo", contenu: fiche }], assistant: "Cicco", configuration: {}, empreinte: "essai-fils" });
  verifier(equipe.status === 200, `l'équipe est sur le serveur (${equipe.status})`);
  // La conversation de l'assistant, connue du serveur (l'app l'y écrit à mesure).
  const lanceur = { chat: { id: "dm-principal", kind: "direct", projectId: null, title: "Cicco", roleIds: ["principal"], updatedAt: new Date().toISOString(), sessions: {}, luJusqua: null }, messages: [] };
  await appel("/klyra/v1/espace/ecrire", "POST", { elements: [{ type: "conversation", id: "dm-principal", valeur: lanceur }] });

  const envoi = await appel("/klyra/v1/agent/envoyer", "POST", { requestId: "essai-fil-1", options: { agent: null, prompt: "fil hugo", sessionId: null, acces: "projet", conversation: "dm-principal" } });
  verifier(envoi.status === 202, `l'assistant du serveur reçoit « fil hugo » (${envoi.status})`);

  const lire = async () => (await appel("/klyra/v1/espace/lire", "POST", {})).json?.resultat?.elements ?? [];
  const conversations = async () => (await lire()).filter((e) => e.type === "conversation").map((e) => e.valeur);
  let fil = null;
  let assistant = null;
  for (let i = 0; i < 360; i++) {
    const toutes = await conversations();
    fil = toutes.find((c) => c.chat.id.startsWith("klyra-fil-")) ?? null;
    assistant = toutes.find((c) => c.chat.id === "dm-principal") ?? null;
    if (fil?.chat.fil.etape === "a-valider" && assistant?.messages.some((m) => m.author.kind === "role" && m.author.roleId === "principal" && m.parts?.[0]?.text === "retour reçu")) break;
    await attendre(500);
  }
  verifier(!!fil, `le fil est dans l'espace du serveur (${fil?.chat.id ?? "absent"})`);
  verifier(fil?.chat.fil.roleId === "hugo" && fil?.chat.fil.lancePar?.chatId === "dm-principal", "il est à Hugo, lancé depuis la conversation de l'assistant");
  verifier(fil?.messages[0]?.parts[0]?.text === "Brief d’essai.", "le brief est le premier message du fil");
  verifier(fil?.messages.some((m) => m.author.kind === "role" && m.author.roleId === "hugo"), "Hugo a répondu dans le fil");
  verifier(fil?.chat.fil.etape === "a-valider" && fil?.chat.fil.retourAttendu === false, `le ticket est « à valider », retour fait (${fil?.chat.fil.etape})`);
  verifier(!!fil?.chat.sessions?.hugo, "la session de Hugo est retenue dans le fil");
  const retour = assistant?.messages.find((m) => m.author.kind === "role" && m.author.roleId === "hugo");
  verifier(/^\*\*Fil terminé : Essai\*\* \(klyra-fil-/.test(retour?.parts?.[0]?.text ?? ""), "« Fil terminé » arrive dans la conversation de l'assistant");
  verifier(assistant?.messages.some((m) => m.author.kind === "role" && m.author.roleId === "principal" && m.parts?.[0]?.text === "retour reçu"), "l'assistant répond au retour du fil");
  const brief = fournisseur.requetes.find((q) => q.message.includes("[Brief de Cicco]"));
  verifier(!!brief && brief.message.includes("Tu travailles dans un fil") && brief.systeme.includes("une tâche = un fil"), "Hugo lit le contexte du fil, et la consigne des fils est donnée");
  verifier(fournisseur.requetes.some((q) => q.resultats.some((r) => !r.erreur && r.texte.includes("Fil ouvert : Essai"))), "l'outil répond à l'assistant : fil ouvert");

  // Ce que l'app relira à sa réouverture : la fin de la réponse de Hugo porte le retour déjà fait.
  const flux = await fetch(`${adresse}/klyra/v1/agent/evenements?depuis=0`, { headers: { Authorization: `Bearer ${jeton}` }, signal: AbortSignal.timeout(1500) })
    .then(async (r) => {
      let texte = "";
      const lecteur = r.body.getReader();
      try {
        for (;;) {
          const { value, done } = await lecteur.read();
          if (done) break;
          texte += new TextDecoder().decode(value);
        }
      } catch {
        /* délai : le flux reste ouvert */
      }
      return texte;
    })
    .catch(() => "");
  verifier(flux.includes('"retourFil":"serveur"'), "le journal dit que le serveur a rapporté la réponse du fil");
} finally {
  serveur.kill();
  fournisseur.fermer?.();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs ? `\n${echecs} échec(s).` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
