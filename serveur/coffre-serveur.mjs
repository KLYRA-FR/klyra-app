/**
 * Le Coffre d'un serveur : ses clés API, jetons et mots de passe, à lui seul (Réglages › Coffre, sur ce
 * serveur). Les agents du VPS s'en servent sans le PC, et ne voient jamais une valeur. Rien n'y arrive
 * tout seul : la personne le remplit, ou y copie un secret de son PC, un par un.
 *
 * Un VPS n'a pas de trousseau. Les valeurs sont chiffrées (AES-256-GCM) avec une clé gardée à côté, en 600,
 * pour l'utilisateur klyra : ni en clair dans le fichier, ni dans une sauvegarde qui ne prend pas la clé, ni
 * au hasard d'un grep. Cela n'arrête pas un agent qui viserait exprès cette clé : il tourne sous le même
 * utilisateur. L'écran le dit.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { estGenreSecret, normaliserVariable, texteCourt, validerValeur } from "./coffre-regles.mjs";

/** @param {{ donnees: string, maintenant?: () => number }} options */
export function creerCoffreServeur({ donnees, maintenant = Date.now }) {
  const fichier = path.join(donnees, "coffre.json");
  const fichierCle = path.join(donnees, "coffre.cle");

  function cle() {
    if (!existsSync(fichierCle)) {
      mkdirSync(donnees, { recursive: true, mode: 0o700 });
      writeFileSync(fichierCle, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
    }
    return Buffer.from(readFileSync(fichierCle, "utf8").trim(), "base64");
  }

  function chiffrer(valeur) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", cle(), iv);
    const corps = Buffer.concat([c.update(valeur, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), corps].map((b) => b.toString("base64")).join(".");
  }

  function dechiffrer(e) {
    try {
      const [iv, tag, corps] = String(e.valeur).split(".").map((b) => Buffer.from(b, "base64"));
      const d = createDecipheriv("aes-256-gcm", cle(), iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(corps), d.final()]).toString("utf8");
    } catch {
      throw new Error(`Le secret ${e.variable} ne peut plus être lu sur ce serveur.`);
    }
  }

  function lire() {
    try {
      const liste = JSON.parse(readFileSync(fichier, "utf8"));
      return Array.isArray(liste) ? liste : [];
    } catch {
      return [];
    }
  }

  function ecrire(liste) {
    mkdirSync(donnees, { recursive: true, mode: 0o700 });
    const tmp = `${fichier}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(liste), { mode: 0o600 });
    renameSync(tmp, fichier);
  }

  const publique = ({ valeur, ...reste }) => (void valeur, reste);

  const trouver = (liste, id) => {
    const e = liste.find((x) => x.id === id);
    if (!e) throw new Error("Ce secret n’est plus dans le coffre.");
    return e;
  };

  /** Un agent n'écrase jamais un secret ; la personne, seulement si elle le demande. */
  function ajouter(entree, origine, remplacer = false) {
    const variable = normaliserVariable(entree?.variable);
    const valeur = chiffrer(validerValeur(entree?.valeur));
    const liste = lire();
    const existant = liste.find((e) => e.variable === variable);
    if (existant && !(remplacer && origine.par === "personne")) {
      throw new Error(`Le coffre de ce serveur a déjà un secret ${variable}${origine.par === "agent" ? " : un agent ne le remplace pas" : ""}.`);
    }
    const champs = {
      nom: texteCourt(entree.nom, 120) || variable,
      genre: estGenreSecret(entree.genre) ? entree.genre : "cle-api",
      service: texteCourt(entree.service, 200),
      note: texteCourt(entree.note, 500),
      agents: entree.agents === undefined ? true : entree.agents === true,
    };
    const date = maintenant();
    if (existant) {
      Object.assign(existant, champs, { valeur, modifieLe: date });
      ecrire(liste);
      return publique(existant);
    }
    const nouveau = { id: randomUUID(), variable, ...champs, valeur, origine, ajouteLe: date, modifieLe: date, utiliseLe: null };
    liste.push(nouveau);
    ecrire(liste);
    return publique(nouveau);
  }

  function modifier(id, champs = {}) {
    const liste = lire();
    const e = trouver(liste, id);
    if (champs.nom !== undefined) e.nom = texteCourt(champs.nom, 120) || e.variable;
    if (champs.service !== undefined) e.service = texteCourt(champs.service, 200);
    if (champs.note !== undefined) e.note = texteCourt(champs.note, 500);
    if (champs.agents !== undefined) e.agents = champs.agents === true;
    if (estGenreSecret(champs.genre)) e.genre = champs.genre;
    e.modifieLe = maintenant();
    ecrire(liste);
    return publique(e);
  }

  function remplacerValeur(id, valeur) {
    const chiffre = chiffrer(validerValeur(valeur));
    const liste = lire();
    const e = trouver(liste, id);
    e.valeur = chiffre;
    e.modifieLe = maintenant();
    ecrire(liste);
    return publique(e);
  }

  function retirer(id) {
    ecrire(lire().filter((x) => x.id !== id));
    return null;
  }

  /** La valeur pour la personne : rendue au process de l'app, qui la met au presse-papiers. */
  const lireValeur = (id) => dechiffrer(trouver(lire(), id));

  const pourAgents = () => lire().filter((e) => e.agents).map(publique);

  /** La valeur d'un secret permis aux agents, à écrire dans un fichier : jamais dans une réponse d'outil. */
  function valeurPourAgents(variable) {
    const nom = normaliserVariable(variable);
    const liste = lire();
    const e = liste.find((x) => x.variable === nom);
    if (!e) throw new Error(`Le coffre n’a pas de secret ${nom} : demande-le avec coffre_demander.`);
    if (!e.agents) throw new Error(`La personne n’a pas permis aux agents d’utiliser ${nom} : demande-le avec coffre_demander.`);
    const valeur = dechiffrer(e);
    e.utiliseLe = maintenant();
    ecrire(liste);
    return valeur;
  }

  /** Une demande de l'app (route `/klyra/v1/coffre/<méthode>`). */
  function appeler(methode, c = {}) {
    const personne = { par: "personne" };
    switch (methode) {
      case "etat":
        return { secrets: lire().map(publique), connexions: [], chiffrement: true };
      case "ajouter":
        return ajouter(c.entree, personne, c.remplacer === true);
      case "modifier":
        return modifier(c.id, c.champs);
      case "valeur":
        return remplacerValeur(c.id, c.valeur);
      case "retirer":
        return retirer(c.id);
      case "lire":
        return lireValeur(c.id);
      default:
        throw new Error("Ce serveur ne connaît pas cette demande.");
    }
  }

  return { appeler, ajouter, pourAgents, valeurPourAgents };
}
