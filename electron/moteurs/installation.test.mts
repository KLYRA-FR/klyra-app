import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { binaireGere, comparerVersions, dossierMoteurs, estGere, installerDepuisNpm, versionsGerees } from "./installation.ts";

/* Un faux registre npm, et un dossier personnel jetable : rien ne sort de la machine. */
const TMP = mkdtempSync(path.join(os.tmpdir(), "klyra-installation-"));
process.env.HOME = path.join(TMP, "home");
mkdirSync(process.env.HOME);
const PLATEFORME = `${process.platform}-${process.arch}`;
const EXE = process.platform === "win32" ? "codex.exe" : "codex";

/** Un paquet de plateforme comme celui de Codex : package/vendor/<cible>/bin/codex. */
function paquet(contenu: string): Buffer {
  const dossier = mkdtempSync(path.join(TMP, "paquet-"));
  const bin = path.join(dossier, "package", "vendor", "cible-essai", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, EXE), contenu);
  writeFileSync(path.join(dossier, "package", "package.json"), "{}");
  const archive = path.join(dossier, "paquet.tgz");
  assert.equal(spawnSync("tar", ["-czf", archive, "-C", dossier, "package"]).status, 0);
  return readFileSync(archive);
}
const empreinte = (b: Buffer) => `sha512-${createHash("sha512").update(b).digest("base64")}`;

/** Un paquet de plateforme comme celui de Grok Build : package/bin/grok.br, compressé en brotli. */
const EXE_GROK = process.platform === "win32" ? "grok.exe" : "grok";
function paquetGrok(contenu: string): Buffer {
  const dossier = mkdtempSync(path.join(TMP, "paquet-grok-"));
  const bin = path.join(dossier, "package", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, `${EXE_GROK}.br`), brotliCompressSync(Buffer.from(contenu)));
  writeFileSync(path.join(dossier, "package", "package.json"), "{}");
  const sortie = path.join(dossier, "paquet.tgz");
  assert.equal(spawnSync("tar", ["-czf", sortie, "-C", dossier, "package"]).status, 0);
  return readFileSync(sortie);
}
const archiveGrok = paquetGrok("#!/bin/sh\necho grok-essai\n");
const EXE_CLAUDE = process.platform === "win32" ? "claude.exe" : "claude";
const dossierClaude = mkdtempSync(path.join(TMP, "paquet-claude-"));
mkdirSync(path.join(dossierClaude, "package"));
writeFileSync(path.join(dossierClaude, "package", EXE_CLAUDE), "programme-claude-factice");
const fichierClaude = path.join(dossierClaude, "claude.tgz");
assert.equal(spawnSync("tar", ["-czf", fichierClaude, "-C", dossierClaude, "package"]).status, 0);
const archiveClaude = readFileSync(fichierClaude);

let archive = paquet("#!/bin/sh\necho codex-essai\n");
let integrite = empreinte(archive);
let serveur: http.Server;

before(async () => {
  serveur = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    const json = (v: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(v));
    if (req.url === "/@anthropic-ai%2Fclaude-code/latest") return json({ version: "2.0.0" });
    if (req.url === "/@anthropic-ai%2Fclaude-code/2.0.0") return json({ version: "2.0.0", optionalDependencies: { [`@anthropic-ai/claude-code-${PLATEFORME}`]: "2.0.0" } });
    if (req.url === `/@anthropic-ai%2Fclaude-code-${PLATEFORME}/2.0.0`) return json({ dist: { tarball: `${base}/claude.tgz`, integrity: empreinte(archiveClaude) } });
    if (req.url === "/claude.tgz") return res.writeHead(200, { "content-length": archiveClaude.length }).end(archiveClaude);
    const [, version] = /^\/@openai%2Fcodex\/(.+)$/.exec(req.url ?? "") ?? [];
    if (version === "latest") return json({ version: "9.9.9" });
    if (version === "9.9.9" || version === "9.9.8") return json({ version, optionalDependencies: { [`@openai/codex-${PLATEFORME}`]: `npm:@openai/codex@${version}-${PLATEFORME}` } });
    if (version?.endsWith(PLATEFORME)) return json({ dist: { tarball: `${base}/archive.tgz`, integrity: integrite } });
    if (req.url === "/archive.tgz") return res.writeHead(200, { "content-length": archive.length }).end(archive);
    /* Grok Build : la dépendance de plateforme porte la version seule (« 1.0.70 »), sans alias npm:. */
    if (req.url === "/@xai-official%2Fgrok/latest") return json({ version: "1.0.70" });
    if (req.url === "/@xai-official%2Fgrok/1.0.70") return json({ version: "1.0.70", optionalDependencies: { [`@xai-official/grok-${PLATEFORME}`]: "1.0.70" } });
    if (req.url === `/@xai-official%2Fgrok-${PLATEFORME}/1.0.70`) return json({ dist: { tarball: `${base}/grok.tgz`, integrity: empreinte(archiveGrok) } });
    if (req.url === "/grok.tgz") return res.writeHead(200, { "content-length": archiveGrok.length }).end(archiveGrok);
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", () => r()));
  process.env.KLYRA_REGISTRE_NPM = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});

