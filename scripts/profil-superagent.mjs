/**
 * Scénario sur un profil jetable de l'app (pas le fichier de test, pas les conversations réelles).
 * Le pont `window.klyra.superagent` est celui des outils de fil. Le composeur n'est pas cliqué :
 * un clic enverrait un message à un modèle.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   xvfb-run -a node scripts/profil-superagent.mjs --no-sandbox
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lancerApp, verificateur } from "./pilote-app.mjs";

if (!process.argv.includes("--no-sandbox")) process.argv.push("--no-sandbox", "--disable-gpu");

const PROJET = "projet-jetable";
const FIL = "klyra-fil-jetable";
const MESSAGE = "msg-ouverture-jetable";
const PRECISION = "msg-precision-jetable";
const TEXTE_FIL = "Brief du fil jetable, profil à jeter.";
const { echecs, verifier } = verificateur();

const racine = mkdtempSync(path.join(os.tmpdir(), "klyra-profil-sa-"));
const home = path.join(racine, "home");
const donnees = path.join(racine, "userdata");
mkdirSync(home, { recursive: true });
mkdirSync(donnees, { recursive: true });
const maintenant = new Date().toISOString();
writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify({
  version: 1,
  chats: [{
    id: FIL,
    kind: "direct",
    projectId: PROJET,
    title: "Fil jetable",
    roleIds: ["dev"],
    updatedAt: maintenant,
    sessions: {},
    luJusqua: null,
    fil: { roleId: "dev", statut: "ouvert", creeLe: maintenant, projetId: PROJET, etape: "a-faire" },
  }],
  messages: [{
    id: MESSAGE,
    chatId: FIL,
    author: { kind: "user" },
    createdAt: maintenant,
    parts: [{ type: "text", text: TEXTE_FIL }],
    statut: "fait",
  }],
  routines: [],
  artefacts: [],
  projects: [{
    id: PROJET,
    name: "Projet jetable",
    subtitle: "Profil de contrôle",
    status: "en-cours",
    pinned: true,
    roleIds: [],
    brief: "Profil jetable, aucune conversation réelle.",
    previewUrl: "",
    folder: racine,
    files: [],
    updatedAt: maintenant,
  }],
  currentUser: { id: "local", name: "Profil jetable", title: "Contrôle", initial: "P" },
  acces: null,
  taches: [],
  evenements: [],
  categories: [],
  workflows: [],
  executions: [],
}));

const appeler = (expression) => app.ev(`window.klyra.superagent.${expression}`);

let app;
try {
  app = await lancerApp({ port: 9471, env: { HOME: home, KLYRA_USER_DATA: donnees } });
  const pont = await app.ev("typeof window.klyra?.superagent?.ouvrir");
  verifier(pont === "function", `le pont de l'app est là (${pont})`);

  const ouvert = await appeler(`ouvrir(${JSON.stringify({
    filId: FIL,
    roleId: "dev",
    messageId: MESSAGE,
    brief: TEXTE_FIL,
    titre: "Fil jetable",
    projectId: PROJET,
    compte: "local",
    priorite: 0,
  })})`);
  const travail = ouvert?.data?.work_id;
  verifier(ouvert?.ok === true && ouvert.data?.ok !== false && !!travail, `fil ouvert, travail ${travail ?? JSON.stringify(ouvert)}`);

  const precision = await appeler(`message(${JSON.stringify({
    filId: FIL,
    messageId: PRECISION,
    texte: "Précision sur le même fil.",
    auteur: "user",
    projectId: PROJET,
    compte: "local",
  })})`);
  verifier(precision?.ok === true && precision.data?.work_id === travail && precision.data?.disposition !== "doublon", `précision rejoins le même travail (${precision?.data?.work_id}, ${precision?.data?.disposition})`);

  const doublon = await appeler(`message(${JSON.stringify({
    filId: FIL,
    messageId: PRECISION,
    texte: "Précision sur le même fil.",
    auteur: "user",
    projectId: PROJET,
    compte: "local",
  })})`);
  verifier(doublon?.ok === true && doublon.data?.disposition === "doublon" && doublon.data?.work_id === travail, `doublon, pas un second travail (${doublon?.data?.disposition})`);

  for (const [id, role] of [["klyra-fil-jetable-2", "designer"], ["klyra-fil-jetable-3", "qa"]]) {
    const autre = await appeler(`ouvrir(${JSON.stringify({
      filId: id,
      roleId: role,
      messageId: `msg-${id}`,
      brief: `Brief ${id}`,
      titre: id,
      projectId: PROJET,
      compte: "local",
    })})`);
    verifier(autre?.ok === true && autre.data?.ok !== false, `${id} ouvert (${autre?.data?.motif ?? "ok"})`);
  }
  const quatrieme = await appeler(`ouvrir(${JSON.stringify({
    filId: "klyra-fil-jetable-4",
    roleId: "growth",
    messageId: "msg-klyra-fil-jetable-4",
    brief: "Brief du quatrième",
    titre: "Quatrième",
    projectId: PROJET,
    compte: "local",
  })})`);
  const places = await appeler("peutOuvrir()");
  verifier(quatrieme?.ok === true && quatrieme.data?.ok === false && quatrieme.data?.motif === "capacite_atteinte", `quatrième occupation en attente (${quatrieme?.data?.motif})`);
  verifier(places?.data?.ok === false && places?.data?.places === 0, `plus de place (${places?.data?.places})`);

  const suspendu = await appeler(`marquer(${JSON.stringify(FIL)}, "suspended", null)`);
  const sans = await appeler(`marquer(${JSON.stringify(FIL)}, "active", null)`);
  const avec = await appeler(`marquer(${JSON.stringify(FIL)}, "active", "controle-profil-jetable")`);
  const etat = await appeler(`etat(${JSON.stringify(FIL)})`);
  verifier(suspendu?.data?.ok === true && sans?.data?.ok === false && sans?.data?.motif === "controle_requis", `reprise sans contrôle refusée (${sans?.data?.motif})`);
  verifier(avec?.data?.ok === true && etat?.data?.status === "active" && etat?.data?.work_id === travail, `reprise avec contrôle, même travail (${etat?.data?.status})`);

  const bloque = await appeler(`marquer(${JSON.stringify(FIL)}, "blocked", null)`);
  const passage = await appeler("passage()");
  const projection = await appeler(`projection(${JSON.stringify(PROJET)})`);
  const alertes = projection?.data?.alertes ?? [];
  const alerte = alertes.find((a) => a.work_id === travail && a.type === "W1");
  verifier(bloque?.data?.ok === true && Array.isArray(passage?.data) && !!alerte, `watchdog W1 (${alerte?.motif ?? "aucune"})`);
  const blocages = projection?.data?.blocages ?? [];
  verifier(blocages.length === 0, `aucun blocage affiché par le journal (${blocages.length})`);
  const travaux = projection?.data?.travaux?.length;
  verifier(travaux === 3, `trois travaux, le quatrième n'est pas créé (${travaux})`);

  const fichier = JSON.parse(readFileSync(path.join(donnees, "conversations.json"), "utf8"));
  const messages = (fichier.messages ?? []).filter((m) => m.chatId === FIL);
  const brut = JSON.stringify(messages);
  verifier(messages.length === 1 && brut.includes(TEXTE_FIL) && !brut.includes("Travail bloqué"), `le fil garde son message et pas l'alerte (${messages.length})`);

  await app.aller(`/projet?id=${PROJET}`);
  const vu = await app.quand("document.querySelector('main')?.innerText?.includes('Bloqué') || document.querySelector('main')?.innerText?.includes('Fil jetable')");
  const texte = (await app.texte()) ?? "";
  const mentions = ["lien automatique avec OpenBot", "Point 15", "Point 32", "Point 33", "bascule vers le VPS", "Windows hors ligne", "ne la simule pas"];
  const reste = mentions.filter((m) => texte.includes(m));
  verifier(vu && reste.length === 0, `l'écran du projet ne montre pas les mentions retirées (${reste.join(" | ") || "aucune"})`);
  verifier(texte.includes("W1") && texte.includes("Bloqué"), "l'écran montre l'alerte du watchdog");
  console.log("--- écran ---");
  console.log(texte.split("\n").filter((l) => /Point |W1|Bloqué|Fil jetable|aucun coût|En cours|Suspendu/.test(l)).join("\n"));
} catch (erreur) {
  console.error(erreur.stack || erreur);
  echecs.push(String(erreur));
} finally {
  if (app) await app.fermer();
}

console.log(echecs.length === 0 ? "PROFIL TOUT PASSE" : `${echecs.length} ECHEC(S) PROFIL`);
process.exit(echecs.length === 0 ? 0 : 1);
