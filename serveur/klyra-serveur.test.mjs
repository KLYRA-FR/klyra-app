import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { creerAgents } from "./agents.mjs";
import { CHEMIN, CHEMIN_AGENT, CHEMIN_APPAIRER, CHEMIN_APPAREIL, CHEMIN_FICHES, DUREE_CODE_MS, contexteTelephone, creerCode, creerJournal, ecouter, lireAppareils, revoquerTout } from "./klyra-serveur.mjs";

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
    assert.deepEqual(lu.json, { produit: "klyra-serveur", protocole: 1, nom: "Klyra-vps", version: "1", agents: "absent", equipe: "" });
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

/** Un faux Claude Code : répond « Bonjour <message> » en flux, et demande l'accord avant un outil si le message contient « outil ». */
const FAUX_CLAUDE = `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(process.env.HOME + "/args.log", JSON.stringify(args) + "\\n");
const ecrire = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const session = "11111111-2222-3333-4444-555555555555";
let attente = null;
let tampon = "";
process.stdin.on("data", (d) => {
  tampon += d;
  const lignes = tampon.split("\\n");
  tampon = lignes.pop();
  for (const l of lignes) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.type === "user") {
      ecrire({ type: "system", subtype: "init", session_id: session });
      if (m.message.content.includes("outil")) {
        attente = m.message.content;
        ecrire({ type: "control_request", request_id: "d1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } });
        continue;
      }
      ecrire({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Bonjour " + m.message.content } } });
      ecrire({ type: "result", subtype: "success", is_error: false, result: "Bonjour " + m.message.content, session_id: session });
    }
    if (m.type === "control_response" && attente) {
      const ok = m.response.response.behavior === "allow";
      ecrire({ type: "result", subtype: "success", is_error: false, result: ok ? "outil lancé" : "refusé", session_id: session });
      attente = null;
    }
  }
});
`;

