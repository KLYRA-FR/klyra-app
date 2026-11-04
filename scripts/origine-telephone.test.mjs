import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adressePubliable, creerPasserelle, garderOrigine } from "./origine-telephone.mjs";

const ADRESSE = "https://positioning-columns-eco-clearance.trycloudflare.com";

function portLibre() {
  return new Promise((resolve) => {
    const serveur = createServer();
    serveur.listen(0, "127.0.0.1", () => {
      const { port } = serveur.address();
      serveur.close(() => resolve(port));
    });
  });
}

function exportMinimal(racine) {
  mkdirSync(path.join(racine, "plus"), { recursive: true });
  writeFileSync(path.join(racine, "index.html"), "accueil");
  writeFileSync(path.join(racine, "plus.html"), "plus");
  writeFileSync(path.join(racine, "plus", "__next.plus.__PAGE__.txt"), "page");
}

test("le tunnel répond 502 tant que l'origine est arrêtée, et 200 après sa relance", async () => {
  const dossier = mkdtempSync(path.join(tmpdir(), "klyra-origine-"));
  const port = await portLibre();
  const passerelle = await creerPasserelle(port);
  try {
    exportMinimal(dossier);
    const mort = await fetch(passerelle.url);
    assert.equal(mort.status, 502);
    assert.equal(await mort.text(), "Bad gateway");
    assert.equal(adressePubliable("refuse", ADRESSE), null);

    const origine = await garderOrigine({ racine: dossier, port, intervalleMs: 60_000 });
    try {
      const vif = await fetch(passerelle.url);
      assert.equal(vif.status, 200);
      assert.equal(await vif.text(), "accueil");
      const page = await fetch(`${passerelle.url}plus/__next.plus.__PAGE__.txt`);
      assert.equal(page.status, 200);
      assert.equal(await page.text(), "page");
      assert.equal(await (await fetch(`${passerelle.url}plus`)).text(), "plus");
      assert.equal(adressePubliable("ok", ADRESSE), ADRESSE);

      await origine.simulerArret();
      const retombe = await fetch(passerelle.url);
      assert.equal(retombe.status, 502);
      assert.equal(adressePubliable("refuse", ADRESSE), null);

      const repris = await origine.relancer();
      assert.equal(repris, "ok");
      assert.equal((await fetch(passerelle.url)).status, 200);
      assert.equal(adressePubliable("ok", `${ADRESSE}/`), ADRESSE);
    } finally {
      await origine.fermer();
    }
  } finally {
    await passerelle.fermer();
    rmSync(dossier, { recursive: true, force: true });
  }
});
