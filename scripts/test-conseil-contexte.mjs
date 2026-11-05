/**
 * Le conseil au-dessus du composeur (ConseilContexte, lib/contexte.ts), dans l'app de bureau
 * (export statique), sur des conversations dont la taille a été mesurée :
 * - conversation d'équipe lourde : « Résumer la conversation », pas de fil, « Plus tard » qui tient
 *   après un redémarrage ;
 * - conversation d'équipe moyenne après une pause : rien (un résumé ne rattraperait pas la relecture) ;
 * - chat d'un agent moyen après une pause : « Repartir à zéro » (pas de fil, qui serait une tâche de plus), pas de résumé ;
 * - fil moyen après une pause : « Nouveau fil », qui ouvre un fil neuf, pas de résumé ;
 * - mesure d'une ancienne session : ignorée.
 * Dossier personnel et données de l'app temporaires ; aucun agent n'est lancé.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   pnpm test:conseil-contexte          (sous Linux sans bac à sable : -- --no-sandbox)
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(process.env.KLYRA_TEST_APP ?? path.resolve(import.meta.dirname, ".."));
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-conseil-contexte-"));
const DONNEES = path.join(TMP, "userdata");
const PORT = 9373;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── Les données de départ ─────────────────────────────────────── */

const il_y_a = (min) => new Date(Date.now() - min * 60_000).toISOString();
const DOSSIER_PROJET = path.join(TMP, "projet-essai");
mkdirSync(DOSSIER_PROJET, { recursive: true });
mkdirSync(DONNEES, { recursive: true });
const equipe = (id, titre, contexte, extra = {}) => ({
  id,
  kind: "equipe",
  projectId: "projet-essai",
  title: titre,
  roleIds: ["principal"],
  updatedAt: il_y_a(5),
  sessions: { principal: `session-${id}` },
  luJusqua: null,
  contexte: { principal: { ...contexte, session: contexte.session ?? `session-${id}` } },
  ...extra,
});
const depart = {
  version: 1,
  chats: [
    equipe("equipe-lourde", "Conversation lourde", { jetons: 92_000, le: il_y_a(2) }),
    equipe("equipe-pause", "Conversation après une pause", { jetons: 40_000, le: il_y_a(130) }),
    equipe("equipe-ancienne", "Mesure d’une ancienne session", { jetons: 150_000, le: il_y_a(2), session: "session-perimee" }),
    {
      id: "dm-principal",
      kind: "direct",
      projectId: null,
      title: "Principal",
      roleIds: ["principal"],
      updatedAt: il_y_a(130),
      sessions: { principal: "session-directe" },
      luJusqua: null,
      contexte: { principal: { jetons: 45_000, le: il_y_a(130), session: "session-directe" } },
      contexteMasqueJusqua: 40_000,
    },
    {
      id: "klyra-fil-pause",
      kind: "direct",
      projectId: null,
      title: "Un fil",
      roleIds: ["principal"],
      updatedAt: il_y_a(130),
      sessions: { principal: "session-fil" },
      luJusqua: null,
      fil: { roleId: "principal", statut: "ouvert", creeLe: il_y_a(200), lancePar: null, etape: "a-faire" },
      contexte: { principal: { jetons: 45_000, le: il_y_a(130), session: "session-fil" } },
    },
  ],
  messages: [
    { id: "d1", chatId: "dm-principal", author: { kind: "user" }, createdAt: il_y_a(131), parts: [{ type: "text", text: "Ancien sujet." }] },
    { id: "d2", chatId: "dm-principal", author: { kind: "role", roleId: "principal" }, createdAt: il_y_a(130), statut: "fait", parts: [{ type: "text", text: "Réponse ancienne." }] },
    { id: "m1", chatId: "equipe-lourde", author: { kind: "user" }, createdAt: il_y_a(3), parts: [{ type: "text", text: "On continue." }] },
    { id: "m2", chatId: "equipe-lourde", author: { kind: "role", roleId: "principal" }, createdAt: il_y_a(2), statut: "fait", parts: [{ type: "text", text: "Je continue." }] },
  ],
  projects: [
    { id: "projet-essai", name: "Projet d’essai", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: DOSSIER_PROJET, files: [], updatedAt: il_y_a(60) },
  ],
};
const CONVERSATIONS = path.join(DONNEES, "conversations.json");
writeFileSync(CONVERSATIONS, JSON.stringify(depart));
const surDisque = () => JSON.parse(readFileSync(CONVERSATIONS, "utf8"));

/* ─── L'app et ses outils de pilotage ───────────────────────────── */

const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KLYRA_DEV_URL;

