/**
 * Moteur des routines : les 13 scénarios du relevé OpenBot et les cas de robustesse.
 * Dossiers temporaires, horloge et minuteur simulés, interface factice : aucun agent
 * n'est lancé, aucun fichier de l'app n'est touché.
 *   pnpm build:electron && node scripts/test-routines.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script Node en CommonJS */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RoutineEngine, GRACE_MS } = require("../dist-electron/routines/engine.js");
const { RoutineStore } = require("../dist-electron/routines/store.js");
const { convertirRoutine } = require("../dist-electron/routines/migration.js");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
let checked = 0;
let ids = 0;
const dossiers = [];

function test(name, run) {
  run();
  checked++;
  console.log(`OK — ${name}`);
}

/** Un banc : un dossier, une horloge, un minuteur et une interface simulés. Redémarrable sur le même dossier. */
function banc(start, { hote = true, dir } = {}) {
  const b = {
    dir: dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "klyra-routines-")),
    t: Date.parse(start),
    timers: [],
    livrees: [],
    annulees: [],
    hote,
  };
  if (!dir) dossiers.push(b.dir);
  b.demarrer = () => {
    b.store = new RoutineStore(b.dir);
    b.store.load();
    b.engine = new RoutineEngine({
      store: b.store,
      host: {
        deliver: (run) => {
          if (!b.hote) return false;
          b.livrees.push(run.id);
          return true;
        },
        cancel: (run) => b.annulees.push(run.id),
      },
      now: () => new Date(b.t),
      setTimer: (fn, ms) => {
        const h = { fn, at: b.t + ms, ms };
        b.timers.push(h);
        return h;
      },
      clearTimer: (h) => {
        const i = b.timers.indexOf(h);
        if (i >= 0) b.timers.splice(i, 1);
      },
      newId: () => `id-${++ids}`,
      defaultTimezone: () => "Europe/Paris",
    });
    b.engine.start();
    if (b.hote) b.engine.setHostReady(true);
    return b.engine;
  };
  /** L'app se ferme : plus de minuteur, le fichier reste. */
  b.fermer = () => {
    b.engine.stop();
    b.timers = [];
  };
  /** Le temps passe, les minuteurs dus partent dans l'ordre. */
  b.avancer = (ms) => {
    const fin = b.t + ms;
    for (;;) {
      b.timers.sort((x, y) => x.at - y.at);
      const h = b.timers[0];
      if (!h || h.at > fin) break;
      b.timers.shift();
      b.t = Math.max(b.t, h.at);
      h.fn();
    }
    b.t = fin;
  };
  b.aller = (iso) => b.avancer(Date.parse(iso) - b.t);
  b.runs = (routineId) => b.engine.history(routineId, 100);
  b.demarrer();
  return b;
}

const quotidienne = (b, extra = {}) =>
  b.engine.create({ agentId: "hugo", name: "Point de midi", instruction: "Fais le point des tâches.", schedule: { kind: "daily", time: "12:00" }, ...extra });

const finir = (b, run, ok = true) => {
  b.engine.report(run.id, { state: "running", chatId: "direct-hugo", messageId: `m-${run.id}` });
  b.engine.report(
    run.id,
    ok
      ? { state: "succeeded", chatId: "direct-hugo", messageId: `m-${run.id}`, result: "Trois tâches en retard." }
      : { state: "failed", chatId: "direct-hugo", messageId: `m-${run.id}`, error: "Le dossier du projet est introuvable." },
  );
};

/* ─── Les 13 scénarios du relevé ─────────────────────────────── */

test("1. daily 12:00 Europe/Paris : 11:00Z en hiver, 10:00Z en été", () => {
  const hiver = banc("2026-01-10T08:00:00Z");
  assert.equal(quotidienne(hiver).nextRunAt, "2026-01-10T11:00:00.000Z");
  const ete = banc("2026-07-10T08:00:00Z");
  assert.equal(quotidienne(ete).nextRunAt, "2026-07-10T10:00:00.000Z");
});

