import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clonerDepot, clonerVers, etatGit, lireDepotGithub, messageClone, recupererDepot } from "./git.ts";

/** Un dépôt nu local (le « GitHub » du test) avec un premier commit sur main, et un dossier de travail. */
function bac() {
  const racine = mkdtempSync(path.join(os.tmpdir(), "klyra-git-"));
  const g = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@klyra.local", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "pipe" }).toString();
  const nu = path.join(racine, "distant.git");
  g(racine, "init", "--bare", nu);
  const auteur = path.join(racine, "auteur");
  g(racine, "clone", nu, auteur);
  writeFileSync(path.join(auteur, "README.md"), "un\n");
  g(auteur, "add", "-A");
  g(auteur, "commit", "-m", "premier");
  g(auteur, "push", "-u", "origin", "HEAD:main");
  return { racine, nu, auteur, g, fin: () => rmSync(racine, { recursive: true, force: true }) };
}

test("lireDepotGithub : les écritures courantes d'un dépôt", () => {
  const https = { proprietaire: "KLYRA-FR", nom: "klyra-app", url: "https://github.com/KLYRA-FR/klyra-app.git" };
  assert.deepEqual(lireDepotGithub("KLYRA-FR/klyra-app"), https);
  assert.deepEqual(lireDepotGithub("  github.com/KLYRA-FR/klyra-app "), https);
  assert.deepEqual(lireDepotGithub("https://github.com/KLYRA-FR/klyra-app.git"), https);
  assert.deepEqual(lireDepotGithub("https://github.com/KLYRA-FR/klyra-app/tree/main/src"), https);
  assert.deepEqual(lireDepotGithub("https://www.github.com/KLYRA-FR/klyra-app"), https);
  assert.deepEqual(lireDepotGithub("git@github.com:KLYRA-FR/klyra-app.git"), { ...https, url: "git@github.com:KLYRA-FR/klyra-app.git" });
  assert.equal(lireDepotGithub("a/b.c_d-e")?.nom, "b.c_d-e");
});

test("lireDepotGithub : refuse un autre hôte, un identifiant dans l'adresse ou un chemin piégé", () => {
  for (const saisie of [
    "",
    "klyra-app",
    "https://gitlab.com/a/b",
    "https://github.com.evil.com/a/b",
    "https://jeton@github.com/a/b",
    "https://user:mdp@github.com/a/b",
    "https://github.com:8443/a/b",
    "https://github.com/a",
    "a/..",
    "a/.",
    "-a/b",
    "a/b c",
    "a/b/c",
    "git@github.com:a/b/c.git",
    "file:///tmp/a/b",
    "--upload-pack=x/b",
  ]) {
    assert.equal(lireDepotGithub(saisie), null, saisie);
  }
});

test("messageClone : une phrase claire pour un accès refusé ou git absent", () => {
  assert.match(messageClone("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found"), /privé ou n’existe pas/);
  assert.match(messageClone("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), /privé/);
  assert.match(messageClone("", true), /Git n’est pas installé/);
  assert.match(messageClone("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com"), /ne répond pas/);
});

test("clonerVers puis recupererDepot : le clone suit le distant, récupère ses nouveautés, refuse d'écraser", async () => {
  const b = bac();
  try {
    const cible = path.join(b.racine, "projets", "mon-depot");
    const clone = await clonerVers(b.nu, cible);
    assert.equal(clone.ok, true, clone.sortie);
    assert.equal(readFileSync(path.join(cible, "README.md"), "utf8"), "un\n");
    const etat = await etatGit(cible);
    assert.equal(etat.branche, "main");
    assert.equal(etat.suivie, true);
    assert.equal(etat.enRetard, 0);

    assert.equal((await recupererDepot(cible)).message, "Déjà à jour.");

    writeFileSync(path.join(b.auteur, "README.md"), "deux\n");
    b.g(b.auteur, "commit", "-am", "second");
    b.g(b.auteur, "push");
    const r = await recupererDepot(cible);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.message, "Nouveautés récupérées.");
    assert.equal(readFileSync(path.join(cible, "README.md"), "utf8"), "deux\n");

    // Un changement local sur le même fichier : rien n'est écrasé.
    writeFileSync(path.join(b.auteur, "README.md"), "trois\n");
    b.g(b.auteur, "commit", "-am", "troisième");
    b.g(b.auteur, "push");
    writeFileSync(path.join(cible, "README.md"), "à moi\n");
    const refus = await recupererDepot(cible);
    assert.equal(refus.ok, false);
    assert.match(refus.message, /seraient écrasés/);
    assert.equal(readFileSync(path.join(cible, "README.md"), "utf8"), "à moi\n");
  } finally {
    b.fin();
  }
});

test("recupererDepot : un dossier sans distant n'est pas une erreur muette", async () => {
  const racine = mkdtempSync(path.join(os.tmpdir(), "klyra-git-seul-"));
  try {
    execFileSync("git", ["init", racine], { stdio: "pipe" });
    const r = await recupererDepot(racine);
    assert.equal(r.ok, false);
    assert.match(r.message, /pas relié à un dépôt distant/);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("clonerDepot : reprend un dossier qui est déjà ce dépôt, ne touche jamais à un autre dossier", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "klyra-git-parent-"));
  try {
    const deja = path.join(parent, "klyra-app");
    execFileSync("git", ["init", deja], { stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:klyra-fr/Klyra-App.git"], { cwd: deja, stdio: "pipe" });
    assert.deepEqual(await clonerDepot("https://github.com/KLYRA-FR/klyra-app", parent), { dossier: deja, depot: "KLYRA-FR/klyra-app", deja: true });

    const autre = path.join(parent, "site");
    mkdirSync(autre);
    writeFileSync(path.join(autre, "index.html"), "à garder");
    await assert.rejects(clonerDepot("KLYRA-FR/site", parent), /existe déjà et n’est pas ce dépôt/);
    assert.equal(readFileSync(path.join(autre, "index.html"), "utf8"), "à garder");

    // Un sous-dossier d'un autre dépôt n'est pas ce dépôt, même si l'origine du parent correspond.
    const dedans = path.join(deja, "klyra-app");
    mkdirSync(path.join(deja, "x"));
    mkdirSync(dedans);
    writeFileSync(path.join(dedans, "a.txt"), "a");
    await assert.rejects(clonerDepot("KLYRA-FR/klyra-app", deja), /existe déjà/);

    await assert.rejects(clonerDepot("pas une adresse", parent), /non reconnue/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