after(() => {
  serveur.close();
  rmSync(TMP, { recursive: true, force: true });
});

test("les versions se comparent nombre par nombre", () => {
  assert.ok(comparerVersions("0.164.0", "0.99.0") > 0);
  assert.ok(comparerVersions("2.1.311", "2.1.316") < 0);
  assert.equal(comparerVersions("1.0.70", "1.0.70"), 0);
});

test("installe la dernière version : empreinte vérifiée, rangée par version, prête à lancer", async () => {
  const etapes = new Set<string>();
  const chemin = await installerDepuisNpm({ moteur: "codex", paquet: "@openai/codex", executable: EXE, progression: (p) => etapes.add(p.etape) });
  assert.equal(chemin, path.join(dossierMoteurs(), "codex", "9.9.9", "bin", EXE));
  assert.equal(readFileSync(chemin, "utf8"), "#!/bin/sh\necho codex-essai\n");
  if (process.platform !== "win32") assert.ok(statSync(chemin).mode & 0o100, "pas exécutable");
  assert.deepEqual([...etapes], ["telechargement", "verification", "installation"]);
  assert.equal(JSON.parse(readFileSync(path.join(dossierMoteurs(), "codex", "9.9.9", "klyra-installation.json"), "utf8")).integrite, integrite);
  assert.deepEqual(readdirSync(dossierMoteurs()).filter((d) => d.startsWith(".installation-")), [], "dossier de travail laissé");
  assert.equal(binaireGere("codex", EXE), chemin);
  assert.ok(estGere(chemin));
  assert.ok(!estGere("/usr/local/bin/codex"));
});

test("Grok Build : paquet de plateforme sans alias, programme compressé en brotli", async () => {
  const chemin = await installerDepuisNpm({ moteur: "grok", paquet: "@xai-official/grok", executable: EXE_GROK });
  assert.equal(chemin, path.join(dossierMoteurs(), "grok", "1.0.70", "bin", EXE_GROK));
  assert.equal(readFileSync(chemin, "utf8"), "#!/bin/sh\necho grok-essai\n");
  if (process.platform !== "win32") assert.ok(statSync(chemin).mode & 0o100, "pas exécutable");
  assert.equal(binaireGere("grok", EXE_GROK), chemin);
});

test("Claude Code : binaire natif à la racine du paquet, sans écrire dans l’installation du poste", async () => {
  const chemin = await installerDepuisNpm({ moteur: "claude", paquet: "@anthropic-ai/claude-code", executable: EXE_CLAUDE });
  assert.equal(readFileSync(chemin, "utf8"), "programme-claude-factice");
  assert.equal(chemin, binaireGere("claude", EXE_CLAUDE));
  assert.ok(estGere(chemin));
});

test("une nouvelle version remplace l'ancienne de l'app", async () => {
  mkdirSync(path.join(dossierMoteurs(), "codex", "9.9.8", "bin"), { recursive: true });
  await installerDepuisNpm({ moteur: "codex", paquet: "@openai/codex", executable: EXE });
  assert.deepEqual(versionsGerees("codex"), ["9.9.9"]);
});

test("une empreinte qui ne correspond pas : rien n'est installé", async () => {
  rmSync(path.join(dossierMoteurs(), "codex"), { recursive: true, force: true });
  archive = paquet("#!/bin/sh\necho falsifie\n");
  integrite = empreinte(paquet("autre contenu"));
  await assert.rejects(installerDepuisNpm({ moteur: "codex", paquet: "@openai/codex", executable: EXE }), /empreinte/i);
  assert.equal(existsSync(path.join(dossierMoteurs(), "codex", "9.9.9")), false);
  assert.equal(binaireGere("codex", EXE), null);
});
