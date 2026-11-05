/**
 * Les comptes Claude d'un VPS, de bout en bout : le vrai serveur KLYRA sur 127.0.0.1 et un faux Claude Code
 * (scripts/faux-comptes-claude.cjs : comptes fictifs, dossiers jetables). Le compte des agents reste celui de
 * `connecter-claude` ; un compte ajouté passe par la page d'Anthropic (ouverte par l'app sur le PC) puis le code.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { creerAgents } from "./agents.mjs";
import { creerIa } from "./ia.mjs";
import { creerMoteurs } from "./moteurs.mjs";
import { creerCode, creerJournal, ecouter } from "./klyra-serveur.mjs";

const FAUX = fileURLToPath(new URL("../scripts/faux-comptes-claude.cjs", import.meta.url));

test("VPS : ajouter un compte Claude par la page et le code, lire ses limites, le déconnecter", { skip: process.platform === "win32" }, async (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "klyra-comptes-vps-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, "klyra");
  const donnees = path.join(home, "donnees");
  mkdirSync(donnees, { recursive: true });
  /* Le compte des agents : le jeton longue durée de `connecter-claude`. */
  writeFileSync(path.join(donnees, "claude-token"), "sk-ant-oat01-fictif", { mode: 0o600 });
  const claude = path.join(tmp, "claude");
  writeFileSync(claude, `#!/bin/sh\nexec "${process.execPath}" "${FAUX}" "$@"\n`);
  chmodSync(claude, 0o755);
  const avant = { ...process.env };
  t.after(() => { for (const cle of ["KLYRA_FAUX_DEUX_TEMPS", "KLYRA_FAUX_EMAIL"]) if (avant[cle] === undefined) delete process.env[cle]; });
  Object.assign(process.env, { KLYRA_FAUX_DEUX_TEMPS: "1", KLYRA_FAUX_EMAIL: "second@example.test" });

  const journal = creerJournal(Date.now, path.join(donnees, "sessions-conversations.json"));
  const ia = creerIa({ donnees, version: "1" });
  const agents = creerAgents({ home, donnees, nomServeur: "essai", publier: () => {}, spontane: journal.spontane, ia, claude, codex: null, grok: null });
  const moteurs = creerMoteurs({ home, donnees, claude: agents.claude, codex: agents.codex, grok: agents.grok });
  const serveur = await ecouter({ nom: "essai", dossier: donnees, journal, agents, moteurs, ia });
  t.after(async () => {
    const fin = serveur.fermer();
    serveur.serveur.closeAllConnections();
    await fin;
  });
  const base = `http://127.0.0.1:${serveur.port}`;
  const { jeton } = await (await fetch(`${base}/klyra/v1/appairer`, { method: "POST", body: JSON.stringify({ code: creerCode(donnees), appareil: "essai" }) })).json();
  const appel = async (chemin, methode = "GET", corps) => {
    const r = await fetch(`${base}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}` }, ...(corps ? { body: JSON.stringify(corps) } : {}) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  assert.equal((await fetch(`${base}/klyra/v1/moteurs/claude/comptes`)).status, 401);
  let comptes = (await appel("/klyra/v1/moteurs/claude/comptes")).json.comptes;
  assert.deepEqual(comptes.map((c) => [c.id, c.poste, c.connecte, c.methode]), [["poste", true, true, "jeton"]]);
  /* Le compte des agents ne se change pas d'ici. */
  const poste = await appel("/klyra/v1/moteurs/claude/comptes/connexion", "POST", { id: "poste" });
  assert.equal(poste.status, 400);
  assert.match(poste.json.message, /connecter-claude/);

  const debut = (await appel("/klyra/v1/moteurs/claude/comptes/connexion", "POST", {})).json;
  assert.match(debut.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
  assert.equal(debut.compte.attenteCode, true);
  const id = debut.compte.id;
  assert.equal((await appel("/klyra/v1/moteurs/claude/comptes/code", "POST", { id, code: "mauvais-code#etat" })).status, 400);
  const relance = (await appel("/klyra/v1/moteurs/claude/comptes/connexion", "POST", { id })).json;
  assert.equal(relance.compte.id, id);
  const connecte = (await appel("/klyra/v1/moteurs/claude/comptes/code", "POST", { id, code: "bon-code#etat" })).json.compte;
  assert.deepEqual([connecte.connecte, connecte.email, connecte.poste], [true, "second@example.test", false]);
  /* Son propre dossier de connexion, sous les données du serveur, hors du ~/.claude du compte des agents. */
  assert.ok(existsSync(path.join(donnees, "claude-comptes", id, "connexion-test.json")));
  assert.equal(existsSync(path.join(home, ".claude", "connexion-test.json")), false);
  assert.equal(readFileSync(path.join(donnees, "claude-token"), "utf8"), "sk-ant-oat01-fictif");

  /* Les limites : rien d'inventé avant le clic, puis celles du compte lui-même. */
  assert.equal((await appel(`/klyra/v1/moteurs/claude/utilisation?compte=${id}`)).json.utilisation, null);
  const lue = (await appel(`/klyra/v1/moteurs/claude/utilisation?compte=${id}&actualiser=1`)).json.utilisation;
  assert.equal(lue.session.utilise, 0.25);
  assert.equal((await appel("/klyra/v1/moteurs/claude/utilisation")).json.utilisation, null);

  comptes = (await appel("/klyra/v1/moteurs/claude/comptes")).json.comptes;
  assert.deepEqual(comptes.map((c) => c.connecte), [true, true]);
  const parti = (await appel("/klyra/v1/moteurs/claude/comptes/deconnexion", "POST", { id })).json.compte;
  assert.equal(parti.connecte, false);
  assert.equal((await appel("/klyra/v1/moteurs/claude/comptes")).json.comptes[0].connecte, true);
  assert.equal((await appel("/klyra/v1/moteurs/claude/comptes/deconnexion", "POST", { id: "../../.claude" })).status, 400);
});