test("2. échéance : une exécution planifiée, queued → running → succeeded, puis +1 jour", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  b.aller("2026-01-10T11:00:00Z");
  const [run] = b.runs(r.id);
  assert.equal(run.kind, "scheduled");
  assert.equal(run.scheduledFor, "2026-01-10T11:00:00.000Z");
  assert.equal(run.status, "queued");
  assert.deepEqual(b.livrees, [run.id]);
  b.engine.report(run.id, { state: "running", chatId: "direct-hugo", messageId: "m1" });
  assert.equal(b.engine.history(r.id)[0].status, "running");
  b.engine.report(run.id, { state: "succeeded", chatId: "direct-hugo", messageId: "m1", result: "Trois tâches en retard." });
  const fini = b.engine.history(r.id)[0];
  assert.equal(fini.status, "succeeded");
  assert.equal(fini.result, "Trois tâches en retard.");
  assert.deepEqual(fini.delivery, { chatId: "direct-hugo", messageId: "m1" });
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-11T11:00:00.000Z");
});

test("3. Exécuter maintenant : run manuel, programmation inchangée, pas de doublon en attente", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  const run = b.engine.runNow(r.id);
  assert.equal(run.kind, "manual");
  assert.equal(run.scheduledFor, "2026-01-10T08:00:00.000Z");
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-10T11:00:00.000Z");
  assert.throws(() => b.engine.runNow(r.id), /déjà une exécution/);
  finir(b, run);
  assert.equal(b.engine.runNow(r.id).kind, "manual");
});

test("4. échec signalé : failed avec motif, routine active, suivante planifiée", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  b.aller("2026-01-10T11:00:00Z");
  finir(b, b.runs(r.id)[0], false);
  const [run] = b.runs(r.id);
  assert.equal(run.status, "failed");
  assert.equal(run.error, "Le dossier du projet est introuvable.");
  assert.equal(b.engine.get(r.id).active, true);
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-11T11:00:00.000Z");
});

test("5. pause : rien ne part, prochaines vides ; reprise recalculée depuis maintenant, sans rattrapage", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  assert.equal(b.engine.upcoming(r.id).length, 7);
  b.engine.update(r.id, { active: false });
  assert.deepEqual(b.engine.upcoming(r.id), []);
  assert.equal(b.timers.length, 0);
  b.aller("2026-01-13T08:00:00Z");
  assert.equal(b.runs(r.id).length, 0);
  const reprise = b.engine.update(r.id, { active: true });
  assert.equal(reprise.nextRunAt, "2026-01-13T11:00:00.000Z");
  assert.equal(b.runs(r.id).length, 0);
});

test("6a. app fermée sur 3 échéances, skip : un seul enregistrement « 3 non exécutées », rien ne part", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b, { missedPolicy: "skip" });
  b.fermer();
  b.t = Date.parse("2026-01-13T08:00:00Z");
  b.demarrer();
  const runs = b.runs(r.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "cancelled");
  assert.deepEqual(runs[0].missed, { count: 3, capped: false, until: "2026-01-12T11:00:00.000Z", reason: "app-closed" });
  assert.equal(runs[0].scheduledFor, "2026-01-10T11:00:00.000Z");
  assert.equal(b.livrees.length, 0);
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-13T11:00:00.000Z");
});

test("6b. app fermée sur 3 échéances, run-once : la plus récente part en retard, les 2 autres résumées", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b, { missedPolicy: "run-once" });
  b.fermer();
  b.t = Date.parse("2026-01-13T08:00:00Z");
  b.demarrer();
  const runs = b.runs(r.id);
  const late = runs.find((x) => x.status === "queued");
  const resume = runs.find((x) => x.status === "cancelled");
  assert.equal(runs.length, 2);
  assert.equal(late.late, true);
  assert.equal(late.scheduledFor, "2026-01-12T11:00:00.000Z");
  assert.deepEqual(resume.missed, { count: 2, capped: false, until: "2026-01-11T11:00:00.000Z", reason: "app-closed" });
  assert.deepEqual(b.livrees, [late.id]);
});

