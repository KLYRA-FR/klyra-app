/**
 * L'équipe envoyée au VPS, de bout en bout : la vraie fonction de l'app (dist-electron), dans Electron,
 * face au vrai serveur KLYRA local :
 *   pnpm build:electron && pnpm test:equipe-serveur      (Linux : xvfb-run -a … -- --no-sandbox)
 * - l'équipe part quand le flux s'ouvre, puis seulement quand le serveur n'a pas la même ;
 * - un `equipe.json` écrit par un ancien serveur (bonne empreinte, sans configuration ou sans Coffre) est remplacé ;
 * - un fichier perdu, ou l'équipe d'un autre PC, aussi ;
 * - un serveur mis à jour pendant que l'app reste ouverte retrouve l'équipe sans redémarrer l'app ;
 * - un serveur qui ne donne pas d'empreinte : on retombe sur le dernier envoi ; un VPS éteint : l'erreur remonte ;
 * - un serveur d'avant ce correctif, qui annonce la bonne empreinte sur un fichier incomplet : un lancement de l'app l'envoie quand même.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lancé par Electron en CommonJS */
const { app } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "klyra-equipe-"));
app.setPath("userData", path.join(TMP, "donnees-app"));
app.setPath("sessionData", path.join(TMP, "session"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });

const echecs = [];
const verifier = (ok, message, detail) => {
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${message}${!ok && detail !== undefined ? `\n       ${String(detail).slice(0, 600)}` : ""}`);
  if (!ok) echecs.push(message);
};

/** Attend qu'une condition devienne vraie : le flux de l'app vit sa vie, reconnexion comprise. */
async function attendre(condition, delai = 15_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return condition();
}

app.whenReady().then(async () => {
  try {
    const racine = path.join(__dirname, "..");
    const srv = await import(pathToFileURL(path.join(racine, "serveur", "klyra-serveur.mjs")).href);
    const { creerAgents } = await import(pathToFileURL(path.join(racine, "serveur", "agents.mjs")).href);
    const distants = require(path.join(racine, "dist-electron", "agents-distants.js"));

    const dossier = path.join(TMP, "donnees-vps");
    const home = path.join(TMP, "home-vps");
    fs.mkdirSync(dossier, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    const fichier = path.join(dossier, "equipe.json");
    const lu = () => JSON.parse(fs.readFileSync(fichier, "utf8"));
    const ancien = (champs) => fs.writeFileSync(fichier, JSON.stringify({ assistant: "Cicco", actifs: [{ id: "lou", nom: "Lou" }], ...champs }));

    let envois = 0;
    const demarrer = async (port) => {
      const journal = srv.creerJournal();
      const agents = creerAgents({ home, donnees: dossier, nomServeur: "Klyra-VPS", publier: journal.publier, spontane: journal.spontane });
      const recevoir = agents.recevoirFiches;
      agents.recevoirFiches = (corps) => {
        envois += 1;
        return recevoir(corps);
      };
      const ecoute = await srv.ecouter({ nom: "Klyra-VPS", dossier, port, journal, agents });
      return { ...ecoute, journal };
    };
    const arreter = async (ecoute) => {
      const ferme = ecoute.fermer();
      ecoute.serveur.closeAllConnections();
      await ferme;
    };

    let ecoute = await demarrer(0);
    const origine = `http://127.0.0.1:${ecoute.port}`;
    const { jeton } = await fetch(`${origine}${srv.CHEMIN_APPAIRER}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: srv.creerCode(dossier), appareil: "PC de test" }) }).then((r) => r.json());
    const annonce = async () => (await fetch(`${origine}${srv.CHEMIN}`, { headers: { Authorization: `Bearer ${jeton}` } }).then((r) => r.json())).equipe;

    const equipe = {
      fiches: [{ id: "lou", nom: "Lou", contenu: "---\nname: lou\n---\nPrompt." }],
      assistant: "Cicco",
      configuration: { memoireAgents: true, consignes: null, navigateur: false, coffre: true },
      skillsParAgent: {},
      skills: [],
      empreinte: "e1",
    };
    distants.brancherAgentsDistants({ fenetre: () => null, equipe: () => equipe, jeton: () => jeton }, [origine]);

    verifier(await attendre(() => envois === 1), "l'équipe part quand le flux s'ouvre", envois);
    verifier((await annonce()) === "e1" && lu().configuration.coffre === true, "le serveur a l'équipe et sa configuration");

    await distants.synchroniserEquipe(origine);
    verifier(envois === 1, "même empreinte des deux côtés : rien n'est renvoyé", envois);

    ancien({ empreinte: "e1" });
    await distants.synchroniserEquipe(origine);
    verifier(envois === 2 && lu().configuration?.coffre === true, "fichier d'un ancien serveur, sans configuration : renvoyé, le Coffre revient", JSON.stringify(lu()));

    ancien({ empreinte: "e1", configuration: { memoireAgents: true, consignes: null, navigateur: false } });
    await distants.synchroniserEquipe(origine);
    verifier(envois === 3 && lu().configuration.coffre === true, "fichier d'un serveur d'avant le Coffre : renvoyé", JSON.stringify(lu()));

    fs.rmSync(fichier);
    await distants.synchroniserEquipe(origine);
    verifier(envois === 4 && lu().empreinte === "e1", "fichier perdu sur le serveur : renvoyé", envois);

    ancien({ empreinte: "autre-pc", configuration: equipe.configuration, skillsParAgent: {} });
    await distants.synchroniserEquipe(origine);
    verifier(envois === 5 && lu().empreinte === "e1", "le serveur a une autre équipe : renvoyé", envois);

    equipe.empreinte = "e2";
    await distants.synchroniserEquipe(origine);
    verifier(envois === 6 && lu().empreinte === "e2", "l'équipe de ce PC a changé : renvoyée", envois);
    equipe.empreinte = "e1";
    await distants.synchroniserEquipe(origine);

    // Le cas d'origine : le serveur est mis à jour, l'app reste ouverte et se reconnecte toute seule.
    const port = ecoute.port;
    const avant = envois;
    await arreter(ecoute);
    ancien({ empreinte: "e1" });
    ecoute = await demarrer(port);
    verifier(await attendre(() => envois === avant + 1 && lu().configuration?.coffre === true), "serveur mis à jour, app restée ouverte : l'équipe revient à la reconnexion", JSON.stringify(lu()));

    distants.oublierServeur(origine);
    await arreter(ecoute);

    // Un serveur qui ne donne pas d'empreinte : le dernier envoi décide, comme avant.
    let recus = 0;
    let annoncee;
    const vieux = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === srv.CHEMIN) return res.end(JSON.stringify({ produit: "klyra-serveur", protocole: 1, nom: "Vieux", version: "1", agents: "pret", ...(annoncee ? { equipe: annoncee } : {}) }));
      if (req.url === srv.CHEMIN_FICHES && req.method === "PUT") {
        recus += 1;
        req.resume();
        return res.end("{}");
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise((r) => vieux.listen(0, "127.0.0.1", r));
    const origineVieux = `http://127.0.0.1:${vieux.address().port}`;
    distants.relierServeur(origineVieux);
    await distants.synchroniserEquipe(origineVieux);
    await distants.synchroniserEquipe(origineVieux);
    verifier(recus === 1, "serveur sans empreinte : envoyé une fois, pas à chaque message", recus);
    equipe.empreinte = "e3";
    await distants.synchroniserEquipe(origineVieux);
    verifier(recus === 2, "serveur sans empreinte : renvoyé quand l'équipe change", recus);

    // Un serveur d'avant ce correctif annonce la bonne empreinte sans dire que son fichier est incomplet.
    annoncee = equipe.empreinte;
    distants.oublierServeur(origineVieux); // comme un nouveau lancement de l'app : aucun envoi en mémoire
    distants.relierServeur(origineVieux);
    await distants.synchroniserEquipe(origineVieux);
    verifier(recus === 3, "nouveau lancement de l'app, mêmes empreintes : envoyé une fois quand même", recus);
    await distants.synchroniserEquipe(origineVieux);
    verifier(recus === 3, "puis plus rien tant que les empreintes sont égales", recus);

    // Le VPS éteint : l'erreur remonte, l'app dit qu'il ne répond pas au lieu d'envoyer à l'aveugle.
    vieux.closeAllConnections();
    await new Promise((r) => vieux.close(r));
    const erreur = await distants.synchroniserEquipe(origineVieux).then(() => null, (e) => e);
    verifier(erreur instanceof Error, "VPS éteint : l'erreur remonte");
    distants.oublierServeur(origineVieux);
  } catch (e) {
    verifier(false, "le test s'est déroulé sans erreur", e.stack);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(echecs.length ? `\n${echecs.length} ÉCHEC(S)` : "\nTOUT PASSE");
  app.exit(echecs.length ? 1 : 0);
});
