import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { adresseRetour, alertesNouvelles, cleAlerte, commandeLogin, creerReconnexions, creerVeilleMcp, etatGarde, lienAutorisation, lireListeMcp, sansAdresse, type DossierAgent } from "./mcp-sante.ts";
import { creerTerminaux } from "./terminal.ts";

const PTY = process.platform === "linux" || process.platform === "darwin";
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executer = promisify(execFile);

/** Sorties relevées le 09/11/2026 avec Claude Code 2.1.319. */
const SORTIE = [
  "Checking MCP server health…",
  "",
  "qonto-mcp: https://mcp.qonto.com/multi-organization/mcp (HTTP) - \x1b[32m✔\x1b[39m Connected",
  "faux: http://127.0.0.1:39709/mcp (HTTP) - ! Needs authentication",
  "local: npx outil --cle=SECRET123 - ✗ Failed to connect",
  "plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ✔ Connected",
  "projet: node serveur.js - ⏸ Pending approval",
].join("\n");

test("lireListeMcp : nom, état, distant ; jamais la cible", () => {
  const l = lireListeMcp(SORTIE);
  assert.deepEqual(l, [
    { nom: "qonto-mcp", etat: "connecte", distant: true },
    { nom: "faux", etat: "authentification", distant: true },
    { nom: "local", etat: "echec", distant: false },
    { nom: "plugin:vercel:vercel", etat: "connecte", distant: true },
    { nom: "projet", etat: "attente", distant: false },
  ]);
  assert.ok(!JSON.stringify(l).includes("SECRET123"));
  assert.deepEqual(lireListeMcp("No MCP servers configured. Use `claude mcp add` to add a server."), []);
});

test("la veille date chaque état et ne signale qu'un changement", async () => {
  let t = 1_000;
  let sortie = "qonto-mcp: https://x (HTTP) - ✔ Connected";
  let garde: unknown = null;
  const changements: unknown[] = [];
  const agents: DossierAgent[] = [{ agent: "camille", dossier: "/d/camille", cwd: "/a" }];
  const veille = creerVeilleMcp({ agents: () => agents, lister: async () => sortie, maintenant: () => t, ecrire: (e) => (garde = JSON.parse(JSON.stringify(e))) });
  veille.surChangement((c) => changements.push(...c));

  await veille.verifier({ forcer: true });
  assert.equal(changements.length, 1, "première vue");
  t = 2_000;
  await veille.verifier({ forcer: true });
  assert.equal(changements.length, 1, "même état : rien");

  t = 3_000;
  sortie = "qonto-mcp: https://x (HTTP) - ! Needs authentication";
  await veille.verifier({ forcer: true });
  assert.deepEqual(changements.at(-1), { agent: "camille", mcp: "qonto-mcp", avant: "connecte", apres: "authentification", depuis: 3_000 });
  t = 9_000;
  const e = await veille.verifier({ forcer: true });
  assert.equal(changements.length, 2, "toujours en défaut : pas de deuxième alerte");
  assert.equal(e.entrees[0].depuis, 3_000, "depuis la première fois");

  // Relancé : l'état gardé reprend, sans nouveau changement.
  const reprise = creerVeilleMcp({ agents: () => agents, lister: async () => sortie, maintenant: () => 10_000, lire: () => garde });
  const vus: unknown[] = [];
  reprise.surChangement((c) => vus.push(...c));
  const r = await reprise.verifier({ forcer: true });
  assert.equal(vus.length, 0);
  assert.equal(r.entrees[0].depuis, 3_000);
});

test("une vérification ratée garde l'état d'avant et dit pourquoi, sans adresse", async () => {
  let rate = false;
  const veille = creerVeilleMcp({
    agents: () => [{ agent: "camille", dossier: "/d", cwd: "/a" }],
    lister: async () => {
      if (rate) throw new Error("délai dépassé vers https://mcp.qonto.com/?token=abc");
      return "q: https://x (HTTP) - ✔ Connected";
    },
  });
  await veille.verifier({ forcer: true });
  rate = true;
  const e = await veille.verifier({ forcer: true });
  assert.equal(e.entrees[0].etat, "connecte");
  assert.equal(e.erreurs[0].agent, "camille");
  assert.ok(!e.erreurs[0].message.includes("token"), e.erreurs[0].message);
});

test("une demande tout juste vérifiée n'en relance pas une", async () => {
  let appels = 0;
  let t = 0;
  const veille = creerVeilleMcp({ agents: () => [{ agent: "dev", dossier: "/d", cwd: "/a" }], lister: async () => (appels++, ""), maintenant: () => t });
  await veille.verifier();
  t = 60_000;
  await veille.verifier();
  assert.equal(appels, 1);
  await veille.verifier({ forcer: true });
  assert.equal(appels, 2);
});

