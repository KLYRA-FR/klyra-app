import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appairerServeur, appelerServeur, politiqueContenu, retirerAppareil, type DemandeHttp, type RequeteHttp } from "./appel-serveur.ts";
import { MESSAGE_CODE, MESSAGE_INVITATION, MESSAGE_REPONSE, MESSAGE_SILENCE } from "./lecture-serveur.ts";

const CONVEX = [
  "https://calculating-cuttlefish-710.eu-west-1.convex.cloud",
  "wss://calculating-cuttlefish-710.eu-west-1.convex.cloud",
];
const VPS = "https://exemple.test";
const CORPS = { produit: "klyra-serveur", protocole: 1, nom: "Klyra-VPS", version: "1" };

test("connect-src ne nomme pas le VPS : un fetch du rendu vers cette origine est coupé", () => {
  const politique = politiqueContenu(CONVEX);
  const connect = politique.split("; ").find((directive) => directive.startsWith("connect-src "));
  assert.equal(connect, `connect-src 'self' ${CONVEX.join(" ")}`);
  assert.equal(connect?.includes(VPS), false);
  assert.equal(connect?.includes("*"), false);
  assert.equal(/\shttps:(?:\s|$)/.test(connect ?? ""), false);
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  assert.match(main, /politiqueContenu\(sourcesConvex\(\)\)/);
  assert.equal(main.includes("connect-src"), false);
});

test("le processus principal appelle l’origine lue avec le jeton, pas une IP, un http public ni un lien entier", async () => {
  const appels: Array<[string, RequeteHttp]> = [];
  const demander: DemandeHttp = async (url, requete) => {
    appels.push([url, requete]);
    return { status: 200, json: CORPS };
  };

  const lu = await appelerServeur(`${VPS}/autre`, "jeton", demander);
  assert.deepEqual(lu, { ok: true, nom: "Klyra-VPS", version: "1" });
  assert.deepEqual(appels, [[`${VPS}/klyra/v1/serveur`, { methode: "GET", jeton: "jeton" }]]);

  assert.equal((await appelerServeur("https://2.24.45.214", "jeton", demander)).ok, false);
  assert.equal((await appelerServeur("http://exemple.test", "jeton", demander)).ok, false);
  assert.equal((await appelerServeur("klyra://rejoindre?adresse=https%3A%2F%2Fexemple.test&code=ABCDEFGH23", "jeton", demander)).ok, false);
  assert.deepEqual(await appelerServeur(VPS, null, demander), { ok: false, message: MESSAGE_INVITATION });
  assert.equal(appels.length, 1);

  const local = await appelerServeur("http://127.0.0.1:8791", "jeton", demander);
  assert.equal(local.ok, true);
  assert.equal(appels.at(-1)?.[0], "http://127.0.0.1:8791/klyra/v1/serveur");
});

test("l’appairage envoie le code une fois et rend le jeton au processus principal", async () => {
  const appels: Array<[string, RequeteHttp]> = [];
  const jeton = "j".repeat(43);
  const ok = await appairerServeur(`${VPS}/x`, "ABCDEFGH23", "PC", async (url, requete) => {
    appels.push([url, requete]);
    return { status: 200, json: { ...CORPS, jeton } };
  });
  assert.deepEqual(ok, { ok: true, nom: "Klyra-VPS", version: "1", jeton, adresse: VPS });
  assert.deepEqual(appels, [[`${VPS}/klyra/v1/appairer`, { methode: "POST", jeton: null, corps: { code: "ABCDEFGH23", appareil: "PC" } }]]);

  const expire = await appairerServeur(VPS, "ABCDEFGH23", "PC", async () => ({ status: 401, json: { erreur: "code" } }));
  assert.deepEqual(expire, { ok: false, message: MESSAGE_CODE });
  const sansJeton = await appairerServeur(VPS, "ABCDEFGH23", "PC", async () => ({ status: 200, json: CORPS }));
  assert.deepEqual(sansJeton, { ok: false, message: MESSAGE_REPONSE });
  assert.equal((await appairerServeur(VPS, "pas un code", "PC", async () => ({ status: 200, json: CORPS }))).ok, false);
});

test("retirer : vrai seulement si le serveur confirme", async () => {
  assert.equal(await retirerAppareil(VPS, "jeton", async () => ({ status: 204, json: null })), true);
  assert.equal(await retirerAppareil(VPS, "jeton", async () => ({ status: 401, json: null })), false);
  assert.equal(await retirerAppareil(VPS, null, async () => ({ status: 204, json: null })), false);
  assert.equal(await retirerAppareil(VPS, "jeton", async () => { throw new Error("coupé"); }), false);
});

test("une redirection n’est pas une réponse du VPS, une panne reste le silence", async () => {
  const redir = await appelerServeur(VPS, "jeton", async () => ({ status: 302, json: null }));
  assert.deepEqual(redir, { ok: false, message: MESSAGE_REPONSE });
  const panne = await appelerServeur(VPS, "jeton", async () => {
    throw new Error("coupé");
  });
  assert.deepEqual(panne, { ok: false, message: MESSAGE_SILENCE });
});
