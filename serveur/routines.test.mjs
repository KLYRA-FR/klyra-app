import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { creerRoutines } from "./routines.mjs";

function banc(debut) {
  const donnees = mkdtempSync(path.join(tmpdir(), "klyra-routines-"));
  let horloge = new Date(debut);
  const envois = [];
  const annules = [];
  const options = {
    donnees,
    home: "/var/lib/klyra",
    envoyer: (requestId, demande) => envois.push({ requestId, ...demande }),
    annuler: (requestId) => (annules.push(requestId), true),
    maintenant: () => horloge,
    setTimer: () => 0,
    clearTimer: () => {},
  };
  return {
    routines: creerRoutines(options),
    recharger: () => creerRoutines(options),
    envois,
    annules,
    avancer: (iso) => (horloge = new Date(iso)),
    fermer: () => rmSync(donnees, { recursive: true, force: true }),
  };
}

const quotidienne = (id, agentId = "principal", extra = {}) => ({
  id,
  agentId,
  name: `Routine ${id}`,
  instruction: "Fais le point.",
  schedule: { kind: "daily", time: "09:00" },
  timezone: "Europe/Paris",
  active: true,
  missedPolicy: "skip",
  acces: "tout",
  ...extra,
});

test("une routine due part une fois, garde sa session et son historique", () => {
  const b = banc("2026-11-02T07:59:00Z");
  try {
    b.routines.recevoir([quotidienne("r1")]);
    assert.equal(b.routines.liste()[0].nextRunAt, "2026-11-02T08:00:00.000Z");
    b.routines.tick();
    assert.equal(b.envois.length, 0);

    b.avancer("2026-11-02T08:00:30Z");
    b.routines.tick();
    b.routines.tick();
    assert.equal(b.envois.length, 1, "une seule exécution");
    const premier = b.envois[0];
    assert.match(premier.prompt, /Routine « Routine r1 »/);
    assert.equal(premier.sessionId, null);
    assert.equal(premier.acces, "tout");
    assert.equal(b.routines.contexte(premier.requestId).chatId, "routine-r1");
    assert.equal(b.routines.historique("r1")[0].status, "running");
    assert.equal(b.routines.liste()[0].nextRunAt, "2026-11-03T08:00:00.000Z");

    b.routines.surEvenement(premier.requestId, { type: "session", sessionId: "11111111-2222-3333-4444-555555555555" });
    b.routines.surEvenement(premier.requestId, { type: "fin", ok: true, texte: "Tout va bien." });
    const run = b.routines.historique("r1")[0];
    assert.equal(run.status, "succeeded");
    assert.equal(run.result, "Tout va bien.");

    b.avancer("2026-11-03T08:00:10Z");
    b.routines.tick();
    assert.equal(b.envois[1].sessionId, "11111111-2222-3333-4444-555555555555", "la même conversation reprend");
  } finally {
    b.fermer();
  }
});

test("un agent à la fois ; un retard saute ou lance une fois selon la règle", () => {
  const b = banc("2026-11-02T07:00:00Z");
  try {
    b.routines.recevoir([quotidienne("a"), quotidienne("b"), quotidienne("c", "lou", { missedPolicy: "run-once" }), quotidienne("d", "iris")]);
    b.avancer("2026-11-02T08:00:05Z");
    b.routines.tick();
    assert.deepEqual(b.envois.map((e) => e.agent), [null, "lou", "iris"], "« b » attend que « a » finisse");
    b.routines.surEvenement(b.envois[0].requestId, { type: "fin", ok: true, texte: "ok" });
    assert.equal(b.envois.length, 4);
    assert.match(b.envois[3].prompt, /Routine b/);

    // Le lendemain, serveur arrêté pendant l'échéance : 2 h de retard.
    for (const e of b.envois.slice(1)) b.routines.surEvenement(e.requestId, { type: "fin", ok: true, texte: "ok" });
    b.avancer("2026-11-03T10:00:00Z");
    b.routines.tick();
    const lancees = b.envois.slice(4).map((e) => e.agent);
    assert.deepEqual(lancees, ["lou"], "seule la routine run-once part");
    assert.equal(b.routines.historique("a")[0].status, "cancelled");
    assert.equal(b.routines.historique("a")[0].missed.count, 1);
    assert.equal(b.routines.historique("c")[0].late, true);
  } finally {
    b.fermer();
  }
});

test("au redémarrage, ce qui tournait est interrompu et ne repart pas ; en attente, on peut annuler", () => {
  const b = banc("2026-11-02T07:59:00Z");
  try {
    b.routines.recevoir([quotidienne("r1")]);
    b.avancer("2026-11-02T08:00:01Z");
    b.routines.tick();
    assert.equal(b.envois.length, 1);
    const relance = b.recharger();
    relance.demarrer();
    assert.equal(relance.historique("r1")[0].status, "interrupted");
    assert.equal(b.envois.length, 1, "pas de doublon");

    const run = relance.executer("r1");
    assert.equal(b.envois.length, 2);
    assert.throws(() => relance.executer("r1"), /deja-en-cours/);
    assert.equal(relance.interrompre(run.id), true);
    assert.deepEqual(b.annules, [`routine-${run.id}`]);
  } finally {
    b.fermer();
  }
});

test("une définition hors du dossier de klyra ou incomplète est refusée", () => {
  const b = banc("2026-11-02T07:00:00Z");
  try {
    assert.throws(() => b.routines.recevoir([quotidienne("r1", "principal", { dossier: "/etc" })]), /dossier/);
    assert.throws(() => b.routines.recevoir([quotidienne("../x")]), /routine/);
    assert.throws(() => b.routines.recevoir([{ ...quotidienne("r1"), instruction: " " }]), /consigne/);
    b.routines.recevoir([quotidienne("r1", "principal", { dossier: "/var/lib/klyra/projets/site", active: false })]);
    assert.equal(b.routines.liste()[0].nextRunAt, null);
    b.routines.recevoir([]);
    assert.equal(b.routines.liste().length, 0);
  } finally {
    b.fermer();
  }
});
