import assert from "node:assert/strict";
import test from "node:test";
import { creerRegistre } from "./registre.ts";
import type { AgentEvent, Moteur, StreamOptions } from "./types.ts";

/** Un moteur qui note ce qu'on lui demande, sans rien lancer. */
function faux(id: string, porte: string[] = []) {
  const appels: string[] = [];
  const moteur = {
    id,
    nom: id,
    fournisseur: id,
    trouver: () => null,
    compte: () => Promise.reject(new Error("pas dans ce test")),
    connecter: () => Promise.reject(new Error("pas dans ce test")),
    deconnecter: () => Promise.reject(new Error("pas dans ce test")),
    lancer: (requestId: string) => void appels.push(`lancer ${requestId}`),
    arreter: (requestId: string) => void appels.push(`arreter ${requestId}`),
    autoriser: (requestId: string) => {
      appels.push(`autoriser ${requestId}`);
      return porte.includes(requestId);
    },
  } as unknown as Moteur;
  return { moteur, appels };
}

const options = (moteur?: string | null): StreamOptions => ({ moteur, agent: null, prompt: "Bonjour", dossier: null, sessionId: null });

test("sans moteur demandé, l'agent travaille avec celui par défaut", () => {
  const claude = faux("claude");
  const autre = faux("autre");
  const registre = creerRegistre([claude.moteur, autre.moteur], "claude" as never);
  for (const choix of [undefined, null, ""]) registre.lancer(`r-${choix}`, options(choix), () => {}, () => null);
  assert.deepEqual(claude.appels, ["lancer r-undefined", "lancer r-null", "lancer r-"]);
  assert.deepEqual(autre.appels, []);
});

test("le moteur demandé fait la réponse", () => {
  const claude = faux("claude");
  const autre = faux("autre");
  const registre = creerRegistre([claude.moteur, autre.moteur], "claude" as never);
  registre.lancer("r1", options("autre"), () => {}, () => null);
  assert.deepEqual(autre.appels, ["lancer r1"]);
  assert.deepEqual(claude.appels, []);
});

test("un moteur inconnu finit la réponse sur une erreur, sans rien lancer", () => {
  const claude = faux("claude");
  const registre = creerRegistre([claude.moteur], "claude" as never);
  const recus: AgentEvent[] = [];
  registre.lancer("r1", options("inconnu"), (e) => recus.push(e), () => null);
  assert.deepEqual(recus, [{ type: "fin", ok: false, texte: "", erreur: "Fournisseur inconnu : inconnu." }]);
  assert.deepEqual(claude.appels, []);
  assert.equal(registre.moteur("inconnu"), null);
});

test("arrêter passe par chaque moteur", () => {
  const a = faux("claude");
  const b = faux("autre");
  creerRegistre([a.moteur, b.moteur], "claude" as never).arreter("r1");
  assert.deepEqual(a.appels, ["arreter r1"]);
  assert.deepEqual(b.appels, ["arreter r1"]);
});

test("une autorisation va au moteur qui porte la réponse, et à lui seul", () => {
  const a = faux("claude");
  const b = faux("autre", ["r2"]);
  const c = faux("dernier", ["r2"]);
  const registre = creerRegistre([a.moteur, b.moteur, c.moteur], "claude" as never);
  assert.equal(registre.autoriser("r2", "d1", "oui"), true);
  assert.deepEqual(c.appels, []);
  assert.equal(registre.autoriser("r9", "d1", "non"), false);
  assert.deepEqual(a.appels, ["autoriser r2", "autoriser r9"]);
});
