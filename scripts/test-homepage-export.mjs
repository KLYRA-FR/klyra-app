import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// À lancer après pnpm site:build. Aucun navigateur, compte ou service distant.
const depot = path.resolve(import.meta.dirname, "..");
const sortie = path.join(depot, "site/out");
const lire = (fichier) => readFileSync(path.join(sortie, fichier), "utf8");
const accueil = lire("index.html");

test("l’accueil exporté reste lisible sans initialisation et garde les accès", () => {
  assert.match(accueil, /Confie le travail à/);
  assert.match(accueil, /id="fonctionnalites"/);
  assert.match(accueil, /href="\/changelog\/"/);
  assert.match(accueil, /mailto:contact@klyra\.fr/);
  assert.match(accueil, /klyra-app-versions\/releases\/latest/);
  assert.doesNotMatch(accueil, /<form\b|Maquette : rien n'est envoyé/);
  assert.doesNotMatch(accueil, /DIGITAL-OS|OpenBot\/Agents|100\.120\.107/);
  assert.match(lire("changelog/index.html"), /<title>/);
});

test("les ressources et destinations locales des deux pages existent après export", () => {
  for (const page of ["index.html", "changelog/index.html"]) {
    for (const correspondance of lire(page).matchAll(/(?:src|href)="([^"]+)"/g)) {
      const lien = correspondance[1];
      if (!lien.startsWith("/") || lien.startsWith("//")) continue;
      const fichier = path.join(sortie, decodeURIComponent(lien.split(/[?#]/)[0]));
      assert.ok(existsSync(fichier), lien);
      if (statSync(fichier).isDirectory()) assert.ok(existsSync(path.join(fichier, "index.html")), lien);
    }
  }
  const verifier = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const fichier = path.join(dossier, entree.name);
      if (entree.isDirectory()) verifier(fichier);
      else assert.ok(existsSync(path.join(sortie, path.relative(path.join(depot, "site/public"), fichier))), fichier);
    }
  };
  verifier(path.join(depot, "site/public/homepage"));
});

test("l’archive est intacte et n’est pas publiée dans l’export", () => {
  const liste = readFileSync(path.join(depot, "archives/homepage-2026-11-06/SHA256SUMS"), "utf8");
  for (const ligne of liste.trim().split("\n")) {
    const [empreinte, fichier] = ligne.split(/\s+/);
    const reel = createHash("sha256").update(readFileSync(path.join(depot, fichier))).digest("hex");
    assert.equal(reel, empreinte, fichier);
  }
  assert.equal(existsSync(path.join(sortie, "archives")), false);
});
