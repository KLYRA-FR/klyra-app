import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fichierSous, PAGE_ISOLEE, POLITIQUE, PRIVILEGE_SCHEMA, relatifDemande, SCHEMA } from "./document-isole.ts";

test("la politique ne nomme ni l'app, ni Convex, ni le réseau", () => {
  assert.equal(PRIVILEGE_SCHEMA.scheme, SCHEMA);
  assert.equal(POLITIQUE.includes("connect-src 'self'"), true);
  assert.equal(POLITIQUE.includes("default-src 'none'"), true);
  assert.equal(POLITIQUE.includes("base-uri 'none'"), true);
  for (const interdit of ["http:", "https:", "app:", "file:", "convex", "claude.ai"]) {
    assert.equal(POLITIQUE.includes(interdit), false, interdit);
  }
});

test("une page HTML ou SVG s'ouvre isolée, pas un PDF", () => {
  assert.equal(PAGE_ISOLEE.test("page.html"), true);
  assert.equal(PAGE_ISOLEE.test("page.HTM"), true);
  assert.equal(PAGE_ISOLEE.test("dessin.svg"), true);
  assert.equal(PAGE_ISOLEE.test("note.pdf"), false);
  assert.equal(PAGE_ISOLEE.test("photo.png"), false);
});

test("le chemin demandé reste dans le document", () => {
  assert.equal(relatifDemande("/"), "index.html");
  assert.equal(relatifDemande("/index.html"), "index.html");
  assert.equal(relatifDemande("/css/site.css"), "css/site.css");
  assert.equal(relatifDemande("/a%20b.html"), "a b.html");
  for (const mauvais of ["../secret", "/../secret", "/css/../../etc/passwd", "/foo/%2e%2e/secret", "/foo/%2e%2e%2fsecret", "/%2e%2e/passwd", "/a\\b", "/\0", "/css//x"]) {
    assert.equal(relatifDemande(mauvais), null, mauvais);
  }
});

test("un fichier servi ne sort pas du dossier, lien inclus", () => {
  const racine = mkdtempSync(path.join(tmpdir(), "klyra-doc-"));
  mkdirSync(path.join(racine, "css"));
  writeFileSync(path.join(racine, "index.html"), "<p>ok</p>");
  writeFileSync(path.join(racine, "css", "site.css"), "body{}");
  const dehors = path.join(tmpdir(), `klyra-dehors-${process.pid}.txt`);
  writeFileSync(dehors, "secret");
  symlinkSync(dehors, path.join(racine, "fuite.txt"));

  assert.equal(fichierSous(racine, "index.html"), realpathSync(path.join(racine, "index.html")));
  assert.equal(fichierSous(racine, "css/site.css"), realpathSync(path.join(racine, "css", "site.css")));
  assert.equal(fichierSous(racine, "fuite.txt"), null);
  assert.equal(fichierSous(racine, "../secret"), null);
  assert.equal(fichierSous(racine, "/etc/passwd"), null);
  assert.equal(fichierSous(racine, "absent.html"), null);
});
