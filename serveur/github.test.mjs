import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { creerCode, creerJournal, ecouter } from "./klyra-serveur.mjs";

test("les routes GitHub sont réservées aux appareils reliés, sans méthode arbitraire ni secret", async () => {
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-github-http-"));
  let lectures = 0;
  const agents = { fermerTout: () => {}, etat: () => "pret", empreinteEquipe: () => "test", githubProjets: {
    etat: async () => ({ compte: "fixture", connexion: null, enCours: false, erreur: null }),
    depots: async () => { lectures++; return [{ nom: "fixture/prive", prive: true, branche: "main", archive: false }]; },
    branches: async () => { throw new Error("Dépôt GitHub invalide."); },
  } };
  const serveur = await ecouter({ nom: "Fixture", dossier, port: 0, journal: creerJournal(), agents });
  const appel = (route, jeton, method = "POST", corps = {}) => fetch(`http://127.0.0.1:${serveur.port}${route}`, { method, headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(corps) } : {}) });
  try {
    assert.equal((await appel("/klyra/v1/github/depots")).status, 401);
    assert.equal(lectures, 0);
    const appairage = await appel("/klyra/v1/appairer", null, "POST", { code: creerCode(dossier) });
    const { jeton } = await appairage.json();
    assert.ok(jeton);
    const r = await appel("/klyra/v1/github/depots", jeton);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).resultat[0].nom, "fixture/prive");
    assert.equal(lectures, 1);
    assert.equal((await appel("/klyra/v1/github/depots", jeton, "GET")).status, 405);
    assert.equal((await appel("/klyra/v1/github/arbitraire", jeton)).status, 404);
    assert.equal((await appel("/klyra/v1/github/branches", jeton, "POST", { depot: "../secret" })).status, 400);
    const vue = await (await appel("/klyra/v1/github/etat", jeton)).json();
    assert.deepEqual(Object.keys(vue.resultat).sort(), ["compte", "connexion", "enCours", "erreur"]);
  } finally { await serveur.fermer(); rmSync(dossier, { recursive: true, force: true }); }
});