test("alertes : une par défaut et par date ; un retour en défaut alerte de nouveau", () => {
  const e = [
    { agent: "camille", mcp: "qonto-mcp", etat: "authentification" as const, distant: true, depuis: 5 },
    { agent: "dev", mcp: "x", etat: "connecte" as const, distant: true, depuis: 1 },
  ];
  const a = alertesNouvelles("https://vps", e, new Set());
  assert.equal(a.nouvelles.length, 1);
  assert.deepEqual(a.cles, [cleAlerte("https://vps", e[0])]);
  assert.equal(alertesNouvelles("https://vps", e, new Set(a.cles)).nouvelles.length, 0);
  assert.equal(alertesNouvelles("https://vps", [{ ...e[0], depuis: 99 }], new Set(a.cles)).nouvelles.length, 1);
});

test("adresses : lien d'autorisation, adresse de retour, erreurs sans adresse", () => {
  const sortie = "Visit this URL to authorize:\r\n  https://auth.qonto.com/authorize?client_id=a&state=b\r\n\r\nOr paste the redirect URL here: ";
  assert.equal(lienAutorisation(sortie), "https://auth.qonto.com/authorize?client_id=a&state=b");
  assert.equal(lienAutorisation("Visit this URL to authorize:\n javascript:alert(1)"), null);
  assert.equal(adresseRetour("  http://localhost:52768/callback?code=abc&state=x \n"), "http://localhost:52768/callback?code=abc&state=x");
  assert.equal(adresseRetour("http://localhost:52768/callback?code=a\r\nrm -rf /"), null, "une seule ligne");
  assert.equal(adresseRetour("https://evil.test/callback?code=a"), null);
  assert.equal(adresseRetour("http://localhost:1/callback"), null, "sans code");
  assert.equal(sansAdresse("Erreur sur http://localhost:1/cb?code=SECRET"), "Erreur sur [adresse]");
  assert.equal(commandeLogin("/bin/claude", "/d/l'agent", "qonto"), "CLAUDE_CONFIG_DIR='/d/l'\\''agent' exec '/bin/claude' mcp login 'qonto' --no-browser");
  assert.deepEqual(etatGarde({ entrees: [{ agent: "../x", mcp: "q", etat: "connecte", depuis: 1 }, { agent: "a", mcp: "q", etat: "pirate", depuis: 1 }] }).entrees, []);
});

/** Un faux `claude` exécutable (scripts/faux-claude-mcp.mjs) et un dossier d'agent. */
function fauxPoste() {
  const base = mkdtempSync(path.join(os.tmpdir(), "klyra-mcp-sante-"));
  const claude = path.join(base, "claude");
  writeFileSync(claude, `#!/bin/sh\nexec '${process.execPath}' '${path.join(racine, "scripts", "faux-claude-mcp.mjs")}' "$@"\n`);
  chmodSync(claude, 0o755);
  const dossier = path.join(base, "preparation", "camille");
  mkdirSync(dossier, { recursive: true });
  writeFileSync(path.join(dossier, "faux-mcp.json"), JSON.stringify({ "qonto-mcp": "auth", outil: "stdio" }));
  const agents: DossierAgent[] = [{ agent: "camille", dossier, cwd: base }];
  const lister = async (d: DossierAgent) => (await executer(claude, ["mcp", "list"], { cwd: d.cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: d.dossier }, timeout: 30_000 })).stdout;
  return { base, claude, dossier, agents, lister };
}

test("Needs authentication → alerte → Reconnecter → Connected, sans que l'adresse de retour reste visible", { skip: !PTY }, async () => {
  const p = fauxPoste();
  const terminaux = creerTerminaux({ dossierDefaut: () => p.base, secret: () => "" });
  const veille = creerVeilleMcp({ agents: () => p.agents, lister: p.lister });
  const alertes: string[] = [];
  veille.surChangement((c) => c.forEach((x) => x.apres === "authentification" && alertes.push(`${x.agent}/${x.mcp}`)));
  const reco = creerReconnexions({ terminaux, veille, agents: () => p.agents, claude: () => p.claude });
  try {
    const e = await veille.verifier({ forcer: true });
    assert.deepEqual(alertes, ["camille/qonto-mcp"]);
    assert.ok(!JSON.stringify(e).includes("NE_PAS_GARDER"), "la cible n'est pas gardée");

    await assert.rejects(reco.demarrer("camille", "outil"), /tourne sur la machine/);
    const v = await reco.demarrer("camille", "qonto-mcp");
    assert.equal(v.etat, "attente", v.message);
    assert.match(v.lien ?? "", /^https:\/\/auth\.exemple\.test\/authorize\?/);

    await assert.rejects(reco.retour(v.id, "https://ailleurs.test/?code=x"), /adresse de retour/);
    const adresse = "http://localhost:52768/callback?code=CODE-UNIQUE-42&state=etat-123";
    const fin = await reco.retour(v.id, adresse);
    assert.equal(fin.etat, "connecte", fin.message);
    assert.equal(readFileSync(path.join(p.dossier, "recu.txt"), "utf8"), adresse, "l'adresse est arrivée entière au login");
    assert.equal(veille.etat().entrees.find((x) => x.mcp === "qonto-mcp")?.etat, "connecte");
    assert.ok(!JSON.stringify(fin).includes("CODE-UNIQUE-42"));
    assert.equal(terminaux.lister("klyra-veille-mcp").length, 0, "le terminal du login est fermé");
  } finally {
    reco.fermerTout();
    terminaux.fermerTout();
  }
});

