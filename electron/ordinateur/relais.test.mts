import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ajouterCopieJson, Relais } from "./relais.ts";

const reponse = (result: unknown) => JSON.stringify({ ok: true, result });

test("la réponse d'un outil gagne une copie JSON de son structuredContent", () => {
  const ligne = reponse({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "Fenêtre lue." }], structuredContent: { window_id: 42, pid: 7, snapshot_id: "s1" } });
  const lu = JSON.parse(ajouterCopieJson(ligne)!);
  assert.equal(lu.result.content.length, 3);
  assert.equal(lu.result.content[0].type, "image", "l'image reste en tête");
  assert.match(lu.result.content[2].text, /^structuredContent en JSON, copié par KLYRA/);
  assert.match(lu.result.content[2].text, /"window_id":42/);
});

test("l'arbre des éléments n'est pas recopié : seulement de quoi les viser", () => {
  const elements = [{ element_index: 1, element_token: "t1", role: "button" }];
  const avecSnapshot = JSON.parse(ajouterCopieJson(reponse({ content: [{ type: "text", text: "arbre" }], structuredContent: { elements, snapshot_id: "s", window_id: 3 } }))!);
  const copie = avecSnapshot.result.content.at(-1).text;
  assert.doesNotMatch(copie, /"elements"/);
  assert.match(copie, /element_address/);
  const sansSnapshot = JSON.parse(ajouterCopieJson(reponse({ content: [{ type: "text", text: "arbre" }], structuredContent: { elements } }))!);
  assert.match(sansSnapshot.result.content.at(-1).text, /"element_tokens":\{"1":"t1"\}/);
});

test("rien à ajouter : erreur, pas de structuredContent, déjà copié, ou entier trop grand", () => {
  assert.equal(ajouterCopieJson(JSON.stringify({ ok: false, error: "non" })), null);
  assert.equal(ajouterCopieJson(reponse({ content: [{ type: "text", text: "x" }] })), null);
  const deja = ajouterCopieJson(reponse({ content: [{ type: "text", text: "x" }], structuredContent: { a: 1 } }))!;
  assert.equal(ajouterCopieJson(deja), null);
  assert.equal(ajouterCopieJson('{"ok":true,"result":{"content":[],"structuredContent":{"id":123456789012345678901}}}'), null);
  assert.equal(ajouterCopieJson("pas du json"), null);
});

test("les longues données base64 sont résumées", () => {
  const data = "A".repeat(5000);
  const lu = JSON.parse(ajouterCopieJson(reponse({ content: [], structuredContent: { png: data } }))!);
  assert.match(lu.result.content.at(-1).text, /\[5000 caractères de données base64\]/);
});

test("le relais transmet tout, et ne complète que les réponses aux appels", { skip: process.platform === "win32" }, async () => {
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-relais-"));
  const adresseDemon = path.join(dossier, "d.sock");
  const adresseRelais = path.join(dossier, "r.sock");
  // Un faux démon : à chaque ligne, une réponse avec structuredContent, en deux morceaux, l'une après l'autre.
  const demon = createServer((s) => {
    let tampon = "";
    let file = Promise.resolve();
    s.on("data", (d) => {
      tampon += d;
      let fl;
      while ((fl = tampon.indexOf("\n")) >= 0) {
        tampon = tampon.slice(fl + 1);
        const r = reponse({ content: [{ type: "text", text: "ok" }], structuredContent: { n: 1 } });
        file = file.then(async () => {
          s.write(r.slice(0, 10));
          await new Promise((fin) => setTimeout(fin, 5));
          s.write(`${r.slice(10)}\n`);
        });
      }
    });
  });
  demon.listen(adresseDemon);
  await once(demon, "listening");
  const relais = new Relais();
  await relais.ecouter(adresseDemon, adresseRelais);
  try {
    const agent = connect(adresseRelais);
    await once(agent, "connect");
    const lignes: string[] = [];
    let tampon = "";
    agent.on("data", (d) => {
      tampon += d;
      let fl;
      while ((fl = tampon.indexOf("\n")) >= 0) {
        lignes.push(tampon.slice(0, fl));
        tampon = tampon.slice(fl + 1);
      }
    });
    agent.write(`${JSON.stringify({ method: "call", name: "list_windows", args: {} })}\n${JSON.stringify({ method: "ping" })}\n`);
    while (lignes.length < 2) await new Promise((r) => setTimeout(r, 10));
    assert.equal(JSON.parse(lignes[0]).result.content.length, 2, "l'appel reçoit la copie");
    assert.equal(JSON.parse(lignes[1]).result.content.length, 1, "le reste passe tel quel");
    agent.destroy();
  } finally {
    await relais.fermer();
    demon.close();
    rmSync(dossier, { recursive: true, force: true });
  }
});
