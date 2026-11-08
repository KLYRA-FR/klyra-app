import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Cerveau } from "./cerveau.ts";
import { actionSynchro, ETAT_VIDE, exporterNotes, synchroniser, type EtatLieu } from "./cerveau-synchro.ts";

const proprietaire = { proprietaire: true, agentId: null, projetId: null };
const nouveau = () => new Cerveau(new DatabaseSync(":memory:"));
/** Le serveur, vu du PC : ses actions, avec un aller-retour JSON comme sur le réseau. */
const serveur = (vps: Cerveau, avant?: (action: string) => void) => async (action: string, args: Record<string, unknown>) => {
  avant?.(action);
  return JSON.parse(JSON.stringify(actionSynchro(vps, action, JSON.parse(JSON.stringify(args)))));
};
function poste(vps: Cerveau) {
  const c = nouveau();
  let etat: EtatLieu = { ...ETAT_VIDE, actif: true };
  return {
    c,
    get etat() { return etat; },
    sync: async (avant?: (action: string) => void) => { etat = await synchroniser(c, serveur(vps, avant), etat, "VPS"); return etat; },
    ecrire: (titre: string, contenu: string, liens: string[] = [], id?: string) => c.garder({ id: id ?? "", titre, contenu, projetId: null, liens, source: null, creeLe: "", modifieLe: "" }).note,
    modifier: (id: string, contenu: string) => { const n = c.note(id, proprietaire); return c.garder({ ...n, contenu, liensAuto: [] }).note; },
    oublier: (id: string) => c.oublier(id, c.note(id, proprietaire).revision),
    titres: () => c.lister(proprietaire, { limite: 150 }).notes.map((n) => n.titre).sort(),
    contenu: (id: string) => c.note(id, proprietaire).contenu,
    existe: (id: string) => { try { c.note(id, proprietaire); return true; } catch { return false; } },
  };
}

test("une note écrite sur un PC arrive sur le serveur, puis sur un second PC ; ses liens suivent", async () => {
  const vps = nouveau(), pc1 = poste(vps), pc2 = poste(vps);
  const a = pc1.ecrire("Client Acme", "Livraison le vendredi.");
  const b = pc1.ecrire("Contact Acme", "Jeanne, au service achats.", [a.id]);
  const e = await pc1.sync();
  assert.deepEqual([e.dernier?.envoyees, e.dernier?.recues, e.dernier?.conflits], [2, 0, 0]);
  await pc2.sync();
  assert.deepEqual(pc2.titres(), ["Client Acme", "Contact Acme"]);
  assert.deepEqual(pc2.c.note(b.id, proprietaire).liensManuels, [a.id]);
  // Rien de neuf : un tour de plus n'envoie ni ne reçoit rien.
  const calme = await pc1.sync();
  assert.deepEqual([calme.dernier?.envoyees, calme.dernier?.recues], [0, 0]);
});

test("une modification et un oubli passent d'un PC à l'autre", async () => {
  const vps = nouveau(), pc1 = poste(vps), pc2 = poste(vps);
  const a = pc1.ecrire("Décision", "Version 1");
  await pc1.sync(); await pc2.sync();
  pc2.modifier(a.id, "Version 2");
  await pc2.sync(); await pc1.sync();
  assert.equal(pc1.contenu(a.id), "Version 2");
  pc1.oublier(a.id);
  await pc1.sync(); await pc2.sync();
  assert.equal(pc2.existe(a.id), false);
  assert.equal(vps.lister(proprietaire).total, 0);
});

test("modifiée des deux côtés : les deux versions restent, partout", async () => {
  const vps = nouveau(), pc1 = poste(vps), pc2 = poste(vps);
  const a = pc1.ecrire("Plan", "Commun");
  await pc1.sync(); await pc2.sync();
  pc1.modifier(a.id, "Version du PC 1");
  pc2.modifier(a.id, "Version du PC 2");
  await pc2.sync();
  const e = await pc1.sync();
  assert.equal(e.dernier?.conflits, 1);
  assert.equal(pc1.contenu(a.id), "Version du PC 1");
  assert.deepEqual(pc1.titres(), ["Plan", "Plan (version VPS)"]);
  await pc2.sync();
  assert.equal(pc2.contenu(a.id), "Version du PC 1");
  assert.deepEqual(pc2.titres(), ["Plan", "Plan (version VPS)"]);
  assert.ok(pc2.c.lister(proprietaire).notes.some((n) => n.titre === "Plan (version VPS)" && pc2.contenu(n.id) === "Version du PC 2"));
});

