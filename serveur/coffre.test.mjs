import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { creerRelaisCoffre, OUTILS_COFFRE } from "./coffre.mjs";

const appelant = { agent: "hugo", conversation: "dm-hugo@vps.exemple.fr" };
const VALEUR = "sk_live_DuVps_42";

function preparer(ecouteurs = 1, delaiMs) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "klyra-coffre-vps-"));
  const home = path.join(tmp, "home");
  const donnees = path.join(home, "donnees");
  mkdirSync(donnees, { recursive: true });
  const publies = [];
  const relais = creerRelaisCoffre({ publier: (id, event) => publies.push({ id, event }), ecouteurs: () => ecouteurs, home, donnees, delaiMs, maintenant: () => 1000 });
  return { tmp, home, donnees, publies, relais, fin: () => rmSync(tmp, { recursive: true, force: true }) };
}
const publication = async (publies, n = 1) => {
  for (let i = 0; i < 100 && publies.length < n; i++) await new Promise((r) => setTimeout(r, 10));
  return publies[n - 1];
};

test("les quatre outils, les mêmes que sur le PC", () => {
  assert.deepEqual(OUTILS_COFFRE.map((o) => o.name), ["coffre_lister", "coffre_demander", "coffre_enregistrer", "coffre_ecrire_fichier"]);
});

test("lister et demander : relayés au PC, sa réponse revient à l'agent", async () => {
  const v = preparer();
  try {
    const promesse = v.relais.appeler(appelant, "coffre_demander", { variable: "OPENAI_API_KEY", nom: "Clé OpenAI", raison: "Pour l'essai" });
    const { id, event } = await publication(v.publies);
    assert.deepEqual([event.type, event.id, event.nom, event.agent, event.conversation, event.arguments.variable], ["coffre", id, "coffre_demander", "hugo", appelant.conversation, "OPENAI_API_KEY"]);
    assert.ok(event.expire > 1000);
    assert.equal(await v.relais.repondre(id, { resultat: { texte: "Demande affichée dans la conversation" } }), true);
    assert.deepEqual(await promesse, { content: [{ type: "text", text: "Demande affichée dans la conversation" }] });
    assert.equal(await v.relais.repondre(id, { resultat: { texte: "deux fois" } }), false, "une réponse arrive une fois");
  } finally {
    v.fin();
  }
});

test("ranger un secret : la valeur ne part pas dans le journal, le PC la lit une fois", async () => {
  const v = preparer();
  try {
    const promesse = v.relais.appeler(appelant, "coffre_enregistrer", { variable: "github token", nom: "Jeton GitHub", valeur: VALEUR });
    const { id, event } = await publication(v.publies);
    assert.ok(!JSON.stringify(event).includes(VALEUR), "aucune valeur dans l'événement");
    assert.equal(v.relais.lireValeur(id), VALEUR);
    assert.equal(v.relais.lireValeur(id), null, "lue une seule fois");
    assert.equal(v.relais.lireValeur("inconnu"), null);
    await v.relais.repondre(id, { resultat: { texte: "Rangé dans le coffre : GITHUB_TOKEN" } });
    assert.match((await promesse).content[0].text, /Rangé/);
    const vide = await v.relais.appeler(appelant, "coffre_enregistrer", { variable: "X_Y", nom: "x", valeur: "  " });
    assert.equal(vide.isError, true, "une valeur vide est refusée ici, sans rien publier");
    assert.equal(v.publies.length, 1);
  } finally {
    v.fin();
  }
});

test("écrire dans un fichier : contrôlé ici d'abord, la valeur rendue par le PC est écrite ici, jamais dite à l'agent", async () => {
  const v = preparer();
  try {
    const projet = path.join(v.home, "projets", "site");
    mkdirSync(projet, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: projet });
    const env = path.join(projet, ".env.local");
    // Suivi par Git : refusé sans rien demander au PC.
    let r = await v.relais.appeler(appelant, "coffre_ecrire_fichier", { variable: "STRIPE_KEY", chemin: env });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /suivi par Git/);
    // Hors du dossier de klyra, ou dans les données du serveur : refusé.
    r = await v.relais.appeler(appelant, "coffre_ecrire_fichier", { variable: "STRIPE_KEY", chemin: path.join(v.tmp, "ailleurs.env") });
    assert.match(r.content[0].text, /doit être sous/);
    r = await v.relais.appeler(appelant, "coffre_ecrire_fichier", { variable: "STRIPE_KEY", chemin: path.join(v.donnees, "fuite.env") });
    assert.match(r.content[0].text, /données de l’app/);
    assert.equal(v.publies.length, 0, "rien n'est demandé au PC pour un fichier refusé");

    writeFileSync(path.join(projet, ".gitignore"), ".env*.local\n");
    writeFileSync(env, "AUTRE=1\n");
    const promesse = v.relais.appeler(appelant, "coffre_ecrire_fichier", { variable: "STRIPE_KEY", chemin: env, format: "env" });
    const { id, event } = await publication(v.publies);
    assert.equal(event.arguments.chemin, env);
    assert.equal(await v.relais.repondre(id, { resultat: { texte: "Valeur rendue au serveur." }, valeur: VALEUR }), true);
    r = await promesse;
    assert.ok(!r.isError && !r.content[0].text.includes(VALEUR), "la réponse à l'agent ne contient pas la valeur");
    assert.equal(readFileSync(env, "utf8"), `AUTRE=1\nSTRIPE_KEY=${VALEUR}\n`);
    assert.equal(statSync(env).mode & 0o777, 0o600);

    // Le PC refuse (secret non permis) : rien n'est écrit.
    const brut = path.join(v.home, "jeton.txt");
    const p2 = v.relais.appeler(appelant, "coffre_ecrire_fichier", { variable: "STRIPE_KEY", chemin: brut, format: "brut" });
    const deux = await publication(v.publies, 2);
    await v.relais.repondre(deux.id, { resultat: { texte: "La personne n’a pas permis aux agents d’utiliser STRIPE_KEY", erreur: true } });
    r = await p2;
    assert.equal(r.isError, true);
    assert.throws(() => statSync(brut));
  } finally {
    v.fin();
  }
});

test("sans app ouverte sur le PC, sans réponse, outil inconnu : refusés", async () => {
  const sans = preparer(0);
  const delai = preparer(1, 30);
  try {
    let r = await sans.relais.appeler(appelant, "coffre_lister", {});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /pas ouverte/);
    assert.equal(sans.publies.length, 0);
    r = await delai.relais.appeler(appelant, "coffre_lister", {});
    assert.match(r.content[0].text, /pas répondu/);
    assert.equal(delai.relais.enAttente(), 0);
    r = await delai.relais.appeler(appelant, "navigateur_lire", {});
    assert.match(r.content[0].text, /inconnu/);
    r = await delai.relais.appeler({ agent: "hugo", conversation: "" }, "coffre_lister", {});
    assert.match(r.content[0].text, /Conversation inconnue/);
  } finally {
    sans.fin();
    delai.fin();
  }
});
