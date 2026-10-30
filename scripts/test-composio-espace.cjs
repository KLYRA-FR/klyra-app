/* Après pnpm build:electron. Stockage, identités et fournisseur entièrement simulés. */
/* eslint-disable @typescript-eslint/no-require-imports -- Tests Node du build Electron CommonJS. */
const assert = require("node:assert/strict");
const { EspaceComposio } = require(process.env.KLYRA_TEST_ESPACE_MODULE || "../dist-electron/composio-espace.js");

const CLE = "cle-composio-factice-isolee-test";
const LIEN = "https://connect.composio.dev/link/ln_prive_factice";
const SLUG = "GMAIL_FETCH_EMAILS";
const VERSION = "20261030_00";
const copie = (v) => v === undefined ? undefined : structuredClone(v);
function differe() {
  let resolve, reject;
  const promise = new Promise((oui, non) => { resolve = oui; reject = non; });
  return { promise, resolve, reject };
}
const SERVICE = { slug: "gmail", nom: "Gmail", description: "Service simulé", configurations: [{ id: "ac_gmail", nom: "Gmail simulé", methode: "OAUTH2", active: true }] };
const OUTIL = { slug: SLUG, service: "gmail", nom: "Lire les e-mails", description: "Outil simulé", version: VERSION, parametres: { type: "object", properties: {} } };

function environnement(stockage = new Map()) {
  const appels = [];
  const comptes = new Map();
  const hooks = {};
  const liens = [];
  let revision = 0;
  let identite = { scope: "local", nom: "Profil local", type: "local", revision: "identite:0" };
  let coffre = true;
  const executer = async (nom, args, fallback) => {
    appels.push({ nom, args: copie(args) });
    return hooks[nom] ? hooks[nom](...args) : fallback();
  };
  const api = {
    listerServices: () => executer("listerServices", [], () => copie([SERVICE])),
    listerComptes: (userId) => executer("listerComptes", [userId], () => copie([...comptes.values()].filter((c) => c.userId === userId))),
    lireCompte: (id) => executer("lireCompte", [id], () => {
      if (!comptes.has(id)) throw new Error("Compte simulé absent");
      return copie(comptes.get(id));
    }),
    connecter: (userId, configId) => executer("connecter", [userId, configId], () => ({ compteId: "ca_nouveau", lien: LIEN, expireLe: "2026-10-30T21:00:00Z" })),
    deconnecter: (id) => executer("deconnecter", [id], () => { comptes.delete(id); }),
    chercherOutils: (service, query) => executer("chercherOutils", [service, query], () => copie([OUTIL])),
    lireOutil: (slug) => executer("lireOutil", [slug], () => copie(OUTIL)),
    executerOutil: (...args) => executer("executerOutil", args, () => ({ succes: true, donnees: { compteUtilise: args[2], contenu: "Résultat métier simulé" } })),
  };
  const dependances = {
    identite: async () => hooks.identite ? hooks.identite() : copie(identite),
    revisionIdentite: () => identite.revision,
    lire: async (scope) => hooks.lire ? hooks.lire(scope) : copie(stockage.get(scope) || null),
    ecrire: async (scope, configuration) => {
      appels.push({ nom: "ecrire", args: [scope] });
      if (hooks.ecrire) await hooks.ecrire(scope, copie(configuration));
      stockage.set(scope, copie(configuration));
    },
    api: (cle) => { assert.equal(cle, CLE); return api; },
    ouvrir: async (url) => { liens.push(url); if (hooks.ouvrir) await hooks.ouvrir(url); },
    coffreDisponible: () => coffre,
  };
  const f = {
    espace: new EspaceComposio(dependances), dependances, appels, comptes, hooks, liens, stockage,
    changeIdentite(scope, type = scope === "local" ? "local" : "equipe") {
      revision++;
      identite = { scope, type, nom: type === "local" ? "Profil local" : "Compte d’équipe simulé", revision: `identite:${revision}` };
    },
    setCoffre(value) { coffre = value; },
    configuration(scope = identite.scope) { return copie(stockage.get(scope)); },
    ajoutCompte(id, modifications = {}, scope = identite.scope) {
      const config = stockage.get(scope);
      assert.ok(config, "configurer le profil avant d'ajouter ses comptes simulés");
      const compte = { id, service: "gmail", userId: config.userId, authConfigId: "ac_gmail", nom: `${id}@example.test`, alias: id, statut: "ACTIVE", desactive: false, ...modifications };
      comptes.set(id, compte);
      return compte;
    },
    compteur(nom) { return appels.filter((c) => c.nom === nom).length; },
  };
  return f;
}
async function configurer(f) {
  const etat = await f.espace.etat();
  await f.espace.configurer(etat.contexte, CLE);
}
async function selectionner(f, id) {
  await f.espace.selectionner((await f.espace.etat()).contexte, "gmail", id);
}
async function pret(f, id = "ca_a") {
  await configurer(f);
  f.ajoutCompte(id);
  await selectionner(f, id);
  return rechercher(f);
}
async function rechercher(f) {
  const cap = f.espace.creerCapacite();
  await f.espace.rechercher(cap, "gmail", "lire les e-mails");
  return cap;
}
const execute = (f, cap) => f.espace.executer(cap, SLUG, { query: "in:inbox" });
const changement = /changé|Actualise/;
let nombre = 0;
async function verifier(nom, action) {
  await action(); nombre++;
  console.log(`OK ${nom}`);
}

