import assert from "node:assert/strict";
import test from "node:test";
import { lireUtilisation, lireUtilisationCodex, lireUtilisationGrok } from "./utilisation.ts";

const T = 1_800_000_000_000;

test("Claude : les deux fenêtres d'un coup, puis une seule qui garde l'autre", () => {
  const u = lireUtilisation({ status: "allowed", unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1_800_001_000 }, seven_day: { utilization: 0.1, resetsAt: 1_800_100_000 } } }, null, T);
  assert.deepEqual(u, { session: { utilise: 0.4, reinitialiseA: 1_800_001_000_000 }, semaine: { utilise: 0.1, reinitialiseA: 1_800_100_000_000 }, statut: "allowed", misAJour: T });
  const v = lireUtilisation({ status: "rejected", rateLimitType: "five_hour", utilization: 1, resetsAt: 1_800_002_000 }, u, T + 1);
  assert.equal(v?.session?.utilise, 1);
  assert.deepEqual(v?.semaine, u?.semaine);
  assert.equal(v?.statut, "rejected");
});

/** La forme de `account/rateLimits/read`, Codex 0.164. */
const lecture = (primaire: number, secondaire: number, atteinte: string | null = null) => ({
  ordinaryUsageAllowed: true,
  rateLimits: { limitId: "codex", primary: { usedPercent: primaire, windowDurationMins: 300, resetsAt: 1_800_003_000 }, secondary: { usedPercent: secondaire, windowDurationMins: 10080, resetsAt: 1_800_500_000 }, rateLimitReachedType: atteinte },
  rateLimitsByLimitId: null,
});

test("Codex : 5 h et semaine, en part de 0 à 1, remise à zéro en millisecondes", () => {
  const u = lireUtilisationCodex(lecture(25, 60), null, T);
  assert.deepEqual(u, { session: { utilise: 0.25, reinitialiseA: 1_800_003_000_000 }, semaine: { utilise: 0.6, reinitialiseA: 1_800_500_000_000 }, statut: "allowed", misAJour: T });
});

test("Codex : la durée des fenêtres décide, pas leur place", () => {
  const u = lireUtilisationCodex({ rateLimits: { primary: { usedPercent: 70, windowDurationMins: 10080, resetsAt: null }, secondary: null } }, null, T);
  assert.equal(u?.semaine?.utilise, 0.7);
  assert.equal(u?.session, null);
});

test("Codex : le compteur de Codex d'abord quand il y en a plusieurs", () => {
  const u = lireUtilisationCodex({ rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: null } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null } } } }, null, T);
  assert.equal(u?.session?.utilise, 0.1);
});

test("Codex : une mise à jour partielle (notification) garde ce qu'elle ne redit pas", () => {
  const avant = lireUtilisationCodex(lecture(25, 60), null, T);
  const u = lireUtilisationCodex({ rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_800_003_000 }, secondary: null, rateLimitReachedType: null } }, avant, T + 1);
  assert.equal(u?.session?.utilise, 0.4);
  assert.deepEqual(u?.semaine, avant?.semaine);
  assert.equal(u?.statut, "allowed");
});

test("Codex : limite atteinte, puis remise à zéro passée", () => {
  const u = lireUtilisationCodex(lecture(100, 60, "rate_limit_reached"), null, T);
  assert.equal(u?.statut, "rejected");
  // Une semaine pleine qu'une mise à jour ne redit pas reste pleine tant que sa remise à zéro n'est pas passée.
  const pleine = lireUtilisationCodex(lecture(10, 100), null, T);
  assert.equal(lireUtilisationCodex({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null } } }, pleine, T + 1)?.statut, "rejected");
  assert.equal(lireUtilisationCodex({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null } } }, pleine, 1_800_600_000_000)?.statut, "allowed");
});

test("Codex : rien de lisible, rien d'effacé, aucun chiffre inventé", () => {
  const avant = lireUtilisationCodex(lecture(25, 60), null, T);
  assert.equal(lireUtilisationCodex(null, avant, T + 1), avant);
  assert.equal(lireUtilisationCodex({ rateLimits: { primary: null, secondary: null } }, avant, T + 1), avant);
  assert.equal(lireUtilisationCodex({ rateLimits: { primary: { usedPercent: "beaucoup" } } }, null, T), null);
});

/** La réponse de `_x.ai/billing`, forme de Grok Build 0.1.220 (montants en cents). */
const facturation = (inclus: number, plus: Record<string, unknown> = {}) => ({
  billingCycle: { billingPeriodStart: "2026-11-01T00:00:00Z", billingPeriodEnd: "2026-12-01T00:00:00Z" },
  monthlyLimit: { val: 10000 },
  onDemandCap: { val: 0 },
  on_demand_enabled: false,
  disabledByConfig: false,
  usage: { includedUsed: { val: inclus }, onDemandUsed: { val: 0 }, totalUsed: { val: inclus } },
  ...plus,
});
const NOV = Date.parse("2026-11-15T00:00:00Z");
const DEC = Date.parse("2026-12-01T00:00:00Z");

test("Grok : crédits du mois utilisés, remise à zéro à la fin de la période", () => {
  assert.deepEqual(lireUtilisationGrok(facturation(2500), NOV), { session: null, semaine: null, mois: { utilise: 0.25, reinitialiseA: DEC }, statut: "allowed", misAJour: NOV });
});

test("Grok : enveloppé dans `config`, montants en chaîne", () => {
  const u = lireUtilisationGrok({ subscription_tier: "SuperGrok", config: { ...facturation(0), monthlyLimit: { val: "10000" }, usage: { includedUsed: { val: "7500" } } } }, NOV);
  assert.equal(u?.mois?.utilise, 0.75);
  assert.equal(u?.mois?.reinitialiseA, DEC);
});

test("Grok : forme du proxy, en pourcentage", () => {
  const u = lireUtilisationGrok({ config: { creditUsagePercent: 12.5, currentPeriod: { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" } } }, NOV);
  assert.deepEqual(u?.mois, { utilise: 0.125, reinitialiseA: DEC });
});

test("Grok : crédits épuisés = limite atteinte, sauf paiement à l'usage ou période échue", () => {
  assert.equal(lireUtilisationGrok(facturation(10000), NOV)?.statut, "rejected");
  assert.equal(lireUtilisationGrok(facturation(12000), NOV)?.mois?.utilise, 1);
  assert.equal(lireUtilisationGrok(facturation(10000, { onDemandCap: { val: 5000 }, on_demand_enabled: true }), NOV)?.statut, "allowed");
  assert.equal(lireUtilisationGrok(facturation(10000), DEC + 1)?.statut, "allowed");
});

test("Grok : sans plafond ni pourcentage, rien d'inventé", () => {
  assert.equal(lireUtilisationGrok(null), null);
  assert.equal(lireUtilisationGrok({ usage: { includedUsed: { val: 10 } } }), null);
  assert.equal(lireUtilisationGrok({ monthlyLimit: { val: 0 }, usage: { includedUsed: { val: 0 } } }), null);
});
