/**
 * Le Coffre dans l'app de bureau (export statique), avec de vrais gestes : Réglages › Coffre (sous
 * Agents), ajouter une clé, la retrouver ; puis la carte sécurisée d'une conversation, où la personne
 * colle la clé demandée par un agent : rangée dans le coffre, carte figée, message à l'agent, et
 * jamais la valeur dans les conversations ni dans la page. Dossier personnel et données temporaires.
 * Avec Claude Code installé (ou `KLYRA_CLAUDE_PATH`) : le vrai Claude Code, face au faux fournisseur
 * local, appelle `coffre_demander` ; la carte s'affiche, la clé collée ne part jamais au modèle.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   xvfb-run -a pnpm test:coffre-ecran -- --no-sandbox
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { demarrerFournisseur } from "./faux-fournisseur.mjs";
import { lancerApp } from "./pilote-app.mjs";

const APP = path.resolve(process.env.KLYRA_TEST_APP ?? path.resolve(import.meta.dirname, ".."));
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-coffre-ecran-"));
const DONNEES = path.join(TMP, "userdata");
const PORT = 9341;
const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail ? `\n       ${String(detail).slice(0, 600).replace(/\n/g, "\n       ")}` : ""}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const CLE_REGLAGES = "sk_live_DepuisLesReglages_123";
const CLE_CARTE = "sk-proj-CollerDansLaCarte_456";
const il_y_a = (min) => new Date(Date.now() - min * 60_000).toISOString();
mkdirSync(DONNEES, { recursive: true });
const demande = (etapeId, variable, nom) => ({ type: "coffre-demande", etapeId, variable, nom, genre: "cle-api", service: "platform.openai.com", raison: "Pour générer les textes de la page.", ouTrouver: "API keys" });
writeFileSync(
  path.join(DONNEES, "conversations.json"),
  JSON.stringify({
    version: 1,
    chats: [{ id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: il_y_a(1), sessions: {}, luJusqua: "m2" }],
    messages: [
      { id: "m1", chatId: "dm-principal", author: { kind: "user" }, createdAt: il_y_a(3), parts: [{ type: "text", text: "Branche l’API OpenAI." }] },
      {
        id: "m2",
        chatId: "dm-principal",
        author: { kind: "role", roleId: "principal" },
        createdAt: il_y_a(2),
        statut: "fait",
        parts: [{ type: "text", text: "Il me faut ta clé : colle-la dans la carte." }, demande("e1", "OPENAI_API_KEY", "Clé OpenAI"), demande("e2", "CLE_STRIPE", "Clé Stripe")],
      },
    ],
    projects: [],
  }),
);
const conversations = () => readFileSync(path.join(DONNEES, "conversations.json"), "utf8");

/* Pas de vrai Claude Code dans cette partie : un faux qui reste ouvert sans rien répondre (le message à l'agent attend). */
const FAUX_CLAUDE = path.join(TMP, "faux-claude.sh");
writeFileSync(FAUX_CLAUDE, "#!/bin/sh\nexec sleep 120\n", { mode: 0o755 });
const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES, KLYRA_TEST_TROUSSEAU: "1", KLYRA_CLAUDE_PATH: FAUX_CLAUDE };
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
  const a = {
    erreurs,
    ev,
    texte: () => ev("document.body.innerText"),
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async ecrire(texte) {
      await send("Input.insertText", { text: texte });
      await attendre(150);
    },
    async cliquerEn(x, y) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
      await attendre(300);
    },
    /** Clique l'élément qui correspond (sélecteur, et texte s'il est donné), après l'avoir fait défiler à l'écran. */
    async cliquer(selecteur, texte = null) {
      const r = await ev(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selecteur)})].find((e) => ${JSON.stringify(texte)} === null || e.innerText.trim() === ${JSON.stringify(texte)} || e.getAttribute("aria-label") === ${JSON.stringify(texte)} || e.placeholder === ${JSON.stringify(texte)});
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      })()`);
      if (!r) throw new Error(`introuvable : ${selecteur} ${texte ?? ""}`);
      await attendre(200);
      await a.cliquerEn(r.x, r.y);
    },
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
  return a;
}

const app = await lancer();
try {
  /* Réglages › Coffre, juste sous Agents. */
  await app.aller("/reglages?section=coffre");
  const sections = await app.ev(`[...document.querySelectorAll("#reglages-navigation [data-entree-reglages]")].map((b) => b.innerText.trim())`);
  verifier(sections?.indexOf("Coffre") === sections?.indexOf("Agents") + 1, "Coffre est dans les Réglages, juste sous Agents", JSON.stringify(sections));
  let t = await app.texte();
  verifier(/Clés et mots de passe/.test(t) && /Aucune clé ni aucun mot de passe/.test(t) && /Connexions de sites/.test(t) && /Ce que tes agents en font/.test(t), "la section montre les clés, les connexions et ce qu’en font les agents", t.slice(0, 800));

  /* Ajouter une clé depuis les Réglages. */
  await app.cliquer("button", "Ajouter un secret");
  await app.cliquer("input", "Clé secrète Stripe");
  await app.ecrire("Clé Stripe");
  const variable = await app.ev(`document.querySelector('input[placeholder="STRIPE_SECRET_KEY"]')?.value`);
  verifier(variable === "CLE_STRIPE", "le nom de variable se déduit du nom", variable);
  await app.cliquer('input[aria-label="Valeur du secret"]');
  await app.ecrire(CLE_REGLAGES);
  verifier((await app.ev(`document.querySelector('input[aria-label="Valeur du secret"]').type`)) === "password", "la valeur se tape dans un champ masqué");
  await app.cliquer("button", "Ranger dans le coffre");
  await attendre(800);
  t = await app.texte();
  verifier(/Clé Stripe/.test(t) && /CLE_STRIPE/.test(t) && /Copier/.test(t), "la clé apparaît dans la liste, avec « Copier »", t.slice(0, 800));
  const coffre = readFileSync(path.join(DONNEES, "coffre.json"), "utf8");
  verifier(coffre.includes("CLE_STRIPE") && !coffre.includes(CLE_REGLAGES), "la clé est rangée chiffrée sur le disque");
  verifier(!(await app.ev(`document.documentElement.outerHTML.includes(${JSON.stringify(CLE_REGLAGES)}) || [...document.querySelectorAll("input")].some((i) => i.value === ${JSON.stringify(CLE_REGLAGES)})`)), "la valeur ne reste nulle part dans la page");
  await app.cliquer("button", "Copier");
  t = await app.texte();
  verifier(/Copié/.test(t), "« Copier » le confirme sans montrer la valeur");

  /* La carte sécurisée d'une conversation. */
  await app.aller("/chat?id=dm-principal");
  await attendre(800);
  t = await app.texte();
  verifier(/te demande une clé API/.test(t) && /OPENAI_API_KEY/.test(t) && /Pour générer les textes de la page/.test(t), "la carte dit qui demande quoi, et pourquoi", t.slice(0, 1200));
  verifier(/Déjà dans ton coffre/.test(t) && /C’est bon, à toi/.test(t), "une clé déjà rangée : la carte le dit et propose de la donner", t.slice(0, 1200));
  await app.cliquer('section[aria-label$="Clé OpenAI"] input');
  await app.ecrire(CLE_CARTE);
  await app.cliquer('section[aria-label$="Clé OpenAI"] button[type="submit"]');
  await attendre(1500);
  t = await app.texte();
  verifier(/Rangé dans le coffre : Clé OpenAI \(OPENAI_API_KEY\)/.test(t), "la carte se fige : rangé dans le coffre", t.slice(0, 1500));
  verifier(/C’est rangé dans le coffre : « Clé OpenAI » \(OPENAI_API_KEY\)/.test(t), "l’agent reçoit un message qui ne dit que le nom", t.slice(0, 1500));
  await attendre(800);
  const disque = conversations();
  verifier(!disque.includes(CLE_CARTE) && !disque.includes(CLE_REGLAGES), "aucune valeur dans les conversations enregistrées");
  verifier(/"etapeId":"e1"[^}]*"reponse":\{"etat":"rangee"/.test(disque), "la réponse est notée sur la carte, dans la conversation", disque.slice(0, 800));
  const coffreApres = readFileSync(path.join(DONNEES, "coffre.json"), "utf8");
  verifier(coffreApres.includes("OPENAI_API_KEY") && !coffreApres.includes(CLE_CARTE), "la clé collée dans la carte est rangée chiffrée");
  verifier(!(await app.ev(`document.documentElement.outerHTML.includes(${JSON.stringify(CLE_CARTE)}) || [...document.querySelectorAll("input")].some((i) => i.value === ${JSON.stringify(CLE_CARTE)})`)), "la valeur collée ne reste pas dans la page");

  /* La clé déjà rangée : la donner d'un clic. */
  await app.cliquer('section[aria-label$="Clé Stripe"] button', "C’est bon, à toi");
  await attendre(1200);
  t = await app.texte();
  verifier(/Permis depuis le coffre : Clé Stripe \(CLE_STRIPE\)/.test(t), "« C’est bon, à toi » fige la carte", t.slice(0, 1500));

  await app.aller("/reglages?section=coffre");
  t = await app.texte();
  verifier(/Clé OpenAI/.test(t) && /OPENAI_API_KEY/.test(t), "la clé collée dans la conversation est dans Réglages › Coffre", t.slice(0, 800));
  verifier(app.erreurs.length === 0, "aucune erreur dans la page", app.erreurs.join("\n"));
} catch (e) {
  verifier(false, "le test s’est déroulé sans erreur", e.stack);
} finally {
  await app.fermer();
}

/* Le vrai Claude Code, face au faux fournisseur : l'outil arrive au modèle, la carte s'affiche, la clé ne part pas. */
const CLAUDE = [process.env.KLYRA_CLAUDE_PATH, path.join(os.homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"].find((c) => c && existsSync(c));
if (!CLAUDE) console.log("(Claude Code introuvable : la partie avec le vrai Claude Code est sautée, KLYRA_CLAUDE_PATH.)");
else {
  const CLE_MODELE = "sk-JamaisVersLeModele_789";
  const donnees = path.join(TMP, "userdata-claude");
  const home = path.join(TMP, "home-claude");
  mkdirSync(donnees, { recursive: true });
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  writeFileSync(path.join(donnees, "conversations.json"), JSON.stringify({ version: 1, chats: [], messages: [] }));
  writeFileSync(path.join(donnees, "mes-agents.json"), JSON.stringify({ version: 1, depart: "reprise", assistant: { nom: "Sam", teinte: null }, agents: {} }));
  const fournisseur = await demarrerFournisseur([]);
  const vrai = await lancerApp({
    port: 9342,
    env: { HOME: home, KLYRA_USER_DATA: donnees, KLYRA_TEST_TROUSSEAU: "1", KLYRA_CLAUDE_PATH: CLAUDE, ANTHROPIC_BASE_URL: fournisseur.url, ANTHROPIC_API_KEY: "sk-faux-essai" },
  });
  try {
    await vrai.aller("/chat?id=dm-principal");
    const carte = `document.querySelector('section[aria-label$="Clé d’essai"]')`;
    await vrai.saisir("main textarea", "coffre stripe-essai");
    await vrai.ev("document.querySelector('main textarea')?.focus(); 0");
    await vrai.touche("Enter", "Enter", 13);
    verifier(await vrai.quand(`${carte}?.innerText.includes('STRIPE_ESSAI')`, 90000), "Claude Code → coffre_demander : la carte sécurisée s’affiche dans le fil", await vrai.texte());
    verifier(await vrai.quand(`[...document.querySelectorAll('[data-auteur="role"]')].at(-1)?.innerText.includes('fin OK')`, 60000), "l’outil répond sans erreur au modèle", await vrai.texte());
    const appel = fournisseur.requetes.find((q) => q.resultats.some((r) => r.texte.includes("carte sécurisée")));
    verifier(!!appel, "le modèle apprend qu’il doit terminer sa réponse et attendre");
    verifier(fournisseur.requetes.some((q) => q.systeme.includes("coffre_demander") && q.systeme.includes("jamais en clair")), "la consigne du coffre arrive au modèle");
    const avant = fournisseur.requetes.length;
    await vrai.ev(`${carte}.querySelector('input').focus(); 0`);
    await vrai.send("Input.insertText", { text: CLE_MODELE });
    await vrai.ev(`${carte}.querySelector('button[type="submit"]').click(); 0`);
    verifier(await vrai.quand(`document.querySelector('main').innerText.includes('Rangé dans le coffre : Clé d’essai (STRIPE_ESSAI)')`, 15000), "la clé collée est rangée, la carte se fige", await vrai.texte());
    const recue = () => fournisseur.requetes.slice(avant).some((q) => q.message.includes("C’est rangé dans le coffre") && q.message.includes("STRIPE_ESSAI"));
    for (let i = 0; i < 120 && !recue(); i++) await attendre(500);
    await attendre(1500);
    verifier(recue(), "l’agent reçoit la réponse de la personne (le nom de la variable)", fournisseur.requetes.slice(avant).map((q) => q.message.slice(0, 120)).join("\n"));
    verifier(fournisseur.requetes.every((q) => !JSON.stringify(q.corps).includes(CLE_MODELE)), "la clé collée ne part jamais au modèle");
    verifier(!readFileSync(path.join(donnees, "conversations.json"), "utf8").includes(CLE_MODELE), "ni dans les conversations enregistrées");
    verifier(vrai.erreurs.length === 0, "aucune erreur dans la page (vrai Claude Code)", vrai.erreurs.join("\n"));

    /* Sur un VPS : un vrai serveur KLYRA local avec ce Claude Code. Le coffre reste sur ce PC, la carte dans son fil. */
    const vps = path.join(TMP, "vps");
    const vpsHome = path.join(vps, "home");
    mkdirSync(path.join(vpsHome, ".local", "bin"), { recursive: true });
    mkdirSync(path.join(vpsHome, ".claude"), { recursive: true });
    symlinkSync(CLAUDE, path.join(vpsHome, ".local", "bin", "claude"));
    writeFileSync(path.join(vpsHome, ".claude", ".credentials.json"), "{}");
    const port = 20000 + Math.floor(Math.random() * 20000);
    const SERVEUR = path.resolve(import.meta.dirname, "..", "serveur", "klyra-serveur.mjs");
    const envServeur = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k))),
      HOME: vpsHome,
      KLYRA_SERVEUR_DONNEES: path.join(vps, "donnees"),
      KLYRA_SERVEUR_PORT: String(port),
      KLYRA_SERVEUR_HOTE: "127.0.0.1",
      KLYRA_SERVEUR_NOM: "Klyra-VPS",
      ANTHROPIC_BASE_URL: fournisseur.url,
      ANTHROPIC_API_KEY: "sk-faux-essai",
    };
    const serveur = spawn(process.execPath, [SERVEUR], { env: envServeur, stdio: "ignore" });
    try {
      const adresse = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 40 && !(await fetch(`${adresse}/`).then(() => true, () => false)); i++) await attendre(250);
      const code = execFileSync(process.execPath, [SERVEUR, "appairer"], { env: envServeur }).toString().trim();
      const lien = `klyra://rejoindre?adresse=${encodeURIComponent(adresse)}&code=${encodeURIComponent(code)}`;
      const bouton = `document.querySelector('nav button[aria-haspopup="menu"][aria-label*="Serveur : "]')`;
      const ligneServeurs = `document.querySelector('[role="menu"][aria-label="Compte"] [aria-haspopup="menu"]')`;
      const ouvrir = async () => {
        if ((await vrai.ev(`${bouton}?.getAttribute('aria-expanded')`)) !== "true") await vrai.ev(`${bouton}.click()`);
        await vrai.quand(`document.querySelector('[role="menu"][aria-label="Compte"]')`);
        if ((await vrai.ev(`${ligneServeurs}?.getAttribute('aria-expanded')`)) !== "true") await vrai.ev(`${ligneServeurs}.click()`);
        return vrai.quand(`document.querySelector('[role="menu"][aria-label="Serveurs"]')`);
      };
      await ouvrir();
      await vrai.cliquer("Ajouter un serveur");
      await vrai.quand(`document.querySelector('input[aria-label="Lien d’invitation"]')`);
      await vrai.saisir('input[aria-label="Lien d’invitation"]', lien);
      await vrai.cliquer("Rejoindre");
      verifier(await vrai.quand(`document.querySelector('main')?.innerText.includes("Klyra-VPS")`), "VPS : Klyra-VPS rejoint par le lien");
      await vrai.aller("/chat?id=dm-principal");
      await ouvrir();
      await vrai.quand(`[...document.querySelectorAll('[role="menuitemradio"]')].some((b) => b.innerText.includes("Répond"))`);
      await vrai.ev(`[...document.querySelectorAll('[role="menuitemradio"]')].find((x) => x.innerText.split("\\n")[0].trim() === "Klyra-VPS")?.click(); 0`);
      const hote = new URL(adresse).host;
      verifier(await vrai.quand(`new URLSearchParams(location.search).get("id") === ${JSON.stringify(`dm-principal@${hote}`)}`), "VPS : la conversation de l’assistant sur Klyra-VPS");
      await vrai.touche("Escape", "Escape", 27);

      const CLE_VPS = "sk-DuVpsJamaisAuModele_314";
      const carteVps = `document.querySelector('section[aria-label$="Clé d’essai"]')`;
      const avantVps = fournisseur.requetes.length;
      await vrai.saisir("main textarea", "coffre vps-essai");
      await vrai.ev("document.querySelector('main textarea')?.focus(); 0");
      await vrai.touche("Enter", "Enter", 13);
      verifier(await vrai.quand(`${carteVps}?.innerText.includes('VPS_ESSAI')`, 90000), "VPS : Claude Code du serveur → coffre_demander : la carte sécurisée s’affiche dans le fil de ce PC", await vrai.texte());
      verifier(await vrai.quand(`[...document.querySelectorAll('[data-auteur="role"]')].at(-1)?.innerText.includes('fin OK')`, 60000), "VPS : l’outil, relayé au coffre de ce PC, répond sans erreur", await vrai.texte());
      verifier(fournisseur.requetes.slice(avantVps).some((q) => q.systeme.includes("coffre_demander") && q.systeme.includes("sur l'ordinateur de la personne")), "VPS : la consigne du coffre arrive au modèle du serveur");
      const avantReponse = fournisseur.requetes.length;
      await vrai.ev(`${carteVps}.querySelector('input').focus(); 0`);
      await vrai.send("Input.insertText", { text: CLE_VPS });
      await vrai.ev(`${carteVps}.querySelector('button[type="submit"]').click(); 0`);
      verifier(await vrai.quand(`document.querySelector('main').innerText.includes('Rangé dans le coffre : Clé d’essai (VPS_ESSAI)')`, 15000), "VPS : la clé collée est rangée dans le coffre de ce PC", await vrai.texte());
      const recueVps = () => fournisseur.requetes.slice(avantReponse).some((q) => q.message.includes("C’est rangé dans le coffre") && q.message.includes("VPS_ESSAI"));
      for (let i = 0; i < 120 && !recueVps(); i++) await attendre(500);
      verifier(recueVps(), "VPS : l’agent du serveur reçoit la réponse (le nom seulement)");
      verifier(fournisseur.requetes.every((q) => !JSON.stringify(q.corps).includes(CLE_VPS)), "VPS : la clé collée ne part jamais au modèle");
      verifier(readFileSync(path.join(donnees, "coffre.json"), "utf8").includes("VPS_ESSAI") && !readFileSync(path.join(donnees, "coffre.json"), "utf8").includes(CLE_VPS), "VPS : elle est chiffrée dans le coffre de ce PC");
      verifier(vrai.erreurs.length === 0, "VPS : aucune erreur dans la page", vrai.erreurs.join("\n"));
    } finally {
      serveur.kill();
    }
  } catch (e) {
    verifier(false, "la partie avec le vrai Claude Code s’est déroulée sans erreur", e.stack);
  } finally {
    await vrai.fermer();
    fournisseur.fermer();
  }
}
rmSync(TMP, { recursive: true, force: true });
console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT PASSE");
process.exit(echecs.length ? 1 : 0);