test("7. une fois : date passée refusée ; exécutée → pause, date gardée ; reprise sans nouvelle date refusée", () => {
  const b = banc("2026-01-10T08:00:00Z");
  assert.throws(
    () => b.engine.create({ agentId: "hugo", name: "Rappel", instruction: "x", schedule: { kind: "once", date: "2026-01-09", time: "12:00" } }),
    /futures/,
  );
  const r = b.engine.create({ agentId: "hugo", name: "Rappel", instruction: "x", schedule: { kind: "once", date: "2026-01-10", time: "12:00" } });
  assert.equal(r.missedPolicy, "run-once");
  b.aller("2026-01-10T11:00:00Z");
  const apres = b.engine.get(r.id);
  assert.equal(apres.active, false);
  assert.equal(apres.nextRunAt, null);
  assert.deepEqual(apres.schedule, { kind: "once", date: "2026-01-10", time: "12:00" });
  assert.equal(b.runs(r.id).length, 1);
  assert.throws(() => b.engine.update(r.id, { active: true }), /nouvelle date future/);
  const nouvelle = b.engine.update(r.id, { active: true, schedule: { kind: "once", date: "2026-01-11", time: "09:00" } });
  assert.equal(nouvelle.nextRunAt, "2026-01-11T08:00:00.000Z");
});

test("8. cadence de 2 minutes refusée (intervalle et cron)", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const base = { agentId: "hugo", name: "Trop vite", instruction: "x" };
  assert.throws(() => b.engine.create({ ...base, schedule: { kind: "interval", amount: 2, unit: "minutes", anchorAt: "2026-01-10T08:00:00Z" } }), /3 minutes/);
  assert.throws(() => b.engine.create({ ...base, schedule: { kind: "custom", expression: "*/2 * * * *" } }), /3 minutes/);
  assert.equal(b.engine.list().length, 0);
});

test("9. deux minuteurs sur la même échéance → une seule exécution ; contrainte du fichier ; second process refusé", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  b.t = Date.parse("2026-01-10T11:00:00Z");
  b.engine.tick();
  b.engine.tick();
  assert.equal(b.runs(r.id).filter((x) => x.kind === "scheduled").length, 1);
  const run = b.runs(r.id)[0];
  assert.throws(() => b.store.transaction((data) => void data.runs.push({ ...run, id: "copie" })), /déjà une exécution/);
  assert.equal(b.runs(r.id).length, 1);
  b.store.acquire(process.pid);
  // Un autre process vivant (le parent de ce test) tient déjà le verrou.
  fs.writeFileSync(path.join(b.dir, "routines.lock"), String(process.ppid));
  assert.throws(() => new RoutineStore(b.dir).acquire(process.pid), /Une autre KLYRA/);
  // Le verrou d'un process disparu est repris.
  fs.writeFileSync(path.join(b.dir, "routines.lock"), "999999999");
  new RoutineStore(b.dir).acquire(process.pid);
  assert.equal(fs.readFileSync(path.join(b.dir, "routines.lock"), "utf8"), String(process.pid));
});

test("10. arrêt entre la création et l'envoi : reprise au démarrage, sans doublon", () => {
  const b = banc("2026-01-10T08:00:00Z", { hote: false });
  const r = quotidienne(b);
  b.aller("2026-01-10T11:00:00Z");
  assert.equal(b.runs(r.id).length, 1);
  assert.equal(b.livrees.length, 0);
  b.fermer();
  b.t += 10 * MIN;
  b.hote = true;
  b.demarrer();
  const runs = b.runs(r.id);
  assert.equal(runs.length, 1);
  assert.deepEqual(b.livrees, [runs[0].id]);
  // Confiée mais pas encore postée au moment d'un rechargement : renvoyée avec le même id.
  b.engine.setHostReady(false);
  b.engine.setHostReady(true);
  assert.deepEqual(b.livrees, [runs[0].id, runs[0].id]);
  assert.equal(b.runs(r.id).length, 1);
});

