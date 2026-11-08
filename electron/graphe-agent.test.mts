import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executerGraphe, projetsDuLieu } from "./graphe-agent.ts";
import { executerCerveau, OUTILS_CERVEAU } from "./cerveau-outils.ts";
import { alleger, annuler, indexMemoires, MARQUEUR_ALLEGE, memoireAllegee, resumeEntretien } from "./graphe-entretien.ts";

const souvenir = (nom: string, type: string, corps: string, extra = "") => `---\nname: ${nom}\ndescription: ${nom} en une ligne\nmetadata:\n  type: ${type}\n${extra}---\n\n${corps}\n`;

/** Un poste jetable : HOME et CLAUDE_CONFIG_DIR pointent dessus le temps du test. */
function banc() {
  const home = mkdtempSync(path.join(os.tmpdir(), "graphe-agent-"));
  const avant = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
  const memoire = (agent: string) => { const d = path.join(home, ".claude", "agent-memory", agent); mkdirSync(d, { recursive: true }); return d; };
  const dev = memoire("dev"), redac = memoire("redac");
  writeFileSync(path.join(dev, "tests.md"), souvenir("Lancer les tests", "feedback", "Toujours pnpm test:smoke après le build. Voir [[Client Acme]]."));
  writeFileSync(path.join(dev, "acme.md"), souvenir("Client Acme", "project", "Acme veut une livraison le vendredi, contact : Jeanne."));
  writeFileSync(path.join(dev, "vieux.md"), souvenir("Ancienne convention", "reference", "Les branches commencent par feat/."));
  writeFileSync(path.join(redac, "ton.md"), souvenir("Ton éditorial", "user", "Phrases courtes, pas de jargon."));
  writeFileSync(path.join(redac, "secret.md"), souvenir("Carnet privé", "project", "Note personnelle de la rédactrice.", "  prive: oui\n"));
  const donnees = path.join(home, "donnees");
  mkdirSync(donnees, { recursive: true });
  return {
    home, dev, redac, donnees,
    fin: () => { for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(home, { recursive: true, force: true }); },
  };
}

