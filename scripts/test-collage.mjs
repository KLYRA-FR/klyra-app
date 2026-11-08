/**
 * Coller une capture dans le composeur (Ctrl/Cmd+V), dans l'app de bureau (export
 * statique), sur un profil temporaire, avec des images synthétiques fabriquées ici.
 * Le presse-papiers utilisé est celui de l'écran virtuel du test (xvfb-run) : le
 * script refuse de tourner ailleurs que sous Linux et sans `--presse-papiers-jetable`,
 * pour ne jamais lire ni remplacer le presse-papiers d'un poste.
 * Ctrl+V est un vrai raccourci clavier envoyé à Chromium (son collage natif sous Linux) ;
 * Cmd+V est simulé (la commande « paste » que le menu Édition envoie sur Mac) ;
 * format non admis et représentations multiples passent par un événement de collage
 * synthétique (Chromium réencode toute image du presse-papiers en PNG).
 * Aucun agent ne tourne : Claude Code est rendu introuvable pour l'app.
 * Prérequis : `pnpm build && pnpm build:electron`.
 *   xvfb-run -a pnpm test:coller -- --presse-papiers-jetable [--no-sandbox]
 * (Les règles du collage, sans app : `pnpm test:collage`.)
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

if (process.platform !== "linux" || !process.argv.includes("--presse-papiers-jetable") || !process.env.DISPLAY) {
  console.log("Ce test écrit dans le presse-papiers de l'écran : seulement sous Linux, dans xvfb-run, avec --presse-papiers-jetable.");
  process.exit(0);
}

const APP = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron");
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-collage-"));
const DONNEES = path.join(TMP, "userdata");
const COLLAGES = path.join(DONNEES, "collages");
const PORT = 9340;
const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}`);
  if (!ok) echecs.push(message);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── Images synthétiques ───────────────────────────────────────── */

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloc(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, "ascii"), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}
/** Un PNG RVB de `largeur` × `hauteur` ; `pixel(x, y)` donne [r, v, b]. */
function png(largeur, hauteur, pixel, niveau = 6) {
  const ligne = 1 + largeur * 3;
  const brut = Buffer.alloc(ligne * hauteur);
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) brut.set(pixel(x, y), y * ligne + 1 + x * 3);
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc("IHDR", entete), bloc("IDAT", deflateSync(brut, { level: niveau })), bloc("IEND", Buffer.alloc(0))]);
}
const dimensions = (octets) => ({ largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) });
const IMAGE_1 = png(64, 40, (x, y) => [x * 4, y * 6, 120]);
const IMAGE_2 = png(48, 48, (x, y) => [200, x * 5, y * 5]);
const IMAGE_3 = png(32, 20, (x) => [x * 8, 30, 220]);
const IMAGE_GRANDE = png(1200, 800, (x, y) => [x % 256, y % 256, 180]);
/* Du vrai bruit : Chromium le réencode en PNG, qui ne se compresse pas, au-delà de 20 Mo. */
const BRUIT = randomBytes(3000 * 2600 * 3);
const LOURDE = png(3000, 2600, (x, y) => BRUIT.subarray((y * 3000 + x) * 3, (y * 3000 + x) * 3 + 3), 1);

/* ─── Le profil : une conversation d'équipe et une conversation directe ─── */

const ID = "equipe-collage";
mkdirSync(DONNEES, { recursive: true });
mkdirSync(path.join(TMP, "projet"), { recursive: true });
writeFileSync(
  path.join(DONNEES, "conversations.json"),
  JSON.stringify({
    version: 1,
    chats: [
      { id: ID, kind: "equipe", projectId: "projet-collage", title: "Signaler un problème", roleIds: ["principal"], updatedAt: new Date().toISOString(), sessions: {}, luJusqua: null },
      { id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: new Date().toISOString(), sessions: {}, luJusqua: null },
    ],
    messages: [],
    projects: [
      { id: "projet-collage", name: "Projet d’essai", subtitle: "", status: "en-cours", pinned: false, roleIds: ["principal"], brief: "", previewUrl: "", folder: path.join(TMP, "projet"), files: [], updatedAt: new Date().toISOString() },
    ],
  }),
);
const surDisque = () => JSON.parse(readFileSync(path.join(DONNEES, "conversations.json"), "utf8"));
const collages = () => (existsSync(COLLAGES) ? readdirSync(COLLAGES) : []);

