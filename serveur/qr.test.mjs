import assert from "node:assert/strict";
import test from "node:test";
import { infoFormat, infoVersion, lireQr, qrMatrice, qrSvg } from "./qr.mjs";

test("les bits de format et de version suivent les vecteurs connus", () => {
  assert.equal(infoFormat(0), 0x5412);
  assert.equal(infoVersion(7), 0x07c94);
});

test("un lien tient dans le QR et se relit", () => {
  const lien = "klyra://rejoindre?adresse=https%3A%2F%2Fexemple.test&invitation=code-test";
  const modules = qrMatrice(lien);
  assert.equal(modules[0][0], 1);
  assert.equal(lireQr(modules), lien);
  assert.match(qrSvg(lien), /<svg/);
  assert.doesNotMatch(qrSvg(lien), /tarif|prix/i);
});

test("l’adresse https de l’app (Réglages › Mobile) se relit, accents compris, sans Buffer", async () => {
  for (const url of ["https://app.exemple.test", "https://klyra-app.exemple.test/?depuis=réglages"]) assert.equal(lireQr(qrMatrice(url)), url);
  /* Le module est aussi chargé dans la fenêtre de l’app, où Buffer n’existe pas. */
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./qr.mjs", import.meta.url), "utf8"));
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /\bBuffer\b/);
});

test("un lien long, de la taille d’une page https, se relit aussi", () => {
  const lien = `klyra://rejoindre?adresse=${encodeURIComponent("https://trailers-pensions-encouraging-brad.trycloudflare.com")}&invitation=${"a".repeat(24)}`;
  assert.equal(lireQr(qrMatrice(lien)), lien);
});
