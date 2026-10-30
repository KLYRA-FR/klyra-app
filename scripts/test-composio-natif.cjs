/* eslint-disable @typescript-eslint/no-require-imports -- Harnais Electron CommonJS isolé. */
// Après build:electron : electron scripts/test-composio-natif.cjs
// Profil jetable, API/dialogue simulés. Ne lit aucune clé ni session personnelle.
const { app, dialog, net, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-composio-natif-"));
app.setPath("userData", temporaire);
let nombre = 0;
const limite = setTimeout(() => { console.error(`Échec : délai natif dépassé après ${nombre} contrôles.`); app.exit(1); }, 90_000);
const ok = (texte) => { nombre++; console.log(`OK ${texte}`); };
app.whenReady().then(async () => {
  const cle = "sentinelle-factice-composio-coffre-20261030";
  const fichier = path.join(temporaire, "cle-factice.txt");
  fs.writeFileSync(fichier, cle, { mode: 0o600 });
  let panne = false;
  const appels = [];
  net.fetch = async (url, options) => {
    const u = new URL(url);
    appels.push({ hote: u.hostname, chemin: u.pathname, methode: options?.method ?? "GET" });
    if (u.pathname === "/api/query") {
      assert.deepEqual(JSON.parse(options.body), { path: "equipe:moi", format: "convex_encoded_json", args: [{}] });
      assert.match(options.headers.Authorization, /^Bearer session-factice-/);
      if (panne) throw new Error("réseau simulé");
      return Response.json({ status: "success", value: { _id: options.headers.Authorization.endsWith("B") ? "membre-B" : "membre-A", nom: "Profil simulé" } });
    }
    assert.equal(u.origin, "https://backend.composio.dev");
    assert.equal(options.headers["x-api-key"], cle);
    assert.equal(options.method, "GET", "configuration sans mutation fournisseur");
    return Response.json({ items: [] });
  };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fichier] });
  let natif = require("../dist-electron/composio.js");
  const initial = await natif.espaceComposio.etat();
  assert.equal(initial.configure, false);
  assert.equal(initial.profil.type, "local");
  ok("profil vierge local, aucune session héritée");

  const frame = { url: "app://klyra/reglages?section=composio" };
  const win = { webContents: { mainFrame: frame } };
  const event = { sender: win.webContents, senderFrame: frame };
  natif.verifierFenetreComposio(event, win);
  assert.throws(() => natif.verifierFenetreComposio({ ...event, sender: {} }, win), /refusé/);
  assert.throws(() => natif.verifierFenetreComposio({ ...event, senderFrame: { ...frame } }, win), /refusé/);
  frame.url = "https://externe.example/reglages";
  assert.throws(() => natif.verifierFenetreComposio(event, win), /refusé/);
  frame.url = "http://localhost:3100/reglages";
  natif.verifierFenetreComposio(event, win, "http://localhost:3100");
  ok("IPC réservé au frame principal de KLYRA, origine externe refusée");

  const sur = safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  if (sur) {
    assert.equal(await natif.importerCleComposio(win, initial.contexte), true);
    assert.equal((await natif.espaceComposio.etat()).configure, true);
    const disque = fs.readFileSync(path.join(temporaire, "composio-local.json"), "utf8");
    assert.ok(!disque.includes(cle));
    assert.equal(JSON.parse(safeStorage.decryptString(Buffer.from(JSON.parse(disque).contenu, "base64"))).cle, cle);
    delete require.cache[require.resolve("../dist-electron/composio.js")];
    natif = require("../dist-electron/composio.js");
    const recharge = await natif.espaceComposio.etat();
    assert.equal(recharge.configure, true);
    assert.ok(!JSON.stringify(recharge).includes(cle));
    await natif.espaceComposio.retirerConfiguration(recharge.contexte);
    assert.equal((await natif.espaceComposio.etat()).configure, false);
    ok("coffre natif : import, chiffrement disque, rechargement et retrait sans secret public");
  } else {
    await assert.rejects(natif.importerCleComposio(win, initial.contexte), /coffre/);
    assert.equal(fs.existsSync(path.join(temporaire, "composio-local.json")), false);
    ok("coffre natif indisponible/basic_text : import refusé sans fichier de configuration");
  }
  fs.writeFileSync(fichier, "x".repeat(1025));
  await assert.rejects(natif.importerCleComposio(win, initial.contexte), /fichier/);
  ok("import borné : fichier trop grand refusé");

  const compte = require("../dist-electron/compte.js");
  const identite = require("../dist-electron/composio-identite.js");
  const cleJwt = `__convexAuthJWT_${compte.adresseConvex().replace(/[^a-zA-Z0-9]/g, "")}`;
  const avant = identite.revisionIdentiteComposio();
  await compte.ecrireJeton(cleJwt, "session-factice-A");
  const a = await identite.identiteComposio();
  assert.equal(a.type, "equipe");
  assert.notEqual(a.scope, "local");
  assert.notEqual(a.revision, avant);
  await compte.ecrireJeton(cleJwt, "session-factice-B");
  const b = await identite.identiteComposio();
  assert.notEqual(a.scope, b.scope);
  panne = true;
  await assert.rejects(identite.identiteComposio(), /ne peut pas être vérifié/);
  await compte.retirerJeton(cleJwt);
  const local = await identite.identiteComposio();
  assert.equal(local.scope, "local");
  assert.notEqual(local.revision, avant);
  ok("identité main : membres A/B distincts, réseau en panne sans repli local, retour local invalidant");
  assert.ok(appels.every((a) => a.chemin === "/api/query" || a.methode === "GET"));
  ok("configuration et vérification d’identité sans outil métier ni liaison de compte");
  console.log(`${nombre} contrôles natifs réussis (${sur ? "coffre natif disponible" : "refus de coffre non sûr"}).`);
}).then(() => {
  clearTimeout(limite);
  // Windows verrouille des fichiers du profil tant qu'Electron est vivant.
  // Un nettoyage impossible ne doit pas empêcher l'arrêt du harnais.
  try { fs.rmSync(temporaire, { recursive: true, force: true }); }
  catch { console.log("Profil de test temporaire encore verrouillé ; nettoyage différé au système."); }
  app.exit(0);
}, () => {
  clearTimeout(limite);
  // Les valeurs de l'assertion ne sont pas journalisées (même nos secrets sont factices).
  console.error("Échec du test natif Composio ; profil de test conservé pour diagnostic local."); app.exit(1);
});
