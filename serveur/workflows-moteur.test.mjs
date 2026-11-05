import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { creerEspace } from "./espace.mjs";
import { cleConversation, creerJournal } from "./klyra-serveur.mjs";
import { creerMoteurWorkflows } from "./workflows-moteur.mjs";

const noeud = (id, type, champs = {}, autre = {}) => ({ id, type, at: { x: 0, y: 0 }, champs, ...autre });
const lien = (de, vers, autre = {}) => ({ id: `${de}-${vers}`, de, vers, port: "texte", ...autre });

function monde({ reponse = (d) => ({ ok: true, texte: `Fait : ${d.prompt.split("\n").at(-1)}` }), maintenant } = {}) {
  const donnees = mkdtempSync(path.join(tmpdir(), "klyra-wf-"));
  const journal = creerJournal();
  const espace = creerEspace({ donnees });
  const envois = [];
  const annules = [];
  const fichiers = [];
  const moteur = creerMoteurWorkflows({
    donnees,
    espace,
    journal,
    envoyer: (requestId, demande) => {
      envois.push({ requestId, demande });
      const r = reponse(demande);
      if (r) setImmediate(() => journal.publier(requestId, { type: "fin", ok: r.ok, texte: r.texte ?? "", erreur: r.erreur }, "session-1"));
    },
    annuler: (id) => annules.push(id) > 0,
    appelLibre: async () => ({ ok: true, texte: "OUI" }),
    ecrireFichier: async (chemin, texte) => {
      fichiers.push({ chemin, texte });
      return `/var/lib/klyra/documents/${chemin}`;
    },
    cle: cleConversation,
    acces: () => "projet",
    ...(maintenant ? { maintenant } : {}),
  });
  const poser = (wf) => espace.ecrire({ elements: [{ type: "workflow", id: wf.id, valeur: wf }] });
  const executions = () => espace.lireType("execution").map((e) => e.valeur);
  return { donnees, journal, espace, moteur, envois, annules, fichiers, poser, executions, fermer: () => rmSync(donnees, { recursive: true, force: true }) };
}

const simple = (id = "w1") => ({
  id,
  titre: "Page offres",
  projectId: null,
  lieu: "https://vps",
  graphe: {
    noeuds: [noeud("d", "declencheur", { declencheur: "manuel" }), noeud("a", "agent", { agent: "iris", tache: "Maquette" }), noeud("s", "sortie", { cible: "fichier", chemin: "offres.md" })],
    liens: [lien("d", "a"), lien("a", "s")],
    traits: [],
  },
});

test("un workflow tourne sur le serveur, sans app : l'agent du serveur, le fichier, l'exécution écrite", async () => {
  const m = monde();
  try {
    m.poser(simple());
    const id = m.moteur.lancer("w1", { acces: "tout" });
    await m.moteur.attendre(id);
    const [e] = m.executions();
    assert.equal(e.statut, "fait");
    assert.equal(e.numero, 1);
    assert.deepEqual(e.etapes.map((s) => [s.noeudId, s.statut]), [["d", "fait"], ["a", "fait"], ["s", "fait"]]);
    assert.equal(m.envois[0].demande.agent, "iris");
    assert.equal(m.envois[0].demande.conversation, "wf-w1");
    assert.equal(m.envois[0].demande.acces, "tout");
    assert.match(m.fichiers[0].texte, /Fait/);
    // La session de la conversation du workflow est reprise au tour suivant.
    const id2 = m.moteur.lancer("w1");
    await m.moteur.attendre(id2);
    assert.equal(m.envois[1].demande.sessionId, "session-1");
    assert.equal(m.envois[1].demande.acces, "projet", "sans accès demandé : celui du serveur");
    assert.deepEqual(m.executions().map((x) => x.numero).sort(), [1, 2]);
  } finally {
    m.fermer();
  }
});

test("chaque avancée est annoncée à l'app ; une erreur d'agent arrête l'exécution", async () => {
  const m = monde({ reponse: () => ({ ok: false, erreur: "Plus de crédit." }) });
  const annonces = [];
  const original = m.journal.publier;
  m.journal.publier = (r, ev, s, c) => {
    if (r === "workflows") annonces.push(ev);
    return original(r, ev, s, c);
  };
  try {
    m.poser(simple());
    await m.moteur.attendre(m.moteur.lancer("w1"));
    assert.ok(annonces.filter((a) => a.type === "execution").length >= 3);
    const [e] = m.executions();
    assert.equal(e.statut, "erreur");
    assert.equal(e.erreur, "Plus de crédit.");
    assert.equal(annonces.at(-1).execution.statut, "erreur");
  } finally {
    m.fermer();
  }
});

test("une approbation attend la décision de l'app ; un refus arrête tout", async () => {
  const m = monde();
  const wf = {
    id: "w2", titre: "Avec accord", projectId: null,
    graphe: { noeuds: [noeud("d", "declencheur"), noeud("p", "prompt", { texte: "Bonjour" }), noeud("o", "approbation"), noeud("s", "sortie", { cible: "fichier", chemin: "a.md" })], liens: [lien("d", "o"), lien("p", "o"), lien("o", "s")], traits: [] },
  };
  try {
    m.poser(wf);
    const id = m.moteur.lancer("w2");
    let etape = null;
    for (let i = 0; i < 50 && !etape; i++) {
      await new Promise((r) => setTimeout(r, 10));
      etape = m.executions()[0]?.etapes.find((s) => s.statut === "approbation");
    }
    assert.ok(etape, "l'étape attend");
    assert.equal(m.executions()[0].statut, "approbation");
    assert.equal(m.moteur.decider("inconnue", true), false);
    assert.equal(m.moteur.decider(etape.id, true), true);
    await m.moteur.attendre(id);
    assert.equal(m.executions()[0].statut, "fait");
    assert.equal(m.fichiers.length, 1);

    const id2 = m.moteur.lancer("w2");
    let etape2 = null;
    for (let i = 0; i < 50 && !etape2; i++) {
      await new Promise((r) => setTimeout(r, 10));
      etape2 = m.executions().find((e) => e.id === id2)?.etapes.find((s) => s.statut === "approbation");
    }
    m.moteur.decider(etape2.id, false);
    await m.moteur.attendre(id2);
    assert.equal(m.executions().find((e) => e.id === id2).statut, "arrete");
  } finally {
    m.fermer();
  }
});

