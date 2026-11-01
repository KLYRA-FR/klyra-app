import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CHEMIN, CHEMIN_APPAIRER, CHEMIN_APPAREIL, DUREE_CODE_MS, creerCode, ecouter, lireAppareils, revoquerTout } from "./klyra-serveur.mjs";

function dossierJetable() {
  return mkdtempSync(path.join(tmpdir(), "klyra-serveur-"));
}

async function appel(port, chemin, { methode = "GET", jeton, corps } = {}) {
  const headers = {};
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  if (corps !== undefined) headers["Content-Type"] = "application/json";
  const reponse = await fetch(`http://127.0.0.1:${port}${chemin}`, {
    method: methode,
    headers,
    body: corps === undefined ? undefined : JSON.stringify(corps),
    cache: "no-store",
  });
  const texte = await reponse.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    json = null;
  }
  return { statut: reponse.status, json, texte, origine: reponse.headers.get("access-control-allow-origin") };
}

test("le client et le VPS partagent les chemins", () => {
  const lecture = readFileSync(new URL("../electron/lecture-serveur.ts", import.meta.url), "utf8");
  assert.match(lecture, /export const CHEMIN_SERVEUR = "\/klyra\/v1\/serveur"/);
  assert.match(lecture, /export const CHEMIN_APPAIRER = "\/klyra\/v1\/appairer"/);
  assert.match(lecture, /export const CHEMIN_APPAREIL = "\/klyra\/v1\/appareil"/);
  assert.equal(CHEMIN, "/klyra/v1/serveur");
});

test("un code s’échange une fois contre un jeton, qui ouvre le serveur", async () => {
  const dossier = dossierJetable();
  const ecoute = await ecouter({ nom: "Klyra-vps", dossier, port: 0 });
  try {
    const sansJeton = await appel(ecoute.port, CHEMIN);
    assert.equal(sansJeton.statut, 401);
    assert.equal(sansJeton.origine, "*");

    const code = creerCode(dossier);
    assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
    const appaire = await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: code.toLowerCase(), appareil: "PC de test" } });
    assert.equal(appaire.statut, 200);
    assert.equal(appaire.json.produit, "klyra-serveur");
    assert.equal(appaire.json.nom, "Klyra-vps");
    const jeton = appaire.json.jeton;
    assert.match(jeton, /^[A-Za-z0-9_-]{43}$/);

    const encore = await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code } });
    assert.equal(encore.statut, 401, "un code ne sert qu’une fois");

    const lu = await appel(ecoute.port, CHEMIN, { jeton });
    assert.deepEqual(lu.json, { produit: "klyra-serveur", protocole: 1, nom: "Klyra-vps", version: "1" });
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: `${jeton.slice(0, -2)}xx` })).statut, 401);

    // Le serveur ne garde que des empreintes.
    const stockes = readFileSync(path.join(dossier, "appareils.json"), "utf8");
    assert.equal(stockes.includes(jeton), false);
    assert.equal(readFileSync(path.join(dossier, "codes.json"), "utf8").includes(code), false);
    assert.equal(lireAppareils(dossier)[0].nom, "PC de test");
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un code expire, et trop d’essais font tomber les codes en attente", async () => {
  const dossier = dossierJetable();
  let horloge = 1_000_000;
  const ecoute = await ecouter({ dossier, port: 0, maintenant: () => horloge });
  try {
    const vieux = creerCode(dossier, horloge);
    horloge += DUREE_CODE_MS + 1;
    assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: vieux } })).statut, 401);

    const bon = creerCode(dossier, horloge);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: `FAUX${i}` } })).statut, 401);
    }
    assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: bon } })).statut, 401);

    const corpsIllisible = await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN_APPAIRER}`, { method: "POST", body: "x".repeat(5000) });
    assert.equal(corpsIllisible.status, 401);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("un appareil se retire lui-même, et tout peut être révoqué", async () => {
  const dossier = dossierJetable();
  const ecoute = await ecouter({ dossier, port: 0 });
  try {
    const jetonDe = async () => (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const un = await jetonDe();
    const deux = await jetonDe();

    assert.equal((await appel(ecoute.port, CHEMIN_APPAREIL, { methode: "DELETE" })).statut, 401);
    assert.equal((await appel(ecoute.port, CHEMIN_APPAREIL, { methode: "DELETE", jeton: un })).statut, 204);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: un })).statut, 401);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: deux })).statut, 200);

    revoquerTout(dossier);
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton: deux })).statut, 401);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});

test("la page publique ne montre ni lien ni code, le reste est fermé", async () => {
  const dossier = dossierJetable();
  const ecoute = await ecouter({ nom: "Klyra-vps", dossier, port: 0 });
  try {
    const code = creerCode(dossier);
    const page = await appel(ecoute.port, "/");
    assert.equal(page.statut, 200);
    assert.match(page.texte, /Klyra-vps/);
    assert.doesNotMatch(page.texte, /klyra:\/\/|<svg|<script/);
    assert.equal(page.texte.includes(code), false);

    const options = await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN}`, { method: "OPTIONS" });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-headers"), "Authorization, Content-Type");

    assert.equal((await appel(ecoute.port, "/rejoindre")).statut, 404);
    assert.equal((await appel(ecoute.port, "/tarif")).statut, 404);
    assert.equal((await appel(ecoute.port, CHEMIN, { methode: "POST" })).statut, 405);
    assert.equal((await appel(ecoute.port, CHEMIN_APPAIRER)).statut, 405);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
  await assert.rejects(fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN}`));
});