test("le code est masqué dans la sortie du PTY tant que le login tourne", { skip: !PTY }, async () => {
  const p = fauxPoste();
  writeFileSync(path.join(p.dossier, "faux-mcp.json"), JSON.stringify({ "qonto-mcp": "auth" }));
  const terminaux = creerTerminaux({ dossierDefaut: () => p.base, secret: () => "" });
  try {
    const s = terminaux.ouvrir({ conversation: "klyra-veille-mcp", agent: "camille" }, { commande: commandeLogin(p.claude, p.dossier, "qonto-mcp"), dossier: p.base });
    const attendre = async (ok: () => boolean) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
    };
    await attendre(() => /paste the redirect/i.test(terminaux.flux(s.id, 0)?.donnees ?? ""));
    const adresse = "http://localhost:52768/callback?code=FAUX-CODE-99&state=etat-123";
    assert.ok(terminaux.saisir(s.id, adresse, { secret: true }));
    assert.ok(terminaux.saisir(s.id, "\r"));
    await attendre(() => terminaux.flux(s.id, 0)?.fini === true);
    const sortie = terminaux.flux(s.id, 0)?.donnees ?? "";
    assert.match(sortie, /Reçu : •+/, "répété par la commande, masqué");
    assert.ok(!sortie.includes("FAUX-CODE-99"), "jamais en clair dans la sortie");
  } finally {
    terminaux.fermerTout();
  }
});

/**
 * Avec le vrai Claude Code (`KLYRA_CLAUDE_PATH`, ou ~/.local/bin/claude) face à un faux serveur MCP protégé par
 * OAuth (scripts/faux-mcp-oauth.mjs) : le test joue le navigateur (il suit le lien et récupère l'adresse de retour).
 */
const VRAI_CLAUDE = process.env.KLYRA_CLAUDE_PATH ?? path.join(os.homedir(), ".local", "bin", "claude");
test("vrai Claude Code : Needs authentication → Reconnecter → Connected", { skip: !PTY || !existsSync(VRAI_CLAUDE) || process.env.KLYRA_SANS_VRAI_CLAUDE === "1" }, async () => {
  const { demarrerFauxMcpOAuth } = await import("../scripts/faux-mcp-oauth.mjs");
  const faux = await demarrerFauxMcpOAuth();
  const base = mkdtempSync(path.join(os.tmpdir(), "klyra-mcp-vrai-"));
  const dossier = path.join(base, "preparation", "camille");
  mkdirSync(dossier, { recursive: true });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dossier };
  const agents: DossierAgent[] = [{ agent: "camille", dossier, cwd: base }];
  const terminaux = creerTerminaux({ dossierDefaut: () => base, secret: () => "" });
  const veille = creerVeilleMcp({ agents: () => agents, lister: async (d) => (await executer(VRAI_CLAUDE, ["mcp", "list"], { cwd: d.cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: d.dossier }, timeout: 60_000 })).stdout });
  const reco = creerReconnexions({ terminaux, veille, agents: () => agents, claude: () => VRAI_CLAUDE });
  try {
    await executer(VRAI_CLAUDE, ["mcp", "add", "--scope", "user", "--transport", "http", "faux-oauth", faux.url], { cwd: base, env });
    const avant = await veille.verifier({ forcer: true });
    assert.equal(avant.entrees.find((e) => e.mcp === "faux-oauth")?.etat, "authentification", JSON.stringify(avant));
    const v = await reco.demarrer("camille", "faux-oauth");
    assert.equal(v.etat, "attente", v.message);
    assert.ok(v.lien, "le lien d'autorisation");
    // Le navigateur : il suit le lien ; la page de retour (localhost) « ne s'ouvre pas », on récupère son adresse.
    const r = await fetch(v.lien!, { redirect: "manual" });
    const retour = r.headers.get("location");
    assert.ok(retour && /^http:\/\/localhost:\d+\/callback\?code=/.test(retour));
    const fin = await reco.retour(v.id, retour);
    assert.equal(fin.etat, "connecte", fin.message);
    // Jeton refusé (comme Qonto le 09/11) : la veille le voit à la vérification suivante.
    faux.revoquer();
    const apres = await veille.verifier({ forcer: true });
    assert.notEqual(apres.entrees.find((e) => e.mcp === "faux-oauth")?.etat, "connecte");
  } finally {
    reco.fermerTout();
    terminaux.fermerTout();
    await faux.fermer();
  }
});
