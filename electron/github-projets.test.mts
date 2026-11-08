import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { GithubProjets, validerBranche, validerNomDepot } from "./github-projets.ts";
import { creerGithubProjets } from "./github-stockage.ts";

test("les dépôts et branches refusent options, URL, traversées et caractères spéciaux", () => {
  for (const nom of ["../a", "a/..", "a/.", "https://github.com/a/b", "--a/b", "a/b/c", "a/b\n", "a/b?x=y"]) assert.throws(() => validerNomDepot(nom));
  for (const b of ["-main", "../main", "main.lock", "a//b", "main:a", "a\\b", "a..b", "a@{b", "/main", "main."]) assert.throws(() => validerBranche(b));
  assert.equal(validerNomDepot("Organisation/Repo.test"), "Organisation/Repo.test");
  assert.equal(validerBranche("feat/écran"), "feat/écran");
});

function bac() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-github-test-"));
  const home = path.join(tmp, "home"); mkdirSync(home);
  const gh = path.join(tmp, "gh");
  const fichierGh = path.join(tmp, "gh.cjs");
  writeFileSync(fichierGh, `
const a = process.argv.slice(2);
if (a[0] === '--version') console.log('gh version test');
else if (a[0] === 'auth' && a[1] === 'login') {
 require('node:fs').writeFileSync(${JSON.stringify(path.join(tmp, 'dernier-login'))}, process.env.GH_CONFIG_DIR);
 require('node:fs').writeFileSync(require('node:path').join(process.env.GH_CONFIG_DIR, 'sentinelle'), 'identifiant-fictif');
 process.stderr.write('First copy your one-time code: ABCD-1234\\n');
 setTimeout(() => process.exit(0), 500);
} else if (a[0] === 'auth' && a[1] === 'token') console.log('jeton-de-test');
else if (a.includes('/user')) console.log(JSON.stringify({login:'demo'}));
else if (a.some(x=>x.startsWith('/user/repos'))) console.log(JSON.stringify([[{full_name:'demo/site',private:true,default_branch:'main'}],[{full_name:'org/autre',private:false,default_branch:'dev'}]]));
else if (a.some(x=>x.includes('/branches'))) console.log(JSON.stringify([[{name:'main'}],[{name:'feat/test'}]]));
else process.exit(1);
`);
  // .cmd sous Windows ; script exécutable ailleurs. Uniquement des identifiants fictifs.
  const exe = process.platform === "win32" ? `${gh}.cmd` : gh;
  if (process.platform === "win32") writeFileSync(exe, `@"${process.execPath}" "${fichierGh}" %*\r\n`);
  else writeFileSync(exe, `#!${process.execPath}\nrequire(${JSON.stringify(fichierGh)});\n`, { mode: 0o700 });
  return { tmp, home, gh: exe, nettoyer: () => rmSync(tmp, { recursive: true, force: true }) };
}

test("pagination complète des dépôts privés et organisations, branches et état sans secret", { skip: process.platform === "win32" }, async () => {
  const b = bac();
  try {
    const g = new GithubProjets({ racine: path.join(b.tmp, "projets"), gh: b.gh, lire: async () => ({ jeton: "secret-fictif", compte: "demo" }), ecrire: async () => {} });
    assert.equal((await g.depots()).length, 2);
    assert.equal((await g.depots())[0].prive, true);
    assert.deepEqual(await g.branches("demo/site"), ["main", "feat/test"]);
    assert.equal(JSON.stringify(await g.etat()).includes("secret-fictif"), false);
    await assert.rejects(g.ouvrir("demo/site", "absente"), /n’existe plus/);
    const autre = new GithubProjets({ racine: path.join(b.tmp, "autre"), gh: b.gh, lire: async () => null, ecrire: async () => {} });
    await assert.rejects(autre.depots(), /Connecte GitHub/);
  } finally { b.nettoyer(); }
});

test("l'autorisation enregistre le compte, puis retire les identifiants temporaires ; l'annulation ne connecte rien", { skip: process.platform === "win32" }, async () => {
  const b = bac();
  let garde: { jeton: string; compte: string } | null = null;
  try {
    const g = new GithubProjets({ racine: path.join(b.tmp, "projets"), gh: b.gh, lire: async () => garde, ecrire: async (v) => { garde = v; } });
    await g.connecter();
    let vue = await g.etat();
    for (let i = 0; i < 50 && !vue.connexion; i++) { await new Promise(r => setTimeout(r, 20)); vue = await g.etat(); }
    assert.equal(vue.connexion?.code, "ABCD-1234");
    assert.equal(vue.connexion?.url, "https://github.com/login/device");
    for (let i = 0; i < 50 && (await g.etat()).enCours; i++) await new Promise(r => setTimeout(r, 30));
    assert.equal((await g.etat()).compte, "demo");
    assert.equal(existsSync(readFileSync(path.join(b.tmp, "dernier-login"), "utf8")), false);
    assert.equal(JSON.stringify(await g.etat()).includes("jeton-de-test"), false);
    await g.deconnecter();
    await g.connecter();
    await g.deconnecter();
    await new Promise(r => setTimeout(r, 600));
    assert.equal((await g.etat()).compte, null);
    assert.equal((await g.etat()).enCours, false);
  } finally { b.nettoyer(); }
});