(async () => {
  await verifier("profil vierge : aucune API ni opération métier", async () => {
    const f = environnement();
    const etat = await f.espace.etat();
    assert.equal(etat.configure, false);
    assert.equal(etat.verifieLe, null);
    assert.deepEqual(etat.comptes, []);
    assert.deepEqual(etat.selections, {});
    const cap = f.espace.creerCapacite();
    assert.equal(f.espace.outils(cap), true, "schémas exposés ne signifie pas compte connecté");
    await assert.rejects(f.espace.rechercher(cap, "gmail", "lire"), /Configure Composio/);
    assert.equal(f.appels.length, 0);
  });
  await verifier("import : uniquement metadata, clé absente de l'état public", async () => {
    const f = environnement();
    await configurer(f);
    assert.deepEqual(f.appels.map((a) => a.nom), ["listerServices", "ecrire"]);
    const config = f.configuration();
    assert.equal(config.cle, CLE);
    assert.match(config.userId, /^klyra_/);
    const etat = await f.espace.etat();
    assert.equal(etat.configure, true);
    assert.equal(etat.comptes.length, 0);
    assert.ok(!JSON.stringify(etat).includes(CLE));
    assert.ok(!JSON.stringify(etat).includes(config.userId));
    assert.equal(f.compteur("executerOutil"), 0);
    assert.equal(f.compteur("connecter"), 0);
    assert.equal(f.compteur("deconnecter"), 0);
  });
  await verifier("clé invalide, coffre absent ou metadata refusée : aucun enregistrement", async () => {
    const f = environnement();
    await assert.rejects(f.espace.configurer((await f.espace.etat()).contexte, "courte"), /clé API/);
    f.setCoffre(false);
    await assert.rejects(f.espace.configurer((await f.espace.etat()).contexte, CLE), /coffre/);
    f.setCoffre(true);
    f.hooks.listerServices = async () => { throw new Error("API refusée simulée"); };
    await assert.rejects(configurer(f), /API refusée/);
    assert.equal(f.stockage.size, 0);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("sélection A puis B : seul le compte choisi et la version du schéma sont exécutés", async () => {
    const f = environnement();
    const capA = await pret(f);
    f.ajoutCompte("ca_b");
    assert.equal((await execute(f, capA)).donnees.compteUtilise, "ca_a");
    await selectionner(f, "ca_b");
    await assert.rejects(execute(f, capA), changement);
    const capB = await rechercher(f);
    assert.equal((await execute(f, capB)).donnees.compteUtilise, "ca_b");
    const appels = f.appels.filter((a) => a.nom === "executerOutil");
    assert.deepEqual(appels.map((a) => a.args.slice(0, 4)), [[SLUG, VERSION, "ca_a", f.configuration().userId], [SLUG, VERSION, "ca_b", f.configuration().userId]]);
    assert.deepEqual(appels[1].args[4], { query: "in:inbox" });
  });
  await verifier("aucune sélection automatique, schéma requis dans chaque session", async () => {
    const f = environnement();
    await configurer(f);
    f.ajoutCompte("ca_a");
    await assert.rejects(rechercher(f), /Aucun compte choisi/);
    await selectionner(f, "ca_a");
    const cap = f.espace.creerCapacite();
    await assert.rejects(execute(f, cap), /Recherche d’abord/);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("compte absent, expiré, désactivé, inconnu ou étranger refusé à chaque exécution", async () => {
    for (const scenario of ["absent", "expire", "desactive", "inconnu", "etranger", "autre_service"]) {
      const f = environnement();
      const cap = await pret(f);
      const c = f.comptes.get("ca_a");
      if (scenario === "absent") f.comptes.delete("ca_a");
      if (scenario === "expire") c.statut = "EXPIRED";
      if (scenario === "desactive") c.desactive = true;
      if (scenario === "inconnu") c.statut = "INCONNU";
      if (scenario === "etranger") c.userId = "user_etranger";
      if (scenario === "autre_service") c.service = "slack";
      await assert.rejects(execute(f, cap), /absent|reconnecter|ne correspond pas/, scenario);
      assert.equal(f.compteur("executerOutil"), 0, scenario);
    }
  });
  await verifier("sélection de compte invalide refusée et choix précédent conservé", async () => {
    const f = environnement();
    await pret(f);
    for (const [id, modifications] of [["ca_expire", { statut: "EXPIRED" }], ["ca_desactive", { desactive: true }], ["ca_etranger", { userId: "user_etranger" }], ["ca_slack", { service: "slack" }]]) {
      f.ajoutCompte(id, modifications);
      await assert.rejects(selectionner(f, id), /reconnecter|ne correspond pas/);
      assert.equal(f.configuration().selections.gmail, "ca_a");
    }
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("erreur API : liste vidée, contexte de remplacement de clé conservé, jamais connecté", async () => {
    const f = environnement();
    const cap = await pret(f);
    f.hooks.listerComptes = async () => { throw new Error("API indisponible simulée"); };
    const etat = await f.espace.etat();
    assert.match(etat.erreur.message, /indisponible/);
    assert.deepEqual(etat.comptes, []);
    assert.equal(etat.verifieLe, null);
    assert.ok(etat.contexte);
    f.hooks.lireCompte = async () => { throw new Error("API indisponible simulée"); };
    await assert.rejects(execute(f, cap), /indisponible/);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("état donné à l'agent : absent ou expiré n'est jamais utilisable", async () => {
    const f = environnement();
    const cap = await pret(f);
    assert.equal((await f.espace.comptesChoisis(cap))[0].utilisable, true);
    f.comptes.get("ca_a").statut = "EXPIRED";
    assert.deepEqual((await f.espace.comptesChoisis(cap)).map(({ statut, utilisable }) => ({ statut, utilisable })), [{ statut: "EXPIRED", utilisable: false }]);
    f.comptes.delete("ca_a");
    assert.deepEqual((await f.espace.comptesChoisis(cap)).map(({ statut, utilisable }) => ({ statut, utilisable })), [{ statut: "ABSENT", utilisable: false }]);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("consentement : navigateur ouvert reste en attente, jamais sélectionné seul", async () => {
    const f = environnement();
    await configurer(f);
    const etat = await f.espace.etat();
    await f.espace.connecter(etat.contexte, "gmail", "ac_gmail");
    assert.deepEqual(f.liens, [LIEN]);
    const avant = await f.espace.etat();
    assert.deepEqual(avant.enAttente.map((x) => x.compteId), ["ca_nouveau"]);
    assert.deepEqual(avant.selections, {});
    assert.equal(avant.comptes.length, 0);
    f.ajoutCompte("ca_nouveau", { statut: "INITIATED" });
    assert.equal((await f.espace.etat()).enAttente.length, 1);
    f.comptes.get("ca_nouveau").statut = "ACTIVE";
    const apres = await f.espace.etat();
    assert.equal(apres.enAttente.length, 0);
    assert.equal(apres.comptes[0].statut, "ACTIVE");
    assert.deepEqual(apres.selections, {});
    assert.ok(!JSON.stringify(apres).includes(LIEN));
    assert.ok(!JSON.stringify(f.configuration()).includes(LIEN));
    assert.equal(f.compteur("executerOutil"), 0);
    assert.equal(f.compteur("deconnecter"), 0);
  });
  await verifier("configuration inactive ou lien étranger refusé avant ouverture", async () => {
    const f = environnement();
    await configurer(f);
    f.hooks.listerServices = async () => [{ ...SERVICE, configurations: [{ ...SERVICE.configurations[0], active: false }] }];
    await assert.rejects(f.espace.connecter((await f.espace.etat()).contexte, "gmail", "ac_gmail"), /plus disponible/);
    assert.equal(f.compteur("connecter"), 0);
    delete f.hooks.listerServices;
    f.hooks.connecter = async () => ({ compteId: "ca_nouveau", lien: "https://example.test/vol", expireLe: null });
    await assert.rejects(f.espace.connecter((await f.espace.etat()).contexte, "gmail", "ac_gmail"), /non reconnue/);
    assert.equal(f.liens.length, 0);
    assert.equal(f.configuration().enAttente.length, 0);
  });
  await verifier("échec d’ouverture du navigateur : lien privé absent de l’erreur", async () => {
    const f = environnement();
    await configurer(f);
    f.hooks.ouvrir = async (url) => { throw new Error(`Erreur système ${url}`); };
    await assert.rejects(f.espace.connecter((await f.espace.etat()).contexte, "gmail", "ac_gmail"), (e) => /n’a pas pu être ouvert/.test(e.message) && !e.message.includes(LIEN));
    assert.deepEqual((await f.espace.etat()).selections, {});
  });

  await verifier("retirer le choix invalide les capacités sans déconnecter le fournisseur", async () => {
    const f = environnement();
    const cap = await pret(f);
    await selectionner(f, null);
    assert.deepEqual(f.configuration().selections, {});
    assert.equal(f.compteur("deconnecter"), 0);
    await assert.rejects(execute(f, cap), changement);
    await assert.rejects(rechercher(f), /Aucun compte choisi/);
  });
  await verifier("déconnexion échouée : choix local retiré et ancien accès invalidé", async () => {
    const f = environnement();
    const cap = await pret(f);
    f.hooks.deconnecter = async () => { throw new Error("Déconnexion distante impossible"); };
    await assert.rejects(f.espace.deconnecter((await f.espace.etat()).contexte, "ca_a"), /n’est plus choisi.*pas été confirmée/);
    assert.deepEqual(f.configuration().selections, {});
    assert.equal(f.comptes.has("ca_a"), true);
    await assert.rejects(execute(f, cap), changement);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("déconnexion réussie : compte relu puis retrait ciblé et choix vidé", async () => {
    const f = environnement();
    const cap = await pret(f);
    f.ajoutCompte("ca_b");
    await f.espace.deconnecter((await f.espace.etat()).contexte, "ca_a");
    assert.deepEqual(f.configuration().selections, {});
    assert.equal(f.comptes.has("ca_a"), false);
    assert.equal(f.comptes.has("ca_b"), true);
    assert.deepEqual(f.appels.filter((a) => a.nom === "deconnecter").map((a) => a.args), [["ca_a"]]);
    await assert.rejects(execute(f, cap), changement);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("reset local sans révocation, redémarrage sans perte de sélection", async () => {
    const f = environnement();
    const ancienneCap = await pret(f);
    const userId = f.configuration().userId;
    f.espace = new EspaceComposio(f.dependances);
    assert.equal((await f.espace.etat()).selections.gmail, "ca_a");
    await assert.rejects(execute(f, ancienneCap), changement);
    const nouvelleCap = await rechercher(f);
    assert.equal((await execute(f, nouvelleCap)).donnees.compteUtilise, "ca_a");
    await f.espace.retirerConfiguration((await f.espace.etat()).contexte);
    assert.equal((await f.espace.etat()).configure, false);
    assert.equal(f.configuration().cle, null);
    assert.equal(f.configuration().userId, userId);
    assert.deepEqual(f.configuration().selections, {});
    assert.equal(f.compteur("deconnecter"), 0);
    assert.equal(f.comptes.has("ca_a"), true);
  });
  await verifier("identité locale → équipe → locale : capacités anciennes définitivement invalides", async () => {
    const f = environnement();
    const capLocale = await pret(f);
    const ancienneSignature = f.espace.signature();
    const userLocal = f.configuration().userId;
    f.changeIdentite("equipe_alice");
    assert.equal((await f.espace.etat()).configure, false);
    await assert.rejects(execute(f, capLocale), changement);
    const capEquipe = await pret(f, "ca_equipe");
    assert.notEqual(f.configuration().userId, userLocal);
    assert.equal((await execute(f, capEquipe)).donnees.compteUtilise, "ca_equipe");
    f.changeIdentite("local");
    assert.equal((await f.espace.etat()).selections.gmail, "ca_a");
    assert.notEqual(f.espace.signature(), ancienneSignature);
    await assert.rejects(execute(f, capLocale), changement);
    await assert.rejects(execute(f, capEquipe), changement);
    assert.equal((await execute(f, await rechercher(f))).donnees.compteUtilise, "ca_a");
  });
  await verifier("changement d'identité pendant une lecture : aucun outil n'est lancé", async () => {
    const f = environnement();
    const cap = await pret(f);
    const entree = differe(), fin = differe();
    f.hooks.lireCompte = async () => { entree.resolve(); return fin.promise; };
    const enCours = execute(f, cap);
    await entree.promise;
    f.changeIdentite("equipe_autre");
    fin.resolve(copie(f.comptes.get("ca_a")));
    await assert.rejects(enCours, changement);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("résultat déjà lancé masqué si l'identité change en vol", async () => {
    const f = environnement();
    const cap = await pret(f);
    const entree = differe(), fin = differe();
    f.hooks.executerOutil = async () => { entree.resolve(); return fin.promise; };
    const enCours = execute(f, cap);
    await entree.promise;
    f.changeIdentite("equipe_autre");
    fin.resolve({ succes: true, donnees: "Résultat privé de l'ancien compte" });
    await assert.rejects(enCours, changement);
    assert.equal(f.compteur("executerOutil"), 1, "une opération déjà envoyée ne peut pas être annulée");
  });
  await verifier("barrière d'écriture : vieille capacité A et capacité créée en cours de sauvegarde refusées", async () => {
    const f = environnement();
    const capA = await pret(f);
    f.ajoutCompte("ca_b");
    const entree = differe(), fin = differe();
    f.hooks.ecrire = async () => { entree.resolve(); await fin.promise; };
    const selection = selectionner(f, "ca_b");
    await entree.promise;
    await assert.rejects(execute(f, capA), changement);
    const capPendant = f.espace.creerCapacite();
    assert.equal(f.espace.outils(capPendant), true, "les schémas restent disponibles, les appels sont bloqués");
    await assert.rejects(execute(f, capPendant), changement);
    assert.equal(f.compteur("executerOutil"), 0);
    fin.resolve();
    await selection;
    await assert.rejects(execute(f, capPendant), changement);
    delete f.hooks.ecrire;
    assert.equal((await execute(f, await rechercher(f))).donnees.compteUtilise, "ca_b");
  });
  await verifier("course A → B : une exécution attendant sa relecture A ne part pas", async () => {
    const f = environnement();
    const capA = await pret(f);
    f.ajoutCompte("ca_b");
    const lecture = differe(), finirLecture = differe(), ecriture = differe(), finirEcriture = differe();
    f.hooks.lireCompte = async (id) => {
      if (id === "ca_a") { lecture.resolve(); return finirLecture.promise; }
      return copie(f.comptes.get(id));
    };
    const execution = execute(f, capA);
    await lecture.promise;
    f.hooks.ecrire = async () => { ecriture.resolve(); await finirEcriture.promise; };
    const selection = selectionner(f, "ca_b");
    await ecriture.promise;
    finirLecture.resolve(copie(f.comptes.get("ca_a")));
    await assert.rejects(execution, changement);
    assert.equal(f.compteur("executerOutil"), 0);
    finirEcriture.resolve();
    await selection;
    delete f.hooks.lireCompte; delete f.hooks.ecrire;
    assert.equal((await execute(f, await rechercher(f))).donnees.compteUtilise, "ca_b");
  });
  await verifier("échec de sauvegarde : capacités invalidées et aucun ancien appel réutilisé", async () => {
    const f = environnement();
    const cap = await pret(f);
    f.ajoutCompte("ca_b");
    f.hooks.ecrire = async () => { throw new Error("Disque simulé indisponible"); };
    await assert.rejects(selectionner(f, "ca_b"), /Disque simulé/);
    await assert.rejects(execute(f, cap), changement);
    assert.equal(f.configuration().selections.gmail, "ca_a");
    assert.equal(f.compteur("executerOutil"), 0);
  });
  await verifier("ancien contexte UI et schémas étrangers refusés", async () => {
    const f = environnement();
    await configurer(f);
    f.ajoutCompte("ca_a");
    const ancien = await f.espace.etat();
    await f.espace.selectionner(ancien.contexte, "gmail", "ca_a");
    await assert.rejects(f.espace.selectionner(ancien.contexte, "gmail", null), changement);
    const cap = f.espace.creerCapacite();
    await f.espace.rechercher(cap, "gmail", "lire");
    f.hooks.chercherOutils = async () => [{ ...OUTIL, service: "slack" }, { ...OUTIL, version: "latest" }];
    assert.deepEqual(await f.espace.rechercher(cap, "gmail", "lire"), []);
    await assert.rejects(execute(f, cap), /Recherche d’abord/);
    assert.equal(f.compteur("executerOutil"), 0);
  });
  console.log(`${nombre} contrôles espace Composio réussis, aucun Electron ni réseau réel.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
