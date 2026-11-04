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

/** La forme de `BillingConfigResponse` (x.ai/billing), d'après les champs de Grok Build 1.0.70. */
const facturation = (pourcent: unknown, fin: unknown, aLUsage = false) => ({
  config: { creditUsagePercent: pourcent, currentPeriod: { start: "2026-11-01T00:00:00Z", end: fin }, monthlyLimit: 100, onDemandCap: 0, onDemandUsed: 0, prepaidBalance: 0, isUnifiedBillingUser: true },
  on_demand_enabled: aLUsage,
  subscription_tier: "SuperGrok",
});

test("Grok : les crédits du mois, en part de 0 à 1, remise à zéro à la fin de la période", () => {
  const u = lireUtilisationGrok(facturation(42, "2026-12-01T00:00:00Z"), null, T);
  assert.deepEqual(u, { session: null, semaine: null, mois: { utilise: 0.42, reinitialiseA: Date.parse("2026-12-01T00:00:00Z") }, statut: "allowed", misAJour: T });
  assert.equal(lireUtilisationGrok(facturation(10, 1_800_500_000), null, T)?.mois?.reinitialiseA, 1_800_500_000_000);
  assert.equal(lireUtilisationGrok(facturation(10, 1_800_500_000_000), null, T)?.mois?.reinitialiseA, 1_800_500_000_000);
  assert.equal(lireUtilisationGrok(facturation(10, null), null, T)?.mois?.reinitialiseA, null);
});

test("Grok : crédits épuisés, sauf si le paiement à l'usage est activé", () => {
  assert.equal(lireUtilisationGrok(facturation(100, 1_900_000_000), null, T)?.statut, "rejected");
  assert.equal(lireUtilisationGrok(facturation(100, 1_900_000_000, true), null, T)?.statut, "allowed");
  assert.equal(lireUtilisationGrok(facturation(130, 1_900_000_000), null, T)?.mois?.utilise, 1);
});

test("Grok : rien de lisible (clé API, autre forme), rien d'effacé, aucun chiffre inventé", () => {
  const avant = lireUtilisationGrok(facturation(42, null), null, T);
  assert.equal(lireUtilisationGrok(null, avant, T + 1), avant);
  assert.equal(lireUtilisationGrok({ config: {} }, avant, T + 1), avant);
  assert.equal(lireUtilisationGrok({ config: { creditUsagePercent: "beaucoup" } }, null, T), null);
});