async function lancer() {
  const processus = spawn(ELECTRON, [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2)], { cwd: APP, env, stdio: "ignore" });
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(500);
    cible = await fetch(`http://127.0.0.1:${PORT}/json`)
      .then((r) => r.json())
      .then((t) => t.find((x) => x.type === "page" && x.url.startsWith("app://")))
      .catch(() => undefined);
  }
  if (!cible) throw new Error("la fenêtre de l’app n’apparaît pas");
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const attente = {};
  const erreurs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") erreurs.push(m.params.exceptionDetails.exception?.description);
    attente[m.id]?.(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
  for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  return {
    erreurs,
    ev,
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async cliquerBouton(libelle) {
      const r = await ev(`(() => {
        const b = [...document.querySelectorAll("[data-conseil-contexte] button")].find((x) => x.innerText.trim() === ${JSON.stringify(libelle)});
        const box = b?.getBoundingClientRect();
        return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`);
      if (!r) throw new Error(`bouton introuvable : ${libelle}`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
      await attendre(800);
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
}

const conseil = (a) =>
  a.ev(`(() => {
    const c = document.querySelector("[data-conseil-contexte]");
    return c ? { raison: c.dataset.conseilContexte, texte: c.innerText, boutons: [...c.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
  })()`);

/** Le conseil une fois la conversation affichée (son composeur est là) : présent, ou absent pour de bon. */
async function conseilPret(a) {
  for (let i = 0; i < 20; i++) {
    if (await a.ev(`!!document.querySelector("textarea")`)) break;
    await attendre(250);
  }
  for (let i = 0; i < 8; i++) {
    const c = await conseil(a);
    if (c) return c;
    await attendre(250);
  }
  return null;
}

/* ─── Le parcours ───────────────────────────────────────────────── */

let app = await lancer();
try {
  await app.aller("/chat?id=equipe-lourde");
  let c = await conseilPret(app);
  verifier(c?.raison === "lourde" && /relit 92 k jetons à chaque étape/.test(c.texte), `équipe lourde : le conseil dit ce que relit chaque étape (${c?.texte ?? "absent"})`);
  verifier(!!c && c.boutons.includes("Résumer la conversation") && !c.boutons.includes("Nouveau fil"), `équipe lourde : résumer, sans fil (${c?.boutons.join(", ")})`);
  await app.cliquerBouton("Plus tard");
  verifier((await conseil(app)) === null, "« Plus tard » : le conseil disparaît");

  await app.aller("/chat?id=equipe-pause");
  verifier((await conseilPret(app)) === null, "équipe moyenne après une pause : pas de conseil (pas de fil, résumer ne rattraperait rien)");

  await app.aller("/chat?id=equipe-ancienne");
  verifier((await conseilPret(app)) === null, "mesure d’une ancienne session : ignorée");

  await app.aller("/chat?id=dm-principal");
  c = await conseilPret(app);
  verifier(c?.raison === "pause" && /Pause de plus d’une heure/.test(c.texte) && /45 k jetons/.test(c.texte), `directe après une pause : le conseil le dit (${c?.texte ?? "absent"})`);
  verifier(!!c && c.boutons.includes("Repartir à zéro") && !c.boutons.includes("Nouveau fil") && !c.boutons.includes("Résumer la conversation"), `chat d’un agent après une pause : repartir à zéro, ni fil ni résumé (${c?.boutons.join(", ")})`);
  await app.cliquerBouton("Repartir à zéro");
  verifier((await conseil(app)) === null, "« Repartir à zéro » : le conseil disparaît");
  verifier(await app.ev(`!!document.querySelector("[data-depart]") && document.body.innerText.includes("Réponse ancienne.")`), "le séparateur apparaît, l’ancienne réponse reste lisible");

  await app.aller("/chat?id=klyra-fil-pause");
  c = await conseilPret(app);
  verifier(!!c && c.boutons.includes("Nouveau fil") && !c.boutons.includes("Repartir à zéro") && !c.boutons.includes("Résumer la conversation"), `fil après une pause : un fil neuf, pas de résumé (${c?.boutons.join(", ")})`);
  await app.cliquerBouton("Nouveau fil");
  const adresse = await app.ev("location.search");
  verifier(/id=klyra-fil-/.test(decodeURIComponent(adresse ?? "")), `« Nouveau fil » ouvre un fil neuf (${adresse})`);
  verifier((await conseilPret(app)) === null, "le fil neuf n’a pas de conseil");
  verifier(app.erreurs.length === 0, `aucune erreur dans la page (${app.erreurs.join(" | ") || "aucune"})`);

  await attendre(1500);
  await app.fermer();
  const directe = surDisque().chats.find((x) => x.id === "dm-principal");
  verifier(directe?.departs?.length === 1 && Object.keys(directe.sessions).length === 0 && !directe.contexte && directe.contexteMasqueJusqua === undefined, "repartie à zéro : plus de session, de mesure ni de masquage, le départ est enregistré");
  verifier(surDisque().messages.filter((m) => m.chatId === "dm-principal").length === 2, "repartie à zéro : les messages restent");
  const lourde = surDisque().chats.find((x) => x.id === "equipe-lourde");
  verifier(lourde?.contexteMasqueJusqua === 112_000, `« Plus tard » enregistré : le conseil revient au-delà de 112 k jetons (${lourde?.contexteMasqueJusqua})`);

  app = await lancer();
  await app.aller("/chat?id=equipe-lourde");
  verifier((await conseilPret(app)) === null, "après un redémarrage, « Plus tard » tient");
  await app.fermer();
} catch (erreur) {
  verifier(false, `parcours interrompu : ${erreur instanceof Error ? erreur.message : erreur}`);
  await app.fermer().catch(() => {});
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

if (echecs.length) {
  console.log(`\n${echecs.length} échec(s).`);
  process.exit(1);
}
console.log("\nTout est bon.");
