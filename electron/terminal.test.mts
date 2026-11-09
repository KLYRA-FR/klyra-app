import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { commandePty, creerTerminaux, lignePty, masquerSecrets, nettoyerAnsi } from "./terminal.ts";

const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-terminal-"));
const moi = { conversation: "conv-a", agent: "camille" };
const PTY = process.platform === "linux" || process.platform === "darwin";

test("nettoyerAnsi retire couleurs, curseur et lignes réécrites", () => {
  assert.equal(nettoyerAnsi("\x1b[1;32mVert\x1b[0m\r\n"), "Vert\n");
  assert.equal(nettoyerAnsi("10%\r50%\r100%\n"), "100%\n");
  assert.equal(nettoyerAnsi("\x1b]0;titre\x07ok\x1b[2K\x1b[?25l"), "ok");
  assert.equal(nettoyerAnsi("abc\x08\x08d"), "ad");
});

test("masquerSecrets garde les positions", () => {
  assert.equal(masquerSecrets("clé=abcd1234 fin", ["abcd1234"]), "clé=•••••••• fin");
  assert.equal(masquerSecrets("x", ["abc"]), "x");
});

test("commandePty : script sur Linux et Mac, rien sous Windows", () => {
  assert.deepEqual(commandePty("linux", "ls")?.args, ["-qfec", "ls", "/dev/null"]);
  assert.equal(commandePty("darwin", "ls")?.fichier, "script");
  assert.equal(commandePty("win32", "ls"), null);
  assert.match(lignePty("/bin/bash", "echo 'a'"), /exec '\/bin\/bash' -c 'echo '\\''a'\\'''/);
});

test("une commande qui attend une saisie, complétée par l'agent puis par un secret", { skip: !PTY }, async () => {
  const t = creerTerminaux({ dossierDefaut: () => dossier, secret: (v) => (v === "MOT_DE_PASSE" ? "s3cr3t-Valeur" : (() => { throw new Error("inconnu"); })()) });
  try {
    const ouvert = await t.executer("terminal_ouvrir", { commande: "tty; read -p 'Nom : ' n; echo \"Bonjour $n\"; read -s -p 'Secret : ' s; echo; echo \"recu=$s\"" }, moi);
    assert.ok(!ouvert.erreur, ouvert.texte);
    assert.match(ouvert.texte, /\/dev\/(pts\/|tty)/, "un vrai terminal");
    assert.match(ouvert.texte, /Nom :/);
    const id = /term-[0-9a-f]{12}/.exec(ouvert.texte)![0];
    assert.equal(t.lister("conv-a").length, 1);
    assert.equal(t.lister("conv-b").length, 0);

    // Une autre conversation ne voit pas ce terminal.
    assert.equal((await t.executer("terminal_lire", { id }, { conversation: "conv-b", agent: "x" })).erreur, true);

    await t.executer("terminal_envoyer", { id, texte: "Corentin", entree: true }, moi);
    const lu = await t.executer("terminal_lire", { id, attendre: 3 }, moi);
    assert.match(lu.texte, /Bonjour Corentin/);
    assert.match(lu.texte, /Secret :/);

    const envoi = await t.executer("terminal_envoyer", { id, secret: "MOT_DE_PASSE", entree: true }, moi);
    assert.doesNotMatch(envoi.texte, /s3cr3t/);
    const fin = await t.executer("terminal_lire", { id, attendre: 3 }, moi);
    assert.match(fin.texte, /recu=•{13}/, "le secret affiché est masqué");
    assert.doesNotMatch(fin.texte, /s3cr3t/);
    assert.match(fin.texte, /Terminé \(code 0\)/);
    // Le flux de l'écran est masqué aussi.
    assert.doesNotMatch(t.flux(id, 0)!.donnees, /s3cr3t/);
    assert.equal((await t.executer("terminal_envoyer", { id, secret: "AUTRE" }, moi)).erreur, true);
  } finally {
    t.fermerTout();
  }
});

test("la personne tape dans le panneau, le flux reprend à sa position", { skip: !PTY }, async () => {
  const t = creerTerminaux({ dossierDefaut: () => dossier, secret: () => "" });
  try {
    const { texte } = await t.executer("terminal_ouvrir", { commande: "read -p 'Code : ' c; echo \"code=$c\"; sleep 5" }, moi);
    const id = /term-[0-9a-f]{12}/.exec(texte)![0];
    const avant = t.flux(id, 0)!;
    assert.ok(t.saisir(id, "4242\r"));
    await new Promise((r) => setTimeout(r, 800));
    const apres = t.flux(id, avant.position)!;
    assert.equal(apres.reprise, false);
    assert.match(apres.donnees, /code=4242/);
    if (process.platform === "linux") assert.equal(t.taille(id, 90, 20), true);
  } finally {
    t.fermerTout();
  }
});

test("plafond de sessions et fermeture après inactivité", { skip: !PTY }, async () => {
  let horloge = 1_000;
  const t = creerTerminaux({ dossierDefaut: () => dossier, secret: () => "", sessionsMax: 2, inactiviteMs: 10_000, maintenant: () => horloge });
  try {
    await t.executer("terminal_ouvrir", { commande: "sleep 30" }, moi);
    await t.executer("terminal_ouvrir", {}, moi);
    const trop = await t.executer("terminal_ouvrir", { commande: "true" }, moi);
    assert.equal(trop.erreur, true);
    assert.match(trop.texte, /Déjà 2 terminaux/);
    horloge += 20_000;
    t.nettoyer();
    assert.equal(t.lister("conv-a").length, 0);
    assert.equal((await t.executer("terminal_ouvrir", { dossier: "/nexiste/pas" }, moi)).erreur, true);
  } finally {
    t.fermerTout();
  }
});
