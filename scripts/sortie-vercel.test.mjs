import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { configVercel, pagesHtml, preparer } from "./sortie-vercel.mjs";

test("chaque page se sert sans extension, l'accueil et la 404 restent à leur place", () => {
  const config = configVercel(["404.html", "chats.html", "index.html", "reglages.html"]);
  assert.deepEqual(Object.keys(config.overrides), ["chats.html", "reglages.html"]);
  assert.equal(config.overrides["chats.html"].path, "chats");
  assert.equal(config.routes.at(-1).dest, "/404.html");
  assert.ok(config.routes.some((r) => r.src === "^/sw\\.js$" && r.headers["Cache-Control"] === "no-cache"));
});

test("l'export est copié tel quel, les pages de _next ne sont pas des pages", () => {
  const dossier = mkdtempSync(path.join(tmpdir(), "klyra-vercel-"));
  try {
    const out = path.join(dossier, "out");
    mkdirSync(path.join(out, "_next", "static"), { recursive: true });
    for (const f of ["index.html", "chats.html", "404.html", "sw.js", "_next/static/a.html"]) writeFileSync(path.join(out, f), f);
    assert.deepEqual(pagesHtml(out), ["404.html", "chats.html", "index.html"]);
    const sortie = path.join(dossier, "sortie");
    preparer(out, sortie);
    assert.equal(readFileSync(path.join(sortie, "static", "sw.js"), "utf8"), "sw.js");
    assert.equal(JSON.parse(readFileSync(path.join(sortie, "config.json"), "utf8")).overrides["chats.html"].path, "chats");
    assert.throws(() => preparer(path.join(dossier, "vide"), sortie), /Pas d'export/);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