test("11. changement d'heure : heure sautée et heure doublée, via le moteur", () => {
  const b = banc("2026-03-28T00:00:00Z");
  const r = b.engine.create({ agentId: "hugo", name: "Nuit", instruction: "x", schedule: { kind: "daily", time: "02:30" } });
  assert.equal(r.nextRunAt, "2026-03-28T01:30:00.000Z");
  b.aller("2026-03-28T01:30:00Z");
  // Le 29/03, 02:30 n'existe pas à Paris : pas d'exécution ce jour-là.
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-03-30T00:30:00.000Z");
  const automne = banc("2026-10-24T12:00:00Z");
  const a = automne.engine.create({ agentId: "hugo", name: "Nuit", instruction: "x", schedule: { kind: "daily", time: "02:30" } });
  assert.equal(a.nextRunAt, "2026-10-25T00:30:00.000Z");
  finir(automne, (automne.aller("2026-10-25T00:30:00Z"), automne.runs(a.id)[0]));
  // Le 25/10, 02:30 existe deux fois : deux passages (parité OpenBot inférée, cf. ETAT-IMPLEMENTATION).
  assert.equal(automne.engine.get(a.id).nextRunAt, "2026-10-25T01:30:00.000Z");
  const once = automne.engine.create({ agentId: "iris", name: "Une fois", instruction: "x", schedule: { kind: "once", date: "2027-03-28", time: "02:30" } });
  assert.equal(once.nextRunAt, "2027-03-28T01:00:00.000Z");
});

test("12. consigne modifiée après un run : l'historique garde l'ancienne", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  b.aller("2026-01-10T11:00:00Z");
  finir(b, b.runs(r.id)[0]);
  b.engine.update(r.id, { name: "Point du midi", instruction: "Nouvelle consigne." });
  const [run] = b.runs(r.id);
  assert.equal(run.routineName, "Point de midi");
  assert.equal(run.instruction, "Fais le point des tâches.");
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-11T11:00:00.000Z");
});

test("13. agent occupé : la routine attend en file puis part ; pas de second run de la même routine", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r1 = b.engine.create({ agentId: "hugo", name: "A", instruction: "a", schedule: { kind: "daily", time: "12:00" } });
  const r2 = b.engine.create({ agentId: "hugo", name: "B", instruction: "b", schedule: { kind: "daily", time: "12:00" } });
  const r3 = b.engine.create({ agentId: "iris", name: "C", instruction: "c", schedule: { kind: "daily", time: "12:00" } });
  b.aller("2026-01-10T11:00:00Z");
  const [a] = b.runs(r1.id);
  const [bb] = b.runs(r2.id);
  const [c] = b.runs(r3.id);
  // Un agent à la fois : Hugo prend A, B attend ; Iris part en parallèle.
  assert.deepEqual(b.livrees.sort(), [a.id, c.id].sort());
  assert.equal(bb.dispatchedAt, null);
  b.engine.report(a.id, { state: "running", chatId: "direct-hugo", messageId: "m-a" });
  // Le lendemain, A tourne encore et B attend toujours : l'échéance de B est résumée, pas empilée.
  b.aller("2026-01-11T11:00:00Z");
  const runsB = b.runs(r2.id);
  assert.equal(runsB.filter((x) => x.status === "queued").length, 1);
  assert.deepEqual(runsB.find((x) => x.status === "cancelled").missed, { count: 1, capped: false, until: "2026-01-11T11:00:00.000Z", reason: "busy" });
  // A (qui tourne) a sa nouvelle échéance en file derrière lui.
  assert.equal(b.runs(r1.id).filter((x) => x.status === "queued").length, 1);
  b.engine.report(a.id, { state: "succeeded", chatId: "direct-hugo", messageId: "m-a", result: "ok" });
  assert.ok(b.livrees.includes(bb.id));
});

/* ─── Robustesse ─────────────────────────────────────────────── */

test("veille : suspend désarme, le réveil regroupe le manqué (motif veille)", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = b.engine.create({ agentId: "hugo", name: "Horaire", instruction: "x", schedule: { kind: "hourly", minute: 0 } });
  b.engine.suspend();
  assert.equal(b.timers.length, 0);
  b.t = Date.parse("2026-01-10T12:20:00Z");
  b.engine.resume();
  const runs = b.runs(r.id);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].missed, { count: 4, capped: false, until: "2026-01-10T12:00:00.000Z", reason: "sleep" });
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-10T13:00:00.000Z");
});

