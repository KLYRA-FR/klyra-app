import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { creerEspace } from "./espace.mjs";
import { TRAVAUX_MAX } from "./fils-outils.mjs";
import { creerFilsServeur, creerRelaisFils, OUTILS_FILS, resultatValide } from "./fils.mjs";
import { cleConversation, creerJournal } from "./klyra-serveur.mjs";

const appelant = { agent: "camille", conversation: "dm-camille" };

test("les outils sont ceux du PC", () => {
  assert.deepEqual(OUTILS_FILS.map((o) => o.name), ["ouvrir_fil", "lister_fils", "lire_fil", "ecrire_dans_fil", "mettre_a_jour_fil", "arreter_fil", "reprendre_fil", "fermer_fil"]);
});

test("app ouverte : l'appel part au PC par le journal, sa réponse revient à l'agent", async () => {
  const publies = [];
  const relais = creerRelaisFils({ publier: (id, event) => publies.push({ id, event }), ecouteurs: () => 1, local: () => assert.fail("le PC répond"), maintenant: () => 1000 });
  const promesse = relais.appeler(appelant, "ouvrir_fil", { agent: "hugo", titre: "Qonto", brief: "Branche le MCP." });
  assert.equal(publies.length, 1);
  const { id, event } = publies[0];
  assert.deepEqual([event.type, event.id, event.nom, event.agent, event.conversation, event.arguments.agent], ["fil", id, "ouvrir_fil", "camille", "dm-camille", "hugo"]);
  assert.ok(event.expire > 1000);
  assert.equal(relais.repondre(id, { content: [{ type: "text", text: "Fil ouvert" }] }), true);
  assert.deepEqual(await promesse, { content: [{ type: "text", text: "Fil ouvert" }] });
  assert.equal(relais.repondre(id, { content: [{ type: "text", text: "deux fois" }] }), false);
});

test("outil inconnu, sans conversation, délai dépassé : refusés ; la réponse du PC est filtrée", async () => {
  const relais = creerRelaisFils({ publier: () => undefined, ecouteurs: () => 1, delaiMs: 20 });
  assert.equal((await relais.appeler(appelant, "Bash", {})).isError, true);
  assert.equal((await relais.appeler({ agent: "camille", conversation: "" }, "lister_fils", {})).isError, true);
  assert.match((await relais.appeler(appelant, "lister_fils", {})).content[0].text, /pas répondu/);
  assert.equal(relais.enAttente(), 0);
  assert.deepEqual(resultatValide({ content: [{ type: "image", data: "AA" }, { type: "text", text: "ok" }] }).content, [{ type: "text", text: "ok" }]);
});

/** Un serveur sans PC : son espace, son journal, la réponse rangée comme le fait klyra-serveur.mjs. */
function serveur(t, { ecouteurs = 0, finPerdue = false } = {}) {
  const dossier = mkdtempSync(path.join(os.tmpdir(), "klyra-fils-"));
  t.after(() => rmSync(dossier, { recursive: true, force: true }));
  const espace = creerEspace({ donnees: dossier });
  const journal = creerJournal();
  let abonnes = ecouteurs;
  journal.ecouteurs = () => abonnes;
  const envois = [];
  const annules = [];
  const fils = creerFilsServeur({
    espace,
    /* `finPerdue` : les fils ne sont pas prévenus des fins (un écouteur perdu) ; le journal, lui, les garde. */
    journal: finPerdue ? { ...journal, ecouterFin: () => undefined } : journal,
    envoyer: (requestId, demande) => envois.push({ requestId, demande }),
    annuler: (requestId) => annules.push(requestId),
    equipe: () => ({ assistant: "Cicco", actifs: [{ id: "camille", nom: "Camille" }, { id: "hugo", nom: "Hugo" }] }),
    acces: () => "projet",
    cle: cleConversation,
  });
  /* Comme creerGestionnaire : PC fermé, le serveur range la réponse dans sa conversation (après les fils). */
  journal.ecouterFin(({ requestId, event, sessionId, contexte, cle }) => {
    if (journal.ecouteurs() > 0) return;
    const [conversation, agent] = typeof cle === "string" ? cle.split("|") : [];
    espace.noterReponse({ requestId, event, sessionId, contexte, conversation, agent });
  });
  const lanceur = { chat: { id: "dm-camille", kind: "direct", projectId: null, title: "Camille", roleIds: ["camille"], updatedAt: "2026-11-06T09:00:00.000Z", sessions: {}, luJusqua: null }, messages: [] };
  espace.ecrire({ elements: [{ type: "conversation", id: "dm-camille", valeur: lanceur }] });
  const conversation = (id) => espace.lireType("conversation").find((e) => e.id === id)?.valeur;
  const outil = (nom, args, qui = appelant) => fils.outilAgent(qui, nom, args);
  const finir = async (requestId, event) => {
    journal.publier(requestId, { type: "fin", ...event }, "11111111-2222-3333-4444-555555555555");
    await new Promise((r) => setImmediate(r));
  };
  return { espace, journal, fils, envois, annules, conversation, outil, finir, ecouter: (n) => (abonnes = n) };
}