test("sans argument : la liste de ses souvenirs, sans chemin, et le nombre chez les autres", () => {
  const b = banc();
  try {
    const r = executerGraphe(b.donnees, {}, "dev") as { agent: string; total: number; souvenirs: { nom: string; type: string }[]; autresAgents: Record<string, number> };
    assert.equal(r.agent, "dev");
    assert.equal(r.total, 3);
    assert.deepEqual(r.souvenirs.map((s) => s.nom).sort(), ["Ancienne convention", "Client Acme", "Lancer les tests"]);
    // Le souvenir privé de redac n'est pas compté pour dev.
    assert.deepEqual(r.autresAgents, { redac: 1 });
    assert.doesNotMatch(JSON.stringify(r), new RegExp(b.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { b.fin(); }
});

test("un souvenir : son texte et ses voisins ; le privé d'un autre reste introuvable", () => {
  const b = banc();
  try {
    const r = executerGraphe(b.donnees, { souvenir: "lancer-les-tests" }, "dev") as { trouve: boolean; texte: string; voisins: { relation: string; nom?: string }[] };
    assert.equal(r.trouve, true);
    assert.match(r.texte, /pnpm test:smoke/);
    assert.ok(r.voisins.some((v) => v.relation === "Cite" && v.nom === "Client Acme"));
    const prive = executerGraphe(b.donnees, { souvenir: "Carnet privé" }, "dev") as { trouve: boolean };
    assert.equal(prive.trouve, false);
    const sien = executerGraphe(b.donnees, { souvenir: "Carnet privé" }, "redac") as { trouve: boolean };
    assert.equal(sien.trouve, true);
  } finally { b.fin(); }
});

test("une recherche trouve le contenu, jamais dans le privé d'un autre agent", () => {
  const b = banc();
  try {
    const r = executerGraphe(b.donnees, { requete: "jeanne" }, "redac") as { resultats: { nom: string; trouveDans: string }[] };
    assert.deepEqual(r.resultats.map((x) => [x.nom, x.trouveDans]), [["Client Acme", "contenu"]]);
    const p = executerGraphe(b.donnees, { requete: "personnelle" }, "dev") as { resultats: unknown[] };
    assert.equal(p.resultats.length, 0);
    const autre = executerGraphe(b.donnees, { agent: "redac" }, "dev") as { souvenirs: { nom: string }[] };
    assert.deepEqual(autre.souvenirs.map((s) => s.nom), ["Ton éditorial"]);
  } finally { b.fin(); }
});

test("la réponse tient dans le budget, et l'outil passe par les outils du second cerveau", () => {
  const b = banc();
  try {
    for (let i = 0; i < 80; i++) writeFileSync(path.join(b.dev, `n${i}.md`), souvenir(`Note numéro ${i} sur un sujet assez long pour peser`, "project", "x"));
    const r = executerGraphe(b.donnees, { budgetOctets: 1024 }, "dev") as { tronque: boolean; souvenirs: unknown[] };
    assert.equal(r.tronque, true);
    assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 1024);
    assert.ok(OUTILS_CERVEAU.some((o) => o.name === "memoire_graphe"));
    const viaMcp = executerCerveau(b.donnees, "memoire_graphe", { souvenir: "Client Acme" }, "dev", "chat-inconnu");
    assert.match(viaMcp.content[0].text, /livraison le vendredi/);
  } finally { b.fin(); }
});

test("projets du lieu : ceux du PC sans lieu, ceux de l'espace sur un serveur", () => {
  const b = banc();
  try {
    writeFileSync(path.join(b.donnees, "conversations.json"), JSON.stringify({ projects: [{ id: "p1", name: "Site", folder: "/x" }, { id: "p2", name: "VPS", folder: "/y", lieu: "srv" }] }));
    assert.deepEqual(projetsDuLieu(b.donnees, false), [{ id: "p1", nom: "Site", dossier: "/x" }]);
    mkdirSync(path.join(b.donnees, "espace", "projet"), { recursive: true });
    writeFileSync(path.join(b.donnees, "espace", "projet", "h.json"), JSON.stringify({ id: "p3", valeur: { id: "p3", name: "Serveur", folder: "/srv/p3" } }));
    assert.deepEqual(projetsDuLieu(b.donnees, true), [{ id: "p3", nom: "Serveur", dossier: "/srv/p3" }]);
  } finally { b.fin(); }
});

test("MEMORY.md allégé : garde préférences et retours, retire projet et référence, annulable", () => {
  const types = new Map<string, string | null>([["tests.md", "feedback"], ["acme.md", "project"], ["vieux.md", "reference"], ["sanstype.md", null]]);
  const avant = "# Mémoire de dev\n\n## Façon de travailler\n- [Tests](tests.md) — toujours le smoke\n\n## Projets\n- [Acme](acme.md) — vendredi\n- [Vieux](./vieux.md) — feat/\n\n## Divers\n- [Sans type](sanstype.md) — ?\n- [Absent](absent.md) — fichier disparu\nUne phrase libre.\n";
  const r = memoireAllegee(avant, types);
  assert.equal(r.retirees, 2);
  assert.equal(r.gardees, 2);
  assert.equal(r.texte, `# Mémoire de dev\n\n${MARQUEUR_ALLEGE}\n\n## Façon de travailler\n- [Tests](tests.md) — toujours le smoke\n\n## Divers\n- [Sans type](sanstype.md) — ?\n- [Absent](absent.md) — fichier disparu\nUne phrase libre.\n`);
  // Deux fois de suite : rien de plus.
  assert.equal(memoireAllegee(r.texte, types).texte, r.texte);

  const b = banc();
  try {
    const index = "- [Tests](tests.md)\n- [Acme](acme.md)\n- [Vieux](vieux.md)\n" + Array.from({ length: 12 }, (_, i) => `- [Note de projet numéro ${i}](n${i}.md) — ce qu'il faut savoir sur cette étape du chantier\n`).join("");
    for (let i = 0; i < 12; i++) writeFileSync(path.join(b.dev, `n${i}.md`), souvenir(`N${i}`, "project", "x"));
    writeFileSync(path.join(b.dev, "MEMORY.md"), index);
    const r0 = { donnees: b.donnees, home: b.home, configClaude: path.join(b.home, ".claude") };
    const m = indexMemoires(r0).find((x) => x.agent === "dev")!;
    assert.equal(m.retirees, 14);
    assert.ok(m.octetsApres < m.octets);
    assert.equal(m.utile, true);
    assert.throws(() => alleger(r0, b.donnees, { id: m.id, attendu: "2000-01-01T00:00:00.000Z" }), /a changé/);
    alleger(r0, b.donnees, { id: m.id, attendu: m.date });
    const ecrit = readFileSync(path.join(b.dev, "MEMORY.md"), "utf8");
    assert.match(ecrit, /memoire_graphe/);
    assert.match(ecrit, /\(tests\.md\)/);
    assert.doesNotMatch(ecrit, /\(acme\.md\)/);
    annuler(b.donnees, resumeEntretien(b.donnees).operations[0].id);
    assert.equal(readFileSync(path.join(b.dev, "MEMORY.md"), "utf8"), index);
  } finally { b.fin(); }
});