test("minuteur en retard de moins de 2 min : exécution normale, pas « en retard »", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b, { missedPolicy: "run-once" });
  b.fermer();
  b.t = Date.parse("2026-01-10T11:00:00Z") + GRACE_MS - 1000;
  b.demarrer();
  const runs = b.runs(r.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].late, undefined);
  assert.equal(runs[0].scheduledFor, "2026-01-10T11:00:00.000Z");
});

test("fermée un mois sur un intervalle de 3 min : compte plafonné, run-once prend la plus récente", () => {
  const b = banc("2026-01-01T00:00:00Z");
  const r = b.engine.create({
    agentId: "hugo", name: "Veille", instruction: "x", missedPolicy: "run-once",
    schedule: { kind: "interval", amount: 3, unit: "minutes", anchorAt: "2026-01-01T00:00:00Z" },
  });
  b.fermer();
  b.t = Date.parse("2026-02-01T00:01:00Z");
  const debut = Date.now();
  b.demarrer();
  assert.ok(Date.now() - debut < 2000, "rattrapage trop lent");
  const runs = b.runs(r.id);
  const late = runs.find((x) => x.status === "queued");
  assert.equal(late.scheduledFor, "2026-02-01T00:00:00.000Z");
  assert.equal(runs.find((x) => x.status === "cancelled").missed.capped, true);
});

test("minuteur unique, plafonné à ~24,8 jours pour une échéance lointaine", () => {
  const b = banc("2026-01-10T08:00:00Z");
  b.engine.create({ agentId: "hugo", name: "Loin", instruction: "x", schedule: { kind: "once", date: "2026-04-01", time: "09:00" } });
  quotidienne(b);
  assert.equal(b.timers.length, 1);
  b.engine.update(b.engine.list()[1].id, { active: false });
  assert.equal(b.timers.length, 1);
  assert.equal(b.timers[0].ms, 2 ** 31 - 1);
});

test("interruption : en file → annulée ; en cours → interrompue et arrêtée ; la pause ne touche pas un run en cours", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  const enFile = b.engine.runNow(r.id);
  // Confiée à l'interface mais pas commencée (file de la conversation) : retirée de la file.
  assert.equal(b.engine.interrupt(enFile.id).status, "cancelled");
  assert.ok(b.annulees.includes(enFile.id));
  const run = b.engine.runNow(r.id);
  b.engine.report(run.id, { state: "running", chatId: "direct-hugo", messageId: "m" });
  b.engine.update(r.id, { active: false });
  assert.equal(b.engine.history(r.id)[0].status, "running");
  const stop = b.engine.interrupt(run.id);
  assert.equal(stop.status, "interrupted");
  assert.ok(b.annulees.includes(run.id));
  // Un compte rendu tardif ne rouvre pas une exécution finie.
  b.engine.report(run.id, { state: "succeeded", chatId: "direct-hugo", messageId: "m", result: "trop tard" });
  assert.equal(b.engine.history(r.id)[0].status, "interrupted");
  assert.throws(() => b.engine.interrupt(run.id), /déjà terminée/);
});

test("suppression : refusée pendant un run, sinon routine et historique supprimés ensemble", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  const run = b.engine.runNow(r.id);
  b.engine.report(run.id, { state: "running", chatId: "direct-hugo", messageId: "m" });
  assert.throws(() => b.engine.remove(r.id), /Interrompez/);
  finir(b, run);
  b.engine.remove(r.id);
  assert.equal(b.engine.list().length, 0);
  assert.equal(b.store.runs.length, 0);
});

test("redémarrage : un run en cours à l'arrêt devient « interrompu », le reste est relu", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r = quotidienne(b);
  const run = b.engine.runNow(r.id);
  b.engine.report(run.id, { state: "running", chatId: "direct-hugo", messageId: "m" });
  b.fermer();
  b.demarrer();
  const [apres] = b.runs(r.id);
  assert.equal(apres.status, "interrupted");
  assert.match(apres.error, /fermée pendant/);
  assert.equal(b.engine.get(r.id).nextRunAt, "2026-01-10T11:00:00.000Z");
});