test("PC fermé : ouvrir un fil le crée dans l'espace du serveur et lance son agent", (t) => {
  const s = serveur(t);
  const r = s.outil("ouvrir_fil", { agent: "hugo", titre: "Brancher Qonto", brief: "Branche le MCP Qonto pour Camille.", priorite: 2 });
  assert.equal(r.isError, undefined);
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(r.content[0].text)?.[1];
  assert.ok(id, r.content[0].text);
  assert.match(r.content[0].text, /Hugo y travaille.*te reviendra/);
  const v = s.conversation(id);
  assert.deepEqual([v.chat.title, v.chat.fil.roleId, v.chat.fil.etape, v.chat.fil.priorite, v.chat.fil.retourAttendu], ["Brancher Qonto", "hugo", "en-cours", 2, true]);
  assert.deepEqual(v.chat.fil.lancePar, { roleId: "camille", chatId: "dm-camille" });
  assert.equal(v.messages[0].parts[0].text, "Branche le MCP Qonto pour Camille.");
  assert.equal(s.envois.length, 1);
  const { demande } = s.envois[0];
  assert.deepEqual([demande.agent, demande.conversation, demande.sessionId, demande.acces], ["hugo", id, null, "projet"]);
  assert.match(demande.prompt, /Tu travailles dans un fil/);
  assert.match(demande.prompt, /ta réponse revient à Camille/);
  assert.match(demande.prompt, /\[Brief de Camille\]\nBranche le MCP Qonto/);
  assert.equal(s.fils.travaille(id), true);
  assert.match(s.outil("lister_fils", {}).content[0].text, new RegExp(`Brancher Qonto \\(${id}\\)`));
});

test("refus : agent hors de Mes agents, brief vide, projet inconnu, un travail de trop", (t) => {
  const s = serveur(t);
  assert.match(s.outil("ouvrir_fil", { agent: "zoe", titre: "x", brief: "y" }).content[0].text, /n’est pas dans Mes agents/);
  assert.match(s.outil("ouvrir_fil", { agent: "hugo", titre: "x", brief: " " }).content[0].text, /brief est vide/);
  assert.match(s.outil("ouvrir_fil", { agent: "hugo", titre: "x", brief: "y", projet: "site" }).content[0].text, /Aucun projet/);
  assert.equal(TRAVAUX_MAX, 5);
  const ids = [];
  for (let i = 0; i < TRAVAUX_MAX; i++) {
    const r = s.outil("ouvrir_fil", { agent: "hugo", titre: `t${i}`, brief: "y" });
    assert.equal(r.isError, undefined);
    ids.push(/\((klyra-fil-[a-z0-9-]+)\)/.exec(r.content[0].text)[1]);
  }
  const refus = s.outil("ouvrir_fil", { agent: "hugo", titre: "de trop", brief: "y" });
  assert.equal(refus.isError, true);
  assert.match(refus.content[0].text, /^En attente : 5 travaux sont déjà ouverts\. Places prises : /);
  for (const [i, id] of ids.entries()) assert.ok(refus.content[0].text.includes(`t${i} (${id})`), refus.content[0].text);
  assert.equal(s.envois.length, TRAVAUX_MAX);
});

/** Un fil ouvert par Camille, son agent lancé : son identifiant et sa réponse en cours. */
const ouvrir = (s, titre) => {
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(s.outil("ouvrir_fil", { agent: "hugo", titre, brief: "y" }).content[0].text)[1];
  return { id, requestId: s.envois.at(-1).requestId };
};