test("oubliée ici, modifiée ailleurs : la modification l'emporte", async () => {
  const vps = nouveau(), pc1 = poste(vps), pc2 = poste(vps);
  const a = pc1.ecrire("Tarifs", "v1");
  await pc1.sync(); await pc2.sync();
  pc2.modifier(a.id, "v2");
  await pc2.sync();
  pc1.oublier(a.id);
  await pc1.sync();
  assert.equal(pc1.contenu(a.id), "v2");
  assert.equal(vps.note(a.id, proprietaire).contenu, "v2");
});

test("le serveur refuse une écriture si sa note a changé entre-temps ; elle repart et se règle au tour suivant", async () => {
  const vps = nouveau(), pc1 = poste(vps), pc2 = poste(vps);
  const a = pc1.ecrire("Agenda", "v1");
  await pc1.sync(); await pc2.sync();
  pc1.modifier(a.id, "PC1");
  // Juste avant que PC1 écrive sur le serveur, un autre appareil y écrit sa version.
  let fait = false;
  const e = await pc1.sync((action) => {
    if (action === "synchro-appliquer" && !fait) { fait = true; const n = vps.note(a.id, proprietaire); vps.garder({ ...n, contenu: "PC2", liensAuto: [] }); }
  });
  assert.deepEqual(e.aRenvoyer, [a.id]);
  const suite = await pc1.sync();
  assert.deepEqual(suite.aRenvoyer, []);
  assert.equal(suite.dernier?.conflits, 1);
  assert.equal(vps.note(a.id, proprietaire).contenu, "PC1");
  assert.ok(vps.lister(proprietaire).notes.some((n) => vps.note(n.id, proprietaire).contenu === "PC2"));
});

test("seules les notes écrites à la main voyagent : une source indexée reste sur sa machine", async () => {
  const vps = nouveau(), pc1 = poste(vps);
  pc1.c.garder({ id: "", titre: "rapport.pdf", contenu: "Texte indexé du PDF", projetId: null, liens: [], source: null, creeLe: "", modifieLe: "" }, { origine: "document:abc", agentId: null });
  pc1.ecrire("À retenir", "Une note à la main");
  await pc1.sync();
  assert.deepEqual(vps.lister(proprietaire).notes.map((n) => n.titre), ["À retenir"]);
});

test("l'export se fait par pages, sans rien perdre ni répéter", async () => {
  const vps = nouveau(), pc1 = poste(vps);
  for (let i = 0; i < 450; i++) pc1.ecrire(`Note ${String(i).padStart(3, "0")}`, `Contenu numéro ${i} unique`);
  const page = exporterNotes(pc1.c, null);
  assert.equal(page.notes.length, 400);
  assert.ok(page.suite);
  await pc1.sync();
  assert.equal(vps.lister(proprietaire).total, 450);
});

test("côté PC : un tour à la fois par serveur, l'état gardé dans le dossier de l'app, un serveur ancien dit en clair", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const os = await import("node:os"), path = await import("node:path");
  const { creerSynchroCerveau } = await import("./cerveau-synchro-pc.ts");
  const { lireEtatsSynchro } = await import("./cerveau-synchro.ts");
  const donnees = mkdtempSync(path.join(os.tmpdir(), "synchro-pc-")), vps = nouveau();
  try {
    let appels = 0;
    const s = creerSynchroCerveau({ donnees, appeler: async (lieu, action, args) => { appels++; return lieu === "https://ancien.exemple" ? Promise.reject(new Error("Action de mémoire inconnue.")) : serveur(vps)(action, args); } });
    assert.equal(s.vue("https://srv.exemple").actif, false);
    s.activer("https://srv.exemple", true);
    const [a, b] = [s.lancer("https://srv.exemple"), s.lancer("https://srv.exemple")];
    assert.equal(a, b);
    await a;
    assert.equal(appels, 1); // rien à envoyer : seulement l'export du serveur
    assert.equal(lireEtatsSynchro(donnees)["https://srv.exemple"].actif, true);
    const ancien = await s.lancer("https://ancien.exemple");
    assert.match(ancien.dernier?.erreur ?? "", /relancez son installation/);
  } finally { rmSync(donnees, { recursive: true, force: true }); }
});