test("arrêter coupe l'agent en cours", async () => {
  const m = monde({ reponse: () => null });
  try {
    m.poser(simple());
    const id = m.moteur.lancer("w1");
    for (let i = 0; i < 50 && !m.envois.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(m.moteur.arreter(id), true);
    await m.moteur.attendre(id);
    assert.equal(m.executions()[0].statut, "arrete");
    assert.equal(m.annules.length, 1);
    assert.equal(m.moteur.arreter("autre"), false);
  } finally {
    m.fermer();
  }
});

test("planifié : un nouveau déclencheur attend son heure, puis part une fois", async () => {
  let date = new Date("2026-11-05T08:30:00");
  const m = monde({ maintenant: () => date });
  const wf = simple("w3");
  wf.graphe.noeuds[0] = noeud("d", "declencheur", { declencheur: "planifie" }, { frequence: { type: "jour", heure: "09:00" } });
  try {
    m.poser(wf);
    m.moteur.tick();
    assert.equal(m.executions().length, 0, "pas encore l'heure");
    date = new Date("2026-11-05T09:00:30");
    m.moteur.tick();
    assert.equal(m.executions().length, 1);
    assert.equal(m.executions()[0].source, "planifie");
    await m.moteur.attendre(m.executions()[0].id);
    m.moteur.tick();
    assert.equal(m.executions().length, 1, "une seule fois");
  } finally {
    m.fermer();
  }
});

test("webhook : le bon secret lance, les autres n'ouvrent rien", async () => {
  const m = monde();
  try {
    m.poser({ ...simple("w4"), webhooks: { d: "secret-du-webhook" } });
    assert.equal(m.moteur.webhook("mauvais-secret", "x"), false);
    assert.equal(m.moteur.webhook("secret-du-webhook", "Le corps"), true);
    await m.moteur.attendre(m.executions()[0].id);
    const [e] = m.executions();
    assert.equal(e.source, "webhook");
    assert.equal(e.etapes[0].sortie, "Le corps");
  } finally {
    m.fermer();
  }
});

test("au redémarrage, une exécution en cours est dite arrêtée, jamais relancée", () => {
  const m = monde();
  try {
    m.espace.ecrire({ elements: [{ type: "execution", id: "e1", valeur: { id: "e1", workflowId: "w", numero: 1, statut: "approbation", etapes: [{ id: "s", statut: "approbation" }, { id: "f", statut: "fait" }] } }] });
    m.moteur.reprendre();
    const [e] = m.executions();
    assert.equal(e.statut, "arrete");
    assert.match(e.erreur, /redémarré/);
    assert.deepEqual(e.etapes.map((s) => s.statut), ["arrete", "fait"]);
    assert.equal(m.envois.length, 0);
  } finally {
    m.fermer();
  }
});

test("sortie vers une conversation : elle entre dans l'espace du serveur", async () => {
  const m = monde();
  const wf = { id: "w5", titre: "Note", projectId: null, graphe: { noeuds: [noeud("d", "declencheur"), noeud("p", "prompt", { texte: "Résultat" }), noeud("s", "sortie", { cible: "conversation", titre: "Résultats" })], liens: [lien("d", "s"), lien("p", "s")], traits: [] } };
  try {
    m.poser(wf);
    await m.moteur.attendre(m.moteur.lancer("w5"));
    const c = m.espace.lireType("conversation").find((e) => e.id === "wf-sortie-w5");
    assert.equal(c.valeur.chat.title, "Résultats");
    assert.equal(c.valeur.messages[0].parts[0].text, "Résultat");
    assert.equal(c.valeur.messages[0].ecritParServeur, undefined);
  } finally {
    m.fermer();
  }
});

test("les outils d'un agent, sans app : lister, lire, lancer ; construire attend l'app", async () => {
  const m = monde();
  const texte = (r) => r.content[0].text;
  const agent = { agent: "lou", conversation: "dm-lou@vps" };
  try {
    assert.match(texte(m.moteur.outilAgent(agent, "lister_workflows", {})), /Aucun workflow/);
    m.poser(simple());
    assert.match(texte(m.moteur.outilAgent(agent, "lister_workflows", {})), /Page offres \(w1\) · 3 étapes/);
    assert.equal(m.moteur.outilAgent(agent, "lire_workflow", { workflow: "autre" }).isError, true);
    const lance = m.moteur.outilAgent(agent, "lancer_workflow", { workflow: "w1" });
    assert.match(texte(lance), /lancée/);
    assert.equal(m.executions()[0].source, "agent");
    assert.equal(m.executions()[0].lancePar.roleId, "lou");
    await m.moteur.attendre(m.executions()[0].id);
    assert.match(texte(m.moteur.outilAgent(agent, "lire_workflow", { workflow: "w1" })), /Exécution n°1 : fait/);
    assert.equal(m.moteur.outilAgent({ agent: "iris", conversation: "wf-w1" }, "lancer_workflow", { workflow: "w1" }).isError, true);
    assert.match(texte(m.moteur.outilAgent(agent, "construire_workflow", {})), /app KLYRA doit être ouverte/);
  } finally {
    m.fermer();
  }
});