test("places orphelines : fil supprimé, fermé ou arrêté, réponse finie sans retour ici, rendues avant de refuser", (t) => {
  const s = serveur(t, { finPerdue: true });
  const supprime = ouvrir(s, "supprimé");
  const ferme = ouvrir(s, "fermé à la main");
  const arrete = ouvrir(s, "arrêté");
  const fini = ouvrir(s, "fini");
  const vivant = ouvrir(s, "vivant");
  /* Supprimé, ou fermé dans l'app, sans que la fin de sa réponse arrive ici. */
  s.espace.ecrire({ supprimes: [{ type: "conversation", id: supprime.id }] });
  const v = s.conversation(ferme.id);
  s.espace.ecrire({ elements: [{ type: "conversation", id: ferme.id, valeur: { ...v, chat: { ...v.chat, fil: { ...v.chat.fil, statut: "archive" } } } }] });
  /* Arrêté sur le fil (ancienne version : la place restait prise). */
  const a = s.conversation(arrete.id);
  s.espace.ecrire({ elements: [{ type: "conversation", id: arrete.id, valeur: { ...a, chat: { ...a.chat, fil: { ...a.chat.fil, suspendu: true } } } }] });
  /* La fin est dans le journal, mais n'est pas passée par les fils (écouteur perdu). */
  s.journal.publier(fini.requestId, { type: "fin", ok: true, texte: "" }, null);
  const r = s.outil("ouvrir_fil", { agent: "hugo", titre: "nouveau", brief: "y" });
  assert.equal(r.isError, undefined, r.content[0].text);
  for (const o of [supprime, ferme, arrete, fini]) assert.equal(s.fils.travaille(o.id), false);
  assert.equal(s.fils.travaille(vivant.id), true, "une réponse qui tourne garde sa place");
  assert.deepEqual(s.fils.purger().map((o) => o.titre).sort(), ["nouveau", "vivant"]);
});

test("arrêter ou fermer un fil rend sa place aussitôt", async (t) => {
  const s = serveur(t);
  const arrete = ouvrir(s, "à arrêter");
  const ferme = ouvrir(s, "à fermer");
  assert.match(s.outil("arreter_fil", { id: arrete.id }).content[0].text, /Arrêté/);
  assert.deepEqual(s.annules, [arrete.requestId]);
  assert.equal(s.fils.travaille(arrete.id), false);
  assert.match(s.outil("fermer_fil", { id: ferme.id }).content[0].text, /Fil fermé/);
  assert.equal(s.fils.travaille(ferme.id), false);
  /* La fin qui arrive après ne casse rien : le ticket est rangé comme avant. */
  await s.finir(arrete.requestId, { ok: false, texte: "", erreur: "Arrêté par toi." });
  assert.equal(s.fils.travaille(arrete.id), false);
  assert.equal(s.conversation(arrete.id).chat.fil.suspendu, true);
});

test("PC fermé, la réponse finit : ticket à valider, retour rapporté à Camille une fois, l'app prévenue", async (t) => {
  const s = serveur(t);
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(s.outil("ouvrir_fil", { agent: "hugo", titre: "Qonto", brief: "Branche." }).content[0].text)[1];
  const { requestId } = s.envois[0];
  await s.finir(requestId, { ok: true, texte: "Compte rendu dans qonto.md." });
  const fil = s.conversation(id);
  assert.deepEqual([fil.chat.fil.etape, fil.chat.fil.retourAttendu], ["a-valider", false]);
  assert.equal(fil.messages.at(-1).parts[0].text, "Compte rendu dans qonto.md.", "la réponse rangée par le serveur");
  assert.equal(s.fils.travaille(id), false);
  const lanceur = s.conversation("dm-camille");
  assert.match(lanceur.messages.at(-1).parts[0].text, new RegExp(`\\*\\*Fil terminé : Qonto\\*\\* \\(${id}\\) · Hugo\\n\\nCompte rendu dans qonto.md.`));
  assert.deepEqual(lanceur.messages.at(-1).author, { kind: "role", roleId: "hugo" });
  assert.equal(s.envois.length, 2);
  const retour = s.envois[1];
  assert.deepEqual([retour.demande.agent, retour.demande.conversation], ["camille", "dm-camille"]);
  assert.match(retour.demande.prompt, /^\[Retour du fil, de Hugo\]\n\*\*Fil terminé/);
  /* L'app qui relit le journal ne le rapporte pas une seconde fois. */
  const relu = [];
  let fermer = () => {};
  const res = { write: (t) => relu.push(t), end() {}, on: (_nom, fn) => (fermer = fn) };
  s.journal.abonner(res, 0, "", null);
  fermer();
  assert.ok(relu.some((l) => l.includes(requestId) && l.includes('"retourFil":"serveur"')));
  /* La session de Hugo est retenue : la précision suivante reprend la conversation du fil. */
  s.outil("ecrire_dans_fil", { id, message: "Ajoute le lien." });
  assert.equal(s.envois[2].demande.sessionId, "11111111-2222-3333-4444-555555555555");
  assert.match(s.envois[2].demande.prompt, /^\[Message de Camille\]\nAjoute le lien\.$/);
  assert.equal(s.conversation(id).chat.fil.retourAttendu, true);
});

