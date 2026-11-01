import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHEMIN, ecouter, lienInvitation } from "./klyra-serveur.mjs";

async function lire(port, chemin, headers) {
  const reponse = await fetch(`http://127.0.0.1:${port}${chemin}`, { headers, cache: "no-store" });
  const texte = await reponse.text();
  let corps = null;
  try {
    corps = JSON.parse(texte);
  } catch {
    corps = null;
  }
  return { statut: reponse.status, corps, origine: reponse.headers.get("access-control-allow-origin") };
}

test("le client et le VPS partagent le chemin", () => {
  const source = readFileSync(new URL("../src/lib/serveur-vps.ts", import.meta.url), "utf8");
  assert.match(source, /export const CHEMIN_SERVEUR = "\/klyra\/v1\/serveur"/);
  assert.equal(CHEMIN, "/klyra/v1/serveur");
});

test("deux VPS répondent par leur nom, et se taisent s’ils sont fermés", async () => {
  const un = await ecouter({ nom: "Klyra-vps", port: 0 });
  const deux = await ecouter({ nom: "Autre", invitation: "code-test", port: 0 });
  try {
    const premier = await lire(un.port, CHEMIN);
    assert.equal(premier.statut, 200);
    assert.equal(premier.origine, "*");
    assert.deepEqual(premier.corps, { produit: "klyra-serveur", protocole: 1, nom: "Klyra-vps", version: "1" });

    const sansCode = await lire(deux.port, CHEMIN);
    assert.equal(sansCode.statut, 401);
    const avecCode = await lire(deux.port, CHEMIN, { "X-Klyra-Invitation": "code-test" });
    assert.equal(avecCode.corps.nom, "Autre");
    const mauvais = await lire(deux.port, CHEMIN, { "X-Klyra-Invitation": "autre" });
    assert.equal(mauvais.statut, 401);

    const options = await fetch(`http://127.0.0.1:${un.port}${CHEMIN}`, { method: "OPTIONS" });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-headers"), "X-Klyra-Invitation");

    const page = await fetch(`http://127.0.0.1:${un.port}/`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Rejoindre Klyra-vps/);
    assert.match(html, /<svg/);
    assert.match(html, new RegExp(lienInvitation(`http://127.0.0.1:${un.port}`).replace(/[?]/g, "\\?")));
    assert.doesNotMatch(html, /tarif|Adresse du VPS|type="text"/i);

    const ailleurs = await lire(un.port, "/tarif");
    assert.equal(ailleurs.statut, 404);
    const post = await fetch(`http://127.0.0.1:${un.port}${CHEMIN}`, { method: "POST" });
    assert.equal(post.status, 405);
  } finally {
    await un.fermer();
    await deux.fermer();
  }

  await assert.rejects(fetch(`http://127.0.0.1:${un.port}${CHEMIN}`));
});
