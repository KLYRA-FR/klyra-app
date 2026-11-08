import assert from "node:assert/strict";
import test from "node:test";
import { lireFiche, messageDepot, passager, plusRecente, relanceApres } from "./maj-depot.ts";

/* Les deux fiches telles que la publication les pose (KLYRA 0.1.209, empreintes raccourcies). */
const WINDOWS = `version: 0.1.209
files:
  - url: KLYRA-0.1.209-win-x64-setup.exe
    sha512: RlxSc+RK71ps==
    size: 133259202
path: KLYRA-0.1.209-win-x64-setup.exe
sha512: RlxSc+RK71ps==
releaseDate: '2026-11-08T11:17:36.330Z'
`;
const MAC = `version: 0.1.209
files:
  - url: KLYRA-0.1.209-arm64-mac.zip
    sha512: ltzJFGi/cWF0==
    size: 152905572
  - url: KLYRA-0.1.209-arm64.dmg
    sha512: PWEg2iJlk5Ig==
    size: 157877630
path: KLYRA-0.1.209-arm64-mac.zip
sha512: ltzJFGi/cWF0==
releaseDate: '2026-11-08T10:56:20.264Z'
`;

test("la fiche Windows donne l'installateur et son empreinte", () => {
  assert.deepEqual(lireFiche(WINDOWS, "-win-x64-setup.exe"), { version: "0.1.209", fichier: "KLYRA-0.1.209-win-x64-setup.exe", empreinte: "RlxSc+RK71ps==" });
});

test("la fiche Mac donne l'archive zip, pas l'image disque, avec sa propre empreinte", () => {
  assert.deepEqual(lireFiche(MAC, "-arm64-mac.zip"), { version: "0.1.209", fichier: "KLYRA-0.1.209-arm64-mac.zip", empreinte: "ltzJFGi/cWF0==" });
  assert.equal(lireFiche(MAC, "-arm64.dmg")?.empreinte, "PWEg2iJlk5Ig==");
});

test("une fiche incomplète, d'un autre système ou avec un chemin est refusée", () => {
  assert.equal(lireFiche(WINDOWS, "-arm64-mac.zip"), null);
  assert.equal(lireFiche("files:\n  - url: a.exe\n    sha512: x\n", ".exe"), null);
  assert.equal(lireFiche("version: 1.0.0\nfiles:\n  - url: a.exe\n", ".exe"), null);
  assert.equal(lireFiche("version: 1.0.0\npath: ../a.exe\nsha512: x\n", ".exe"), null);
  assert.equal(lireFiche("<html>Not Found</html>", ".exe"), null);
});

test("comparaison des numéros", () => {
  assert.ok(plusRecente("0.1.209", "0.1.203"));
  assert.ok(plusRecente("0.1.42", "0.1.9"));
  assert.ok(!plusRecente("0.1.203", "0.1.203"));
  assert.ok(!plusRecente("0.1.9", "0.1.42"));
});

test("un 504 ou une coupure est passager, un 404 non", () => {
  assert.ok(passager(504) && passager(502) && passager(429) && passager(403) && passager(null));
  assert.ok(!passager(404) && !passager(401) && !passager(200));
});

test("relances rapides, puis retour à l'heure", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(relanceApres), [2, 5, 15, 30, null]);
  assert.equal(messageDepot("D", 504, 2), "GitHub ne répond pas (erreur 504). L’app réessaiera dans 2 minutes.");
  assert.equal(messageDepot("D", 504, null), "GitHub ne répond pas (erreur 504). L’app réessaiera dans une heure.");
  assert.match(messageDepot("D", null, 5), /connexion à internet\. L’app réessaiera dans 5 minutes\.$/);
  assert.match(messageDepot("D", 404, null), /introuvable/);
});
