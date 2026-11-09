/**
 * Le terminal interactif d'un agent du VPS, de bout en bout sur un vrai serveur KLYRA local : l'agent ouvre un
 * terminal par le serveur MCP du VPS (ia.mjs), lance une commande qui attend une saisie (comme une connexion
 * OAuth qui demande l'URL de retour), l'app voit la session par ses routes (onglet Terminal), la personne y tape,
 * l'agent lit la suite, puis tape un secret du coffre du serveur, masqué partout. Rien ne passe par le journal.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { creerAgents } from "./agents.mjs";
import { creerIa } from "./ia.mjs";
import { CHEMIN_AGENT, CHEMIN_APPAIRER, creerCode, creerJournal, ecouter } from "./klyra-serveur.mjs";

const jetable = () => mkdtempSync(path.join(tmpdir(), "klyra-terminal-"));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function appel(port, chemin, jeton, corps) {
  const reponse = await fetch(`http://127.0.0.1:${port}${chemin}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "demande", ...corps }),
  });
  return { statut: reponse.status, json: await reponse.json().catch(() => null) };
}

async function mcp(config, methode, params = {}) {
  const { url, headers } = JSON.parse(config).mcpServers.klyra;
  const reponse = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: methode, params }) });
  return (await reponse.json()).result;
}
const texteDe = (r) => r.content.map((c) => c.text).join("");

test("terminal d'un agent du VPS : ouvert, vu par l'app, complété par la personne et par l'agent", { skip: process.platform !== "linux" }, async () => {
  const dossier = jetable();
  const home = jetable();
  const journal = creerJournal();
  const publies = [];
  const publier = (requestId, event, sessionId) => {
    publies.push(JSON.stringify(event));
    journal.publier(requestId, event, sessionId);
  };
  const ia = creerIa({ donnees: dossier, version: "1" });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier, spontane: journal.spontane, ia });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents, ia });
  try {
    const jeton = (await (await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN_APPAIRER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: creerCode(dossier) }) })).json()).jeton;
    agents.coffreServeur.ajouter({ variable: "QONTO_JETON_TEST", valeur: "jeton-tres-secret-42", nom: "Jeton de test" }, { par: "personne" });
    const conversation = "klyra-fil-terminal";
    const config = ia.configMcp({ agent: "camille", conversation });
    const noms = (await mcp(config, "tools/list")).tools.map((t) => t.name);
    for (const n of ["terminal_ouvrir", "terminal_envoyer", "terminal_lire", "terminal_fermer"]) assert.ok(noms.includes(n), `${n} servi aux agents du VPS`);

    // 1. L'agent lance une commande qui attend une saisie, dans un vrai terminal.
    const commande = "test -t 0 && echo 'stdin est un terminal'; read -p 'Colle l’URL de retour : ' url; echo \"Retour reçu : $url\"; read -s -p 'Jeton : ' j; echo; echo \"jeton=$j\"; read -p 'Fin ? ' f";
    const ouvert = await mcp(config, "tools/call", { name: "terminal_ouvrir", arguments: { commande, titre: "Connexion de test" } });
    assert.ok(!ouvert.isError, texteDe(ouvert));
    assert.match(texteDe(ouvert), /stdin est un terminal/);
    assert.match(texteDe(ouvert), /Colle l’URL de retour/);
    const id = /term-[0-9a-f]{12}/.exec(texteDe(ouvert))[0];

    // 2. L'app (onglet Terminal) voit la session de cette conversation, et pas dans une autre.
    const liste = await appel(ecoute.port, `${CHEMIN_AGENT}/terminaux`, jeton, { conversation });
    assert.equal(liste.statut, 200);
    assert.deepEqual(liste.json.terminaux.map((t) => [t.id, t.agent, t.titre, t.fini]), [[id, "camille", "Connexion de test", false]]);
    assert.deepEqual((await appel(ecoute.port, `${CHEMIN_AGENT}/terminaux`, jeton, { conversation: "autre" })).json.terminaux, []);
    const vu = (await appel(ecoute.port, `${CHEMIN_AGENT}/terminal-flux`, jeton, { id, depuis: 0 })).json.flux;
    assert.match(vu.donnees, /Colle l’URL de retour/);
    // Sans appareil relié : refusé.
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/terminaux`, "faux", { conversation })).statut, 401);

    // 3. La personne colle l'URL dans le panneau.
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/terminal-saisir`, jeton, { id, donnees: "https://exemple.test/retour?code=abc\r" })).json.ok, true);
    const suite = await mcp(config, "tools/call", { name: "terminal_lire", arguments: { id, attendre: 3 } });
    assert.match(texteDe(suite), /Retour reçu : https:\/\/exemple\.test\/retour\?code=abc/);
    assert.match(texteDe(suite), /Jeton :/);

    // 4. L'agent tape un secret du coffre du serveur : jamais dans sa réponse, masqué dans la sortie.
    const envoi = await mcp(config, "tools/call", { name: "terminal_envoyer", arguments: { id, secret: "QONTO_JETON_TEST", entree: true } });
    assert.ok(!envoi.isError, texteDe(envoi));
    const apres = await mcp(config, "tools/call", { name: "terminal_lire", arguments: { id, attendre: 3 } });
    assert.match(texteDe(apres), /jeton=•{20}/);
    const flux = (await appel(ecoute.port, `${CHEMIN_AGENT}/terminal-flux`, jeton, { id, depuis: 0 })).json.flux;
    assert.doesNotMatch(flux.donnees, /jeton-tres-secret/);
    assert.doesNotMatch(texteDe(envoi) + texteDe(apres), /jeton-tres-secret/);

    // 5. Un autre agent d'une autre conversation n'y touche pas ; la taille suit le panneau ; fermeture.
    const autre = ia.configMcp({ agent: "iris", conversation: "dm-iris" });
    assert.equal((await mcp(autre, "tools/call", { name: "terminal_lire", arguments: { id } })).isError, true);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/terminal-taille`, jeton, { id, cols: 90, rows: 24 })).json.ok, true);
    assert.equal((await mcp(config, "tools/call", { name: "terminal_fermer", arguments: { id } })).isError, undefined);
    await attendre(200);
    assert.deepEqual((await appel(ecoute.port, `${CHEMIN_AGENT}/terminaux`, jeton, { conversation })).json.terminaux, []);
    assert.equal((await appel(ecoute.port, `${CHEMIN_AGENT}/terminal-flux`, jeton, { id, depuis: 0 })).json.flux, null);

    // Rien du terminal (ni l'URL tapée, ni le secret) n'est passé par le journal des événements.
    assert.ok(!publies.some((e) => e.includes("exemple.test") || e.includes("jeton-tres-secret") || e.includes(id)));
  } finally {
    agents.fermerTout();
    await ecoute.fermer();
    ia.fermer();
    rmSync(dossier, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