test("fichier illisible : refus de démarrer, fichier conservé tel quel", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-routines-"));
  dossiers.push(dir);
  fs.writeFileSync(path.join(dir, "routines.json"), "{pas du json");
  assert.throws(() => new RoutineStore(dir).load(), /illisible/);
  assert.equal(fs.readFileSync(path.join(dir, "routines.json"), "utf8"), "{pas du json");
});

test("écriture atomique : le fichier relu redonne exactement l'état", () => {
  const b = banc("2026-01-10T08:00:00Z");
  quotidienne(b);
  const relu = new RoutineStore(b.dir);
  relu.load();
  assert.deepEqual(relu.routines, b.store.routines);
  assert.equal(fs.existsSync(path.join(b.dir, "routines.json.tmp")), false);
});

test("entrées invalides refusées avec un message lisible", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const base = { agentId: "hugo", name: "N", instruction: "x", schedule: { kind: "daily", time: "12:00" } };
  assert.throws(() => b.engine.create({ ...base, agentId: "../etc" }), /Agent invalide/);
  assert.throws(() => b.engine.create({ ...base, name: "x".repeat(81) }), /1 à 80/);
  assert.throws(() => b.engine.create({ ...base, instruction: "   " }), /vide/);
  assert.throws(() => b.engine.create({ ...base, timezone: "Mars/Olympus" }), /IANA/);
  assert.throws(() => b.engine.create({ ...base, schedule: { kind: "daily", time: "9h" } }), /HH:mm/);
  assert.throws(() => b.engine.update("absente", { name: "x" }), /introuvable/);
});

test("reprise de l'ancien minuteur : fréquences converties, identifiants gardés, invalides signalés", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const anciennes = [
    { id: "r1", nom: "Hebdo", roleId: "hugo", consigne: "Bilan.", frequence: { type: "semaine", jour: 7, heure: "18:00" }, projectId: null, active: true },
    { id: "r2", nom: "À la main", roleId: "iris", consigne: "Revue.", frequence: { type: "manuel" }, projectId: "p1", active: true,
      relais: [{ id: "l1", de: "iris", vers: "hugo", consigne: "Intègre." }] },
    { id: "r3", nom: "Cassée", roleId: "hugo", consigne: "x", frequence: { type: "jour", heure: "9h" }, projectId: null, active: true },
  ];
  const { imported, errors } = b.engine.importLegacy(anciennes.map((a) => ({ id: a.id, ...convertirRoutine(a, "Europe/Paris") })));
  assert.equal(imported, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Cassée/);
  const hebdo = b.engine.get("r1");
  assert.deepEqual(hebdo.schedule, { kind: "weekly", weekday: 0, time: "18:00" });
  assert.equal(hebdo.nextRunAt, "2026-01-11T17:00:00.000Z");
  const manuelle = b.engine.get("r2");
  assert.deepEqual(manuelle.schedule, { kind: "manual" });
  assert.equal(manuelle.nextRunAt, null);
  assert.equal(manuelle.relais.length, 1);
  assert.equal(b.engine.importLegacy(anciennes.slice(0, 1).map((a) => ({ id: a.id, ...convertirRoutine(a, "Europe/Paris") }))).imported, 0);
});

test("une routine en erreur n'arrête pas les autres", () => {
  const b = banc("2026-01-10T08:00:00Z");
  const r1 = quotidienne(b);
  const r2 = b.engine.create({ agentId: "iris", name: "B", instruction: "b", schedule: { kind: "daily", time: "12:00" } });
  // Fichier corrompu à la main pour r1 : son planning ne se calcule plus.
  b.store.transaction((data) => void (data.routines.find((r) => r.id === r1.id).timezone = "Pas/Un_Fuseau"));
  b.aller("2026-01-10T11:00:00Z");
  assert.equal(b.runs(r2.id).length, 1);
  assert.ok(b.timers.length <= 1);
  b.avancer(DAY);
  assert.equal(b.runs(r2.id).length, 2);
});

for (const dir of dossiers) fs.rmSync(dir, { recursive: true, force: true });
console.log(`${checked} scénarios du moteur vérifiés.`);