test("clonage réel, branche choisie, réouverture sans écrasement et refus des chemins hors projet", { skip: process.platform === "win32" }, async () => {
  const b = bac();
  const homeAvant = process.env.HOME;
  process.env.HOME = b.home;
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...a], { cwd, stdio: "pipe" }).toString().trim();
  try {
    const nus = path.join(b.tmp, "nus"); mkdirSync(path.join(nus, "demo"), { recursive: true });
    const nu = path.join(nus, "demo", "site.git"); git(b.tmp, "init", "--bare", "--initial-branch=main", nu);
    const auteur = path.join(b.tmp, "auteur"); git(b.tmp, "clone", nu, auteur);
    writeFileSync(path.join(auteur, "README.md"), "un\n"); git(auteur, "add", "."); git(auteur, "commit", "-m", "un"); git(auteur, "push", "origin", "main");
    git(auteur, "branch", "feat/test"); git(auteur, "push", "origin", "feat/test");
    writeFileSync(path.join(b.home, ".gitconfig"), `[url "${pathToFileURL(nus).href}/"]\n insteadOf = https://github.com/\n`);
    const racine = path.join(b.tmp, "projets");
    const g = new GithubProjets({ racine, gh: b.gh, lire: async () => ({ jeton: "jeton-fictif", compte: "demo" }), ecrire: async () => {} });
    const r = await g.ouvrir("demo/site", "main");
    assert.equal(readFileSync(path.join(r.dossier, "README.md"), "utf8"), "un\n");
    assert.equal((await g.etatDepot(r.dossier)).branche, "main");
    assert.equal(readFileSync(path.join(r.dossier, ".git", "config"), "utf8").includes("jeton-fictif"), false);
    assert.equal((await g.ouvrir("demo/site", "main")).deja, true);
    const seconde = await g.ouvrir("demo/site", "feat/test");
    assert.notEqual(seconde.dossier, r.dossier);
    assert.equal((await g.etatDepot(seconde.dossier)).branche, "feat/test");
    writeFileSync(path.join(r.dossier, "README.md"), "modifié ici\n");
    writeFileSync(path.join(auteur, "README.md"), "deux\n"); git(auteur, "add", "."); git(auteur, "commit", "-m", "deux"); git(auteur, "push", "origin", "main");
    await assert.rejects(g.recuperer(r.dossier));
    assert.equal(readFileSync(path.join(r.dossier, "README.md"), "utf8"), "modifié ici\n");
    await assert.rejects(g.etatDepot(b.tmp), /n’est pas un dépôt/);
    const suffixe = createHash("sha256").update("main").digest("hex").slice(0, 12);
    mkdirSync(path.join(racine, "org")); symlinkSync(b.tmp, path.join(racine, "org", `autre-${suffixe}`));
    await assert.rejects(g.ouvrir("org/autre", "main"), /lien/);
    assert.equal(readdirSync(path.join(racine, "demo")).some(n => n.startsWith(".klyra-clone-")), false);
  } finally { if (homeAvant === undefined) delete process.env.HOME; else process.env.HOME = homeAvant; b.nettoyer(); }
});

test("le coffre indisponible refuse la connexion", async () => {
  const b = bac();
  try {
    const g = creerGithubProjets({ donnees: b.tmp, racine: b.home, gh: b.gh, chiffrer: () => { throw new Error("coffre indisponible"); }, dechiffrer: () => "" });
    await assert.rejects(g.connecter(), /coffre/);
  } finally { b.nettoyer(); }
});


test("la connexion est chiffrée, relue après redémarrage et supprimée à la déconnexion", { skip: process.platform === "win32" }, async () => {
  const b = bac();
  const cle = randomBytes(32);
  const options = {
    donnees: b.tmp, racine: b.home, gh: b.gh,
    chiffrer: (v: string) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", cle, iv); const corps = Buffer.concat([c.update(v), c.final()]); return [iv, c.getAuthTag(), corps].map(x => x.toString("base64")).join("."); },
    dechiffrer: (v: string) => { const [iv, tag, corps] = v.split(".").map(x => Buffer.from(x, "base64")); const d = createDecipheriv("aes-256-gcm", cle, iv); d.setAuthTag(tag); return Buffer.concat([d.update(corps), d.final()]).toString(); },
  };
  try {
    const g = creerGithubProjets(options);
    await g.connecter();
    for (let i=0; i<100 && (await g.etat()).enCours; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await g.etat()).compte, "demo");
    const disque = readFileSync(path.join(b.tmp, "github-projets.json"), "utf8");
    assert.equal(disque.includes("jeton-de-test"), false);
    assert.equal(disque.includes("demo"), false);
    const relu = creerGithubProjets(options);
    assert.equal((await relu.etat()).compte, "demo");
    await relu.deconnecter();
    assert.equal((await relu.etat()).compte, null);
  } finally { b.nettoyer(); }
});
