/**
 * La veille des serveurs MCP d'un VPS, de bout en bout sur un vrai serveur KLYRA local : un MCP de l'agent est en
 * « Needs authentication », l'app le lit par la route `agent/mcp-sante`, lance « Reconnecter », reçoit le lien,
 * renvoie l'adresse de retour, et le MCP repasse « Connected ». Le faux `claude` (scripts/faux-claude-mcp.mjs)
 * répond comme Claude Code 2.1.319. L'adresse de retour ne sort jamais : ni dans le journal, ni dans une réponse.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { creerAgents } from "./agents.mjs";
import { creerIa } from "./ia.mjs";
import { CHEMIN_AGENT, CHEMIN_APPAIRER, creerCode, creerJournal, ecouter } from "./klyra-serveur.mjs";

const jetable = () => mkdtempSync(path.join(tmpdir(), "klyra-mcp-sante-"));
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function appel(port, action, jeton, corps = {}) {
  const reponse = await fetch(`http://127.0.0.1:${port}${CHEMIN_AGENT}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "demande", ...corps }),
  });
  return { statut: reponse.status, json: await reponse.json().catch(() => null) };
}

test("MCP d'un agent du VPS : Needs authentication → Reconnecter → Connected, par les routes de l'app", { skip: process.platform !== "linux" }, async () => {
  const dossier = jetable();
  const home = jetable();
  const claude = path.join(home, "claude");
  writeFileSync(claude, `#!/bin/sh\nexec '${process.execPath}' '${path.join(racine, "scripts", "faux-claude-mcp.mjs")}' "$@"\n`);
  chmodSync(claude, 0o755);
  const prepare = path.join(dossier, "preparation", "principal");
  mkdirSync(prepare, { recursive: true });
  writeFileSync(path.join(prepare, "faux-mcp.json"), JSON.stringify({ "qonto-mcp": "auth" }));

  const journal = creerJournal();
  const publies = [];
  const publier = (requestId, event, sessionId) => {
    publies.push(JSON.stringify(event));
    journal.publier(requestId, event, sessionId);
  };
  const ia = creerIa({ donnees: dossier, version: "1" });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier, spontane: journal.spontane, ia, claude, veilleMcp: false });
  const ecoute = await ecouter({ nom: "Klyra-VPS", dossier, port: 0, journal, agents, ia });
  try {
    const jeton = (await (await fetch(`http://127.0.0.1:${ecoute.port}${CHEMIN_APPAIRER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: creerCode(dossier) }) })).json()).jeton;
    assert.equal((await appel(ecoute.port, "mcp-sante", "faux")).statut, 401, "un appareil relié seulement");

    const sante = await appel(ecoute.port, "mcp-sante", jeton, { verifier: true, forcer: true });
    assert.equal(sante.statut, 200);
    const e = sante.json.sante.entrees.find((x) => x.mcp === "qonto-mcp");
    assert.equal(e?.agent, "principal");
    assert.equal(e?.etat, "authentification");
    assert.ok(typeof e.depuis === "number");

    const refus = await appel(ecoute.port, "mcp-reconnecter", jeton, { agent: "principal", mcp: "inconnu" });
    assert.equal(refus.statut, 400);
    const lance = await appel(ecoute.port, "mcp-reconnecter", jeton, { agent: "principal", mcp: "qonto-mcp" });
    assert.equal(lance.statut, 200, JSON.stringify(lance.json));
    const r = lance.json.reconnexion;
    assert.equal(r.etat, "attente", r.message);
    assert.match(r.lien, /^https:\/\/auth\.exemple\.test\/authorize\?/);

    const adresse = "http://localhost:52768/callback?code=CODE-UNIQUE-42&state=etat-123";
    const mauvaise = await appel(ecoute.port, "mcp-retour", jeton, { id: r.id, adresse: "pas une adresse" });
    assert.equal(mauvaise.statut, 400);
    const fin = await appel(ecoute.port, "mcp-retour", jeton, { id: r.id, adresse });
    assert.equal(fin.json.reconnexion.etat, "connecte", fin.json.reconnexion.message);
    assert.equal(readFileSync(path.join(prepare, "recu.txt"), "utf8"), adresse);

    const apres = await appel(ecoute.port, "mcp-sante", jeton);
    assert.equal(apres.json.sante.entrees.find((x) => x.mcp === "qonto-mcp")?.etat, "connecte");
    // L'état gardé et le journal n'ont ni le code ni l'adresse.
    assert.ok(!readFileSync(path.join(dossier, "mcp-sante.json"), "utf8").includes("CODE-UNIQUE-42"));
    assert.ok(!publies.some((p) => p.includes("CODE-UNIQUE-42")), "rien dans le journal");
    assert.ok(!JSON.stringify(fin.json).includes("CODE-UNIQUE-42"));
  } finally {
    agents.fermerTout();
    await ecoute.fermer();
    ia.fermer();
  }
});