function lireFlux(port, jeton, depuis, instance, jusqua, requete = null) {
  return new Promise((resolve, reject) => {
    const controle = new AbortController();
    const recus = [];
    let instanceRecue = null;
    fetch(`http://127.0.0.1:${port}${CHEMIN_AGENT}/evenements?depuis=${depuis}&instance=${instance}${requete ? `&requete=${requete}` : ""}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: controle.signal })
      .then(async (reponse) => {
        const lecteur = reponse.body.getReader();
        let tampon = "";
        for (;;) {
          const { value, done } = await lecteur.read();
          if (done) break;
          tampon += new TextDecoder().decode(value);
          const blocs = tampon.split("\n\n");
          tampon = blocs.pop();
          for (const bloc of blocs) {
            const data = bloc.split("\n").find((l) => l.startsWith("data: "));
            if (!data) continue;
            const json = JSON.parse(data.slice(6));
            if (bloc.startsWith("event: instance")) instanceRecue = json.instance;
            else recus.push(json);
            if (jusqua(recus)) {
              controle.abort();
              return resolve({ recus, instance: instanceRecue });
            }
          }
        }
      })
      .catch((e) => (e.name === "AbortError" ? null : reject(e)));
    setTimeout(() => {
      controle.abort();
      reject(new Error(`flux incomplet : ${JSON.stringify(recus)}`));
    }, 5000);
  });
}

test("un agent répond sur le VPS, en flux, avec rattrapage et autorisation", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const claude = path.join(home, "faux-claude");
  writeFileSync(claude, FAUX_CLAUDE);
  chmodSync(claude, 0o755);
  writeFileSync(path.join(dossier, "claude-token"), "jeton-claude");
  const journal = creerJournal();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane, claude });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents });
  try {
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", corps: { requestId: "r0" } })).statut, 401);
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    assert.equal((await appel(ecoute.port, CHEMIN, { jeton })).json.agents, "pret");

    const fiches = await appel(ecoute.port, CHEMIN_FICHES, {
      methode: "PUT",
      jeton,
      corps: { fiches: [{ id: "lou", nom: "Lou", contenu: "---\nname: lou\n---\nPrompt." }], assistant: "Cicco", empreinte: "e1" },
    });
    assert.equal(fiches.statut, 200);
    assert.equal(fiches.json.equipe, "e1");
    assert.equal(readFileSync(path.join(home, ".claude", "agents", "lou.md"), "utf8").includes("Prompt."), true);
    assert.equal((await appel(ecoute.port, CHEMIN_FICHES, { methode: "PUT", jeton, corps: { fiches: [{ id: "../x", contenu: "" }] } })).statut, 400);

    const options = { agent: null, prompt: "toi", sessionId: null, acces: "projet" };
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r1", options } })).statut, 202);
    const premier = await lireFlux(ecoute.port, jeton, 0, "", (recus) => recus.some((e) => e.event?.type === "fin"));
    const types = premier.recus.map((e) => e.event.type).filter((t) => t !== "jetons");
    assert.deepEqual(types, ["session", "texte", "fin"]);
    assert.equal(premier.recus.at(-1).event.texte, "Bonjour toi");
    assert.equal(premier.recus.at(-1).requestId, "r1");
    const args = readFileSync(path.join(home, "args.log"), "utf8");
    assert.match(args, /Klyra-VPS/);
    assert.match(args, /Cicco/);

    // Rattrapage : depuis le dernier numéro lu, seulement la suite.
    const dernier = premier.recus.at(-1).seq;
    await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r2", options: { ...options, prompt: "outil", sessionId: "11111111-2222-3333-4444-555555555555" } } });
    const demande = await lireFlux(ecoute.port, jeton, dernier, premier.instance, (recus) => recus.some((e) => e.event?.type === "autorisation"));
    assert.equal(demande.recus.every((e) => e.seq > dernier), true);
    const id = demande.recus.find((e) => e.event?.type === "autorisation").event.id;
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/autoriser`, { methode: "POST", jeton, corps: { requestId: "r2", demandeId: id, decision: "oui" } })).json.ok, true);
    const fin = await lireFlux(ecoute.port, jeton, dernier, premier.instance, (recus) => recus.some((e) => e.event?.type === "fin"));
    assert.equal(fin.recus.find((e) => e.event?.type === "fin").event.texte, "outil lancé");

    // Une autre instance du journal (serveur redémarré) : tout est renvoyé depuis le début.
    const autre = await lireFlux(ecoute.port, jeton, 9999, "ancienne", (recus) => recus.length >= 3);
    assert.equal(autre.recus[0].seq, 1);

    // Le téléphone écrit, PC fermé : chaque événement de la réponse porte sa conversation et son message.
    const contexte = { chatId: "dm-lou", agentId: "lou", titre: "Lou", telephone: { messageId: "tel-1", texte: "toi", creeLe: "2026-11-02T10:00:00.000Z" } };
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r4", options: { ...options, sessionId: "11111111-2222-3333-4444-555555555555" }, contexte } })).statut, 202);
    const duTelephone = await lireFlux(ecoute.port, jeton, 0, premier.instance, (recus) => recus.some((e) => e.requestId === "r4" && e.event?.type === "fin"));
    const r4 = duTelephone.recus.filter((e) => e.requestId === "r4");
    assert.equal(r4.length > 0 && r4.every((e) => e.contexte?.telephone?.messageId === "tel-1" && e.contexte.chatId === "dm-lou"), true);
    // Le téléphone ne suit que sa réponse.
    const filtre = await lireFlux(ecoute.port, jeton, 0, premier.instance, (recus) => recus.some((e) => e.event?.type === "fin"), "r4");
    assert.equal(filtre.recus.every((e) => e.requestId === "r4"), true);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r5", options, contexte: { ...contexte, chatId: "../x" } } })).statut, 400);

    const inconnu = await appel(ecoute.port, `${CHEMIN_AGENT}/envoyer`, { methode: "POST", jeton, corps: { requestId: "r3", options: { ...options, agent: "absent" } } });
    assert.equal(inconnu.statut, 202);
    const refus = await lireFlux(ecoute.port, jeton, 0, premier.instance, (recus) => recus.some((e) => e.requestId === "r3"));
    assert.match(refus.recus.find((e) => e.requestId === "r3").event.erreur, /pas dans Mes agents/);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("les projets du VPS : arbre, lecture et création sous le dossier de klyra seulement", async () => {
  const dossier = dossierJetable();
  const home = dossierJetable();
  const { creerFichiers } = await import("./fichiers.mjs");
  const ecoute = await ecouter({ dossier, port: 0, fichiers: creerFichiers(home) });
  try {
    const jeton = (await appel(ecoute.port, CHEMIN_APPAIRER, { methode: "POST", corps: { code: creerCode(dossier) } })).json.jeton;
    const projet = path.join(home, "projets", "site");
    assert.equal((await appel(ecoute.port, `/klyra/v1/fichiers/dossier?dossier=${encodeURIComponent(projet)}`, { methode: "POST" })).statut, 401);
    const cree = await appel(ecoute.port, `/klyra/v1/fichiers/dossier?dossier=${encodeURIComponent(projet)}`, { methode: "POST", jeton });
    assert.equal(cree.json.dossier, projet);
    writeFileSync(path.join(projet, "lisez-moi.md"), "# Bonjour");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.join(projet, "src"));
    mkdirSync(path.join(projet, "node_modules"));

    const arbre = await appel(ecoute.port, `/klyra/v1/fichiers/arbre?dossier=${encodeURIComponent(projet)}`, { jeton });
    assert.deepEqual(arbre.json.noeuds, [
      { name: "src", path: "src", kind: "dossier" },
      { name: "lisez-moi.md", path: "lisez-moi.md", kind: "fichier" },
    ]);
    const lu = await appel(ecoute.port, `/klyra/v1/fichiers/lire?dossier=${encodeURIComponent(projet)}&relatif=lisez-moi.md`, { jeton });
    assert.equal(Buffer.from(lu.json.base64, "base64").toString(), "# Bonjour");
    assert.equal(lu.json.taille, 9);

    const sortie = await appel(ecoute.port, `/klyra/v1/fichiers/lire?dossier=${encodeURIComponent(projet)}&relatif=../../../etc/passwd`, { jeton });
    assert.equal(sortie.statut, 400);
    const ailleurs = await appel(ecoute.port, `/klyra/v1/fichiers/arbre?dossier=${encodeURIComponent("/etc")}`, { jeton });
    assert.equal(ailleurs.statut, 400);
    assert.match(ailleurs.json.message, /sous/);
    assert.equal((await appel(ecoute.port, `/klyra/v1/fichiers/dossier?dossier=${encodeURIComponent("/tmp/x")}`, { methode: "POST", jeton })).statut, 400);
  } finally {
    await ecoute.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("contexte d'un message du téléphone : seulement une conversation et un texte lisibles", () => {
  const bon = { chatId: "c-1", agentId: "hugo", titre: "Refonte", telephone: { messageId: "m1", texte: "Relance le build", creeLe: "2026-11-02T10:00:00Z" } };
  assert.deepEqual(contexteTelephone(bon), { ...bon, telephone: { ...bon.telephone, creeLe: "2026-11-02T10:00:00.000Z" } });
  assert.equal(contexteTelephone({ ...bon, chatId: "routine-x" }), null);
  assert.equal(contexteTelephone({ ...bon, agentId: "../hugo" }), null);
  assert.equal(contexteTelephone({ ...bon, telephone: { ...bon.telephone, texte: " " } }), null);
  assert.equal(contexteTelephone({ ...bon, telephone: { ...bon.telephone, creeLe: "hier" } }), null);
  assert.equal(contexteTelephone(null), null);
});
