import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appelerServeur, politiqueContenu, type DemandeHttp } from "./appel-serveur.ts";
import { MESSAGE_REPONSE, MESSAGE_SILENCE } from "./lecture-serveur.ts";

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

test("le processus principal appelle l’origine lue, pas une IP ni un http public", async () => {
  const urls: string[] = [];
  const codes: Array<string | null> = [];
  const demander: DemandeHttp = async (url, invitation) => {
    urls.push(url);
    codes.push(invitation);
    return { status: 200, json: CORPS };
  };

  const lu = await appelerServeur(`${VPS}/autre`, "code", demander);
  assert.deepEqual(lu, { ok: true, nom: "Klyra-VPS", version: "1" });
  assert.deepEqual(urls, [`${VPS}/klyra/v1/serveur`]);
  assert.deepEqual(codes, ["code"]);

  const ip = await appelerServeur("https://2.24.45.214", "", demander);
  assert.equal(ip.ok, false);
  const http = await appelerServeur("http://exemple.test", "", demander);
  assert.equal(http.ok, false);
  assert.deepEqual(urls, [`${VPS}/klyra/v1/serveur`]);

  const local = await appelerServeur("http://127.0.0.1:8791", null, demander);
  assert.equal(local.ok, true);
  assert.equal(urls.at(-1), "http://127.0.0.1:8791/klyra/v1/serveur");
});

test("une redirection n’est pas une réponse du VPS, une panne reste le silence", async () => {
  const redir = await appelerServeur(VPS, "", async () => ({ status: 302, json: null }));
  assert.deepEqual(redir, { ok: false, message: MESSAGE_REPONSE });
  const panne = await appelerServeur(VPS, "", async () => {
    throw new Error("coupé");
  });
  assert.deepEqual(panne, { ok: false, message: MESSAGE_SILENCE });
});