test("app ouverte à la fin : c'est elle qui tient le ticket et rapporte, le serveur ne fait rien", async (t) => {
  const s = serveur(t);
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(s.outil("ouvrir_fil", { agent: "hugo", titre: "Qonto", brief: "Branche." }).content[0].text)[1];
  s.ecouter(1);
  await s.finir(s.envois[0].requestId, { ok: true, texte: "Fait." });
  assert.equal(s.conversation(id).chat.fil.retourAttendu, true);
  assert.equal(s.conversation("dm-camille").messages.length, 0);
  assert.equal(s.envois.length, 1);
  assert.equal(s.fils.travaille(id), false);
});

test("une erreur bloque le ticket ; un message attend que le fil ait fini", async (t) => {
  const s = serveur(t);
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(s.outil("ouvrir_fil", { agent: "hugo", titre: "Qonto", brief: "Branche." }).content[0].text)[1];
  assert.match(s.outil("ecrire_dans_fil", { id, message: "Et la doc." }).content[0].text, /après sa réponse en cours/);
  assert.equal(s.envois.length, 1, "pas deux réponses en même temps dans le fil");
  await s.finir(s.envois[0].requestId, { ok: false, texte: "", erreur: "Claude Code a planté." });
  const fil = s.conversation(id).chat.fil;
  assert.deepEqual([fil.etape, fil.raison], ["en-cours", null], "la précision repart aussitôt");
  assert.match(s.conversation("dm-camille").messages.at(-1).parts[0].text, /Fil arrêté sur une erreur/);
  const precision = s.envois.find((e) => e.demande.conversation === id && e.requestId !== s.envois[0].requestId);
  assert.match(precision.demande.prompt, /Et la doc\./);
});

test("état, arrêt, reprise, fermeture : les règles des tickets de l'app", async (t) => {
  const s = serveur(t);
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(s.outil("ouvrir_fil", { agent: "hugo", titre: "Qonto", brief: "Branche." }).content[0].text)[1];
  const iris = { agent: "iris", conversation: "dm-iris" };
  assert.match(s.outil("mettre_a_jour_fil", { id, etat: "bloque", raison: "x" }, iris).content[0].text, /Seuls l’agent du fil/);
  assert.match(s.outil("mettre_a_jour_fil", { id, etat: "bloque" }, { agent: "hugo", conversation: id }).content[0].text, /Dis pourquoi/);
  assert.match(s.outil("mettre_a_jour_fil", { id, etat: "bloque", raison: "Attend l’accès Qonto" }, { agent: "hugo", conversation: id }).content[0].text, /bloqué/);
  assert.deepEqual([s.conversation(id).chat.fil.etape, s.conversation(id).chat.fil.etapePosee], ["bloque", true]);
  await s.finir(s.envois[0].requestId, { ok: true, texte: "J’attends." });
  assert.equal(s.conversation(id).chat.fil.etape, "bloque", "posée exprès, la fin ne la remplace pas");
  assert.match(s.outil("lire_fil", { id }).content[0].text, /Dernière réponse :\nJ’attends\./);
  assert.match(s.outil("arreter_fil", { id }).content[0].text, /Arrêté/);
  assert.match(s.outil("ecrire_dans_fil", { id, message: "Reprends." }).content[0].text, /suspendu/);
  assert.match(s.outil("reprendre_fil", { id }).content[0].text, /référence du contrôle/);
  assert.match(s.outil("reprendre_fil", { id, controle: "ok-corentin" }).content[0].text, /^Repris/);
  assert.equal(s.conversation(id).chat.fil.suspendu, undefined);
  assert.match(s.outil("fermer_fil", { id }, { agent: "hugo", conversation: id }).content[0].text, /ouvert par Camille/);
  assert.match(s.outil("fermer_fil", { id }).content[0].text, /Fil fermé et archivé/);
  assert.equal(s.conversation(id).chat.fil.statut, "archive");
  assert.equal(s.outil("lister_fils", {}).content[0].text, "Aucun fil ouvert.");
});

test("une conversation que le serveur ne connaît pas n'est pas réécrite : pas de retour, le fil reste", (t) => {
  const s = serveur(t);
  const r = s.outil("ouvrir_fil", { agent: "hugo", titre: "x", brief: "y" }, { agent: "camille", conversation: "dm-inconnue" });
  assert.doesNotMatch(r.content[0].text, /te reviendra/);
  const id = /\((klyra-fil-[a-z0-9-]+)\)/.exec(r.content[0].text)[1];
  assert.equal(s.conversation(id).chat.fil.lancePar, null);
  assert.equal(s.conversation("dm-inconnue"), undefined);
});