/* Aucun agent ne doit tourner : Claude Code introuvable, aucune clé. */
const env = { ...process.env, HOME: path.join(TMP, "home"), KLYRA_USER_DATA: DONNEES, PATH: "/usr/bin:/bin" };
for (const v of ["ELECTRON_RUN_AS_NODE", "KLYRA_DEV_URL", "KLYRA_CLAUDE_PATH", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[v];

async function lancer() {
  const args = [".", `--remote-debugging-port=${PORT}`, ...process.argv.slice(2).filter((a) => a !== "--presse-papiers-jetable")];
  const processus = spawn(ELECTRON, args, { cwd: APP, env, stdio: "ignore" });
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
    attente[m.id]?.(m);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      attente[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (x) => {
    const m = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "erreur dans la page");
    return m.result?.result?.value;
  };
  for (let i = 0; i < 40 && !(await ev("document.body?.innerText.length > 0 && !!window.klyra")); i++) await attendre(500);
  const touche = async (modifiers, commandes) => {
    const base = { key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, ...(commandes ? { commands: commandes } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  return {
    erreurs,
    ev,
    /** KLYRA_CAPTURES=<dossier> : une capture de l'écran (preuve visuelle). */
    async capture(nom) {
      if (!process.env.KLYRA_CAPTURES) return;
      await attendre(400);
      const m = await send("Page.captureScreenshot", { format: "png" });
      mkdirSync(process.env.KLYRA_CAPTURES, { recursive: true });
      writeFileSync(path.join(process.env.KLYRA_CAPTURES, `${nom}.png`), Buffer.from(m.result.data, "base64"));
    },
    async aller(chemin) {
      await ev(`window.next?.router ? window.next.router.push(${JSON.stringify(chemin)}) : (location.href = ${JSON.stringify(chemin)})`);
      await attendre(1500);
    },
    async quand(expression, ms = 15000) {
      for (let t = 0; t < ms; t += 200) {
        if (await ev(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
        await attendre(200);
      }
      return false;
    },
    focus: () => ev("document.querySelector('textarea[aria-label=\"Message\"]').focus()"),
    copierImage: (octets) =>
      ev(`(async () => { const o = Uint8Array.from(atob(${JSON.stringify(octets.toString("base64"))}), (c) => c.charCodeAt(0)); await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([o], { type: "image/png" }) })]); return true; })()`),
    copierTexte: (texte) => ev(`navigator.clipboard.writeText(${JSON.stringify(texte)}).then(() => true)`),
    /** Ctrl+V : le vrai raccourci, que Chromium traduit lui-même en collage (Linux, Windows). */
    ctrlV: () => touche(2),
    /** Cmd+V simulé : la commande « paste » que le menu Édition d'Electron envoie sur Mac. */
    cmdV: () => touche(4, ["paste"]),
    /** Un collage synthétique : `fichiers` = [{ octets (base64), type, nom }], `donnees` = { type: valeur }. */
    collageSynthetique: (fichiers, donnees = {}) =>
      ev(`(() => {
        const dt = new DataTransfer();
        for (const f of ${JSON.stringify(fichiers)}) dt.items.add(new File([Uint8Array.from(atob(f.octets), (c) => c.charCodeAt(0))], f.nom, { type: f.type }));
        for (const [t, v] of Object.entries(${JSON.stringify(donnees)})) dt.setData(t, v);
        const champ = document.querySelector('textarea[aria-label="Message"]');
        return champ.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      })()`),
    etat: () =>
      ev(`(() => {
        const champ = document.querySelector('textarea[aria-label="Message"]');
        const pieces = [...document.querySelectorAll('button[aria-label^="Retirer "]')].map((b) => b.getAttribute('aria-label').slice(8));
        // Le bandeau « Claude Code est introuvable » est attendu ici (aucun agent ne doit tourner) : on l'écarte.
        const alerte = [...document.querySelectorAll('p[role="alert"]')].map((p) => p.innerText).filter((t) => !t.includes('Claude')).join(' | ');
        return { texte: champ?.value ?? null, pieces, alerte };
      })()`),
    fermer() {
      ws.close();
      processus.kill();
      return new Promise((r) => processus.once("exit", r));
    },
  };
}

const NOM = /^capture-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{12}\.png$/;
let app;
try {
  app = await lancer();
  await app.aller(`/chat?id=${ID}`);
  await app.focus();
  verifier(await app.copierImage(IMAGE_1), "image synthétique copiée dans le presse-papiers de l’écran de test");

  /* 1. Image seule, Ctrl+V. */
  await app.ctrlV();
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 1");
  let e = await app.etat();
  const fichier1 = collages()[0];
  verifier(e.pieces.length === 1 && NOM.test(e.pieces[0]) && e.texte === "", `Ctrl+V d’une capture : une pièce jointe « ${e.pieces[0]} », champ vide`);
  const octets1 = fichier1 ? readFileSync(path.join(COLLAGES, fichier1)) : Buffer.alloc(0);
  verifier(
    fichier1 === e.pieces[0] && JSON.stringify(dimensions(octets1)) === JSON.stringify({ largeur: 64, hauteur: 40 }),
    "le fichier est dans le dossier de l’app (collages/), même nom, PNG de 64 × 40",
  );

  /* La capture se montre : sa vignette et sa puce, avec le nom « image.png » et son poids. */
  await app.quand("document.querySelector('button[aria-label=\"Ouvrir image.png\"] img')?.naturalWidth > 0");
  const vue = await app.ev(`(() => {
    const champ = document.querySelector('textarea[aria-label="Message"]');
    const puce = [...champ.closest('form').querySelectorAll('button')].find((b) => b.innerText.includes('image.png'));
    return { vignette: document.querySelector('button[aria-label="Ouvrir image.png"] img')?.naturalWidth, puce: puce?.innerText.replace(/\\s+/g, ' '), nomLong: champ.closest('form').innerText.includes('capture-') };
  })()`);
  verifier(vue.vignette === 64 && /^image\.png \d+ (o|Ko)$/.test(vue.puce ?? "") && !vue.nomLong, `capture collée : vignette et puce « ${vue.puce} », sans le nom de fichier long`);

  /* 2. Texte seul, Ctrl+V : collage normal. */
  await app.copierTexte("Le bouton Envoyer reste gris.");
  await app.ctrlV();
  await app.quand("document.querySelector('textarea[aria-label=\"Message\"]').value.length > 0");
  e = await app.etat();
  verifier(e.texte === "Le bouton Envoyer reste gris." && e.pieces.length === 1, "Ctrl+V de texte : le texte se colle, aucune pièce jointe en plus");

  /* 3. Texte déjà saisi, puis une autre image. */
  await app.copierImage(IMAGE_2);
  await app.ctrlV();
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 2");
  e = await app.etat();
  verifier(e.pieces.length === 2 && e.texte === "Le bouton Envoyer reste gris.", "texte déjà saisi + image : le texte reste, deux pièces jointes");

  /* 4. La même image recollée : pas de doublon. */
  await app.ctrlV();
  await attendre(1500);
  e = await app.etat();
  verifier(e.pieces.length === 2 && collages().length === 2, "la même image collée deux fois : ni pièce jointe ni fichier en double");

  /* 5. Retrait avant l'envoi. */
  await app.ev(`document.querySelector('button[aria-label="Retirer ${e.pieces[0]}"]').click()`);
  await attendre(400);
  e = await app.etat();
  verifier(e.pieces.length === 1 && e.texte === "Le bouton Envoyer reste gris.", "retrait d’une pièce jointe : l’autre et le texte restent");

  /* 6. Cmd+V (simulé) : la même chose. */
  await app.copierImage(IMAGE_1);
  await app.cmdV();
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 2");
  e = await app.etat();
  verifier(e.pieces.length === 2 && e.pieces.includes(fichier1), "Cmd+V simulé (commande paste du menu Édition) : l’image revient, même fichier");

  /* 7. Trop lourde : rien ne bouge, le message habituel. */
  await app.copierImage(LOURDE);
  await app.ctrlV();
  await app.quand("[...document.querySelectorAll('p[role=\"alert\"]')].some((p) => p.innerText.includes('Image'))", 30000);
  e = await app.etat();
  verifier(/Image trop lourde \(\d+ Mo\) : 20 Mo au plus\./.test(e.alerte) && e.pieces.length === 2 && e.texte === "Le bouton Envoyer reste gris.", `image trop lourde : « ${e.alerte} », texte et pièces intacts`);
  verifier(collages().length === 2, `image trop lourde : aucun fichier écrit (${collages().length} fichiers, pièces : ${e.pieces.join(", ")})`);

  /* 8. Format non admis (collage synthétique). */
  await app.collageSynthetique([{ octets: Buffer.from("II*\0").toString("base64"), type: "image/tiff", nom: "image.tiff" }]);
  await attendre(400);
  e = await app.etat();
  verifier(e.alerte.includes("Format d’image non pris en charge : PNG, JPEG, GIF ou WebP.") && e.pieces.length === 2 && e.texte === "Le bouton Envoyer reste gris.", "format non admis (collage synthétique) : message, rien de joint");

  /* 9. Un geste qui expose plusieurs représentations (synthétique) : une seule pièce jointe. */
  const b64 = IMAGE_3.toString("base64");
  await app.collageSynthetique(
    [
      { octets: b64, type: "image/png", nom: "image.png" },
      { octets: b64, type: "image/png", nom: "image.png" },
    ],
    { "text/html": "<img src=\"capture.png\">" },
  );
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 3");
  await attendre(800);
  e = await app.etat();
  verifier(e.pieces.length === 3 && collages().length === 3 && !e.alerte, "plusieurs représentations dans un même collage : une seule pièce jointe");

  /* 10. Envoi, puis relecture après redémarrage. */
  const joints = e.pieces;
  await app.ev("document.querySelector('textarea[aria-label=\"Message\"]').focus()");
  await app.ev("document.querySelector('form button[type=\"submit\"]').click()");
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 0");
  await attendre(1500);
  const message = surDisque().messages.find((m) => m.chatId === ID && m.author.kind === "user");
  const partie = message?.parts.find((p) => p.type === "fichiers");
  verifier(
    !!partie && partie.chemins.map((c) => path.basename(c)).sort().join() === [...joints].sort().join() && partie.chemins.every((c) => c.startsWith(COLLAGES) && existsSync(c)),
    "envoi : le message garde les trois pièces jointes, fichiers présents dans collages/",
  );
  verifier(message?.parts.some((p) => p.type === "text" && p.text === "Le bouton Envoyer reste gris."), "envoi : le texte part avec, sans message automatique en plus");
  await app.fermer();
  app = await lancer();
  await app.aller(`/chat?id=${ID}`);
  await app.quand(`[...document.querySelectorAll('main button[title]')].some((b) => b.title.startsWith(${JSON.stringify(joints[0])}) && b.querySelector('img')?.naturalWidth > 0)`);
  const fil = await app.ev("document.querySelector('main')?.innerText ?? ''");
  const relus = await app.ev(`[...document.querySelectorAll('main button[title]')].filter((b) => ${JSON.stringify(joints)}.some((n) => b.title.startsWith(n)) && b.querySelector('img')).length`);
  verifier(
    relus === joints.length && !fil.includes(COLLAGES),
    `relecture après redémarrage : la vignette de chaque image, jamais le chemin complet (${relus}/${joints.length}${fil.includes(COLLAGES) ? ", chemin complet visible" : ""})`,
  );

  /* Une image du fil s'ouvre à droite, dans un onglet du panneau (comme dans le chat d'un agent). */
  const PANNEAU = 'aside[aria-label="Panneau de la conversation"]';
  await app.ev(`[...document.querySelectorAll('main button[title]')].find((b) => b.title.startsWith(${JSON.stringify(joints[0])})).click()`);
  await app.quand(`document.querySelector(${JSON.stringify(PANNEAU)} + ' [role="tabpanel"] img')?.naturalWidth > 0`);
  verifier(await app.ev(`!!document.querySelector(${JSON.stringify(PANNEAU)} + ' [role="tabpanel"] img')`), "conversation de projet : clic sur une image du fil, elle s’ouvre à droite, dans le panneau");
  await app.capture("projet-image-ouverte");
  const ongletImage = await app.ev(`document.querySelector(${JSON.stringify(PANNEAU)} + ' [role="tab"][aria-selected="true"]')?.innerText.trim()`);
  await app.ev(`document.querySelector(${JSON.stringify(PANNEAU)} + ' button[aria-label="Fermer l’onglet ${ongletImage}"]')?.click()`);
  const resteOuverte = () => app.ev(`[...document.querySelectorAll(${JSON.stringify(PANNEAU)} + ' [role="tab"]')].some((t) => t.innerText.trim() === ${JSON.stringify(ongletImage)})`);
  for (let i = 0; i < 20 && (await resteOuverte()); i++) await attendre(150);
  verifier(!!ongletImage && !(await resteOuverte()), `conversation de projet : l’image se referme (onglet ${ongletImage})`);

  /* 11. Conversation directe : la même chose. */
  await app.aller("/chat?id=dm-principal");
  await app.focus();
  await app.copierImage(IMAGE_2);
  await app.ctrlV();
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 1");
  e = await app.etat();
  verifier(e.pieces.length === 1 && NOM.test(e.pieces[0]), "conversation directe : Ctrl+V joint la capture");
  await app.aller(`/chat?id=${ID}`);
  await app.aller("/chat?id=dm-principal");
  await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 1");
  verifier((await app.etat()).pieces.length === 1, "la capture reste dans le brouillon après un changement de conversation");

  /* 12. La puce suit le texte, sur sa ligne, comme dans OpenBot. */
  await app.focus();
  await app.copierImage(IMAGE_GRANDE);
  await app.ctrlV();
  verifier(await app.quand("document.querySelectorAll('button[aria-label^=\"Retirer \"]').length === 2"), "une seconde capture, plus grande, rejoint le brouillon");
  const ecrire = (texte) =>
    app.ev(`(() => {
      const champ = document.querySelector('textarea[aria-label="Message"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(champ, ${JSON.stringify(texte)});
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  await ecrire("voici une image d’un test");
  await attendre(400);
  const position = () =>
    app.ev(`(() => {
      const champ = document.querySelector('textarea[aria-label="Message"]');
      const c = champ.getBoundingClientRect();
      const puce = [...champ.closest('form').querySelectorAll('button')].find((b) => b.innerText.includes('image.png')).getBoundingClientRect();
      return { memeLigne: Math.abs(puce.top - c.top) < 4, apres: puce.left >= c.right - 1, hauteur: c.height, largeur: c.width, carte: champ.closest('form').clientWidth };
    })()`);
  let place = await position();
  verifier(place.memeLigne && place.apres, `une ligne de texte : la puce est juste derrière (${JSON.stringify(place)})`);
  await app.capture("composeur-capture-collee");
  await ecrire("Un message bien plus long, ".repeat(20));
  await attendre(400);
  place = await position();
  verifier(place.largeur <= place.carte && place.hauteur > 44 && !place.memeLigne, `texte sur plusieurs lignes : le champ reste dans la carte, la puce passe dessous (${JSON.stringify(place)})`);
  await ecrire("voici une image d’un test");
  await attendre(400);
  await app.ev("document.querySelector('textarea[aria-label=\"Message\"]').blur()");
  await app.ev(`(() => { const rangee = document.querySelector('textarea[aria-label="Message"]').parentElement.parentElement; rangee.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); })()`);
  verifier(await app.ev("document.activeElement === document.querySelector('textarea[aria-label=\"Message\"]')"), "un clic à côté du texte revient au champ");

  /* 13. Un clic ouvre l'image dans un onglet du panneau, en taille réelle. */
  await app.ev("[...document.querySelectorAll('button[aria-label=\"Ouvrir image.png\"]')].at(-1).click()");
  await app.quand("document.querySelector('[role=\"tabpanel\"] img')?.naturalWidth > 0");
  const ouverte = await app.ev(`(() => {
    const aside = document.querySelector('aside[aria-label="Panneau de la conversation"]');
    const onglet = [...aside.querySelectorAll('[role="tab"]')].find((o) => o.innerText === 'image.png');
    return { largeur: aside.querySelector('[role="tabpanel"] img')?.naturalWidth, choisi: onglet?.getAttribute('aria-selected'), panneau: aside.offsetWidth };
  })()`);
  verifier(ouverte.largeur === 1200 && ouverte.choisi === "true" && ouverte.panneau >= 560, `clic sur la vignette : onglet « image.png » dans le panneau, image entière (${JSON.stringify(ouverte)})`);
  await app.capture("panneau-image-ouverte");

  /* Les autres onglets restent là ; rouvrir la même image n'ajoute pas d'onglet ; on la ferme. */
  await app.ev("[...document.querySelectorAll('aside[aria-label=\"Panneau de la conversation\"] [role=\"tab\"]')].find((o) => o.innerText === 'Fichiers').click()");
  await attendre(300);
  verifier(!(await app.ev("!!document.querySelector('[role=\"tabpanel\"] > div img')")), "un autre onglet remplace l’image");
  await app.ev("[...document.querySelectorAll('button[aria-label=\"Ouvrir image.png\"]')].at(-1).click()");
  await attendre(300);
  const onglets = () => app.ev("[...document.querySelectorAll('aside[aria-label=\"Panneau de la conversation\"] [role=\"tab\"]')].filter((o) => o.innerText === 'image.png').length");
  verifier((await onglets()) === 1, "rouvrir la même image : pas de second onglet");
  await app.ev("document.querySelector('aside[aria-label=\"Panneau de la conversation\"] button[aria-label=\"Fermer l’onglet image.png\"]').click()");
  await attendre(300);
  verifier((await onglets()) === 0 && (await app.ev("!!document.querySelector('aside[aria-label=\"Panneau de la conversation\"]')")), "fermer l’onglet : le panneau reste, sur ses onglets");


  /* 14. L'accueil : la même chose, et le message part avec l'image. */
  await app.aller("/");
  await app.quand("document.querySelector('textarea[aria-label=\"Message\"]')");
  await app.focus();
  await app.copierImage(IMAGE_3);
  await app.ctrlV();
  await app.quand("document.querySelector('button[aria-label=\"Ouvrir image.png\"] img')?.naturalWidth > 0");
  e = await app.etat();
  verifier(e.pieces.length === 1 && NOM.test(e.pieces[0]) && e.texte === "", `accueil, Ctrl+V : une pièce jointe « ${e.pieces[0]} », champ vide`);
  const puceAccueil = await app.ev(`[...document.querySelector('textarea[aria-label="Message"]').closest('form').querySelectorAll('button')].some((b) => /^image\\.png \\d+ (o|Ko)$/.test(b.innerText.replace(/\\s+/g, ' ')))`);
  verifier(puceAccueil === true, "accueil : la vignette et la puce, comme dans une conversation");
  await app.capture("accueil-capture-collee");
  await app.copierTexte("Du texte collé sur l’accueil.");
  await app.ctrlV();
  await app.quand("document.querySelector('textarea[aria-label=\"Message\"]').value.length > 0");
  e = await app.etat();
  verifier(e.texte === "Du texte collé sur l’accueil." && e.pieces.length === 1, "accueil, Ctrl+V de texte : le texte se colle, aucune pièce jointe en plus");
  await app.collageSynthetique([{ octets: Buffer.from("II*\0").toString("base64"), type: "image/tiff", nom: "image.tiff" }]);
  await app.quand("[...document.querySelectorAll('p[role=\"alert\"]')].some((p) => p.innerText.includes('Format'))");
  e = await app.etat();
  verifier(e.alerte.includes("Format d’image non pris en charge") && e.pieces.length === 1, "accueil, format non admis : le message s’affiche, rien de joint");
  const avecAccueil = e.pieces[0];
  await app.ev("document.querySelector('form button[type=\"submit\"]').click()");
  await app.quand("location.search.includes('id=')");
  await app.quand(`[...document.querySelectorAll('main button[title]')].some((b) => b.title.startsWith(${JSON.stringify(avecAccueil)}) && b.querySelector('img')?.naturalWidth > 0)`);
  verifier(await app.ev(`[...document.querySelectorAll('main button[title]')].some((b) => b.title.startsWith(${JSON.stringify(avecAccueil)}) && b.querySelector('img')?.naturalWidth > 0)`), "accueil, envoi : la conversation s’ouvre, l’image est dans le fil");

  /* 15. L'image n'est plus sur le disque : le brouillon retombe sur la carte du fichier, sans vignette. */
  const pieces = (await app.etat()).pieces;
  await attendre(1000);
  await app.fermer();
  rmSync(path.join(COLLAGES, pieces[0]));
  app = await lancer();
  await app.aller("/chat?id=dm-principal");
  await app.quand(`document.querySelector(${JSON.stringify(`button[aria-label="Retirer ${pieces[0]}"]`)})?.parentElement.innerText.includes(${JSON.stringify(pieces[0])})`);
  verifier(
    await app.ev(`document.querySelector(${JSON.stringify(`button[aria-label="Retirer ${pieces[0]}"]`)})?.parentElement.innerText.includes(${JSON.stringify(pieces[0])})`),
    "image effacée du disque : la carte du fichier revient à la place de la vignette",
  );

  verifier(app.erreurs.length === 0, `aucune erreur dans la page${app.erreurs.length ? ` (${app.erreurs.join(" | ")})` : ""}`);
} catch (err) {
  verifier(false, `le test a planté : ${err instanceof Error ? err.message : err}`);
} finally {
  await app?.fermer();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(echecs.length ? `\n${echecs.length} échec(s).` : "\nTout passe.");
process.exit(echecs.length ? 1 : 0);
