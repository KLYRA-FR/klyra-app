/**
 * L'équipe propre à ce serveur : ses fiches, « Mes agents », leurs préférences et leur historique.
 * L'app la lit et la modifie comme celle du PC (mêmes réponses que `electron/agents.ts` et
 * `electron/mes-agents.ts`) ; le PC n'écrase plus rien. Une fois créée, elle vit ici.
 *
 * - Toutes les fiches : `donnees/equipe/<id>.md`.
 * - Celles des agents actifs sont copiées dans `~/.claude/agents`, le seul dossier que Claude Code lit.
 * - La première fois, l'équipe vient de ce qu'avait reçu le serveur (`equipe.json` et ses fiches), ou
 *   d'une copie envoyée par l'app (`initialiser`) ; un agent désactivé reste ici sans être chargé.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FICHE_MAX = 200_000;
const FICHES_MAX = 100;
const RECUE_MAX = 200_000;

export class ErreurEquipe extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const empreinteDe = (contenu) => createHash("sha256").update(String(contenu).replace(/\r\n/g, "\n")).digest("hex");

function lireJson(fichier, defaut) {
  try {
    return JSON.parse(readFileSync(fichier, "utf8"));
  } catch {
    return defaut;
  }
}

function ecrireAtomique(fichier, contenu) {
  mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  writeFileSync(tmp, contenu, { mode: 0o600 });
  renameSync(tmp, fichier);
}

/** Le nom montré, lu dans la fiche, comme `presentationActifs` de l'app. */
function nomDeFiche(id, contenu) {
  const debut = String(contenu).slice(0, 4000).replace(/\r\n/g, "\n");
  return debut.match(/^---\n[\s\S]*?^displayName:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1].trim() || id;
}

/** @param {{ donnees: string, dossierClaude: string, maintenant?: () => number }} options */
export function creerEquipe({ donnees, dossierClaude, maintenant = Date.now }) {
  const dossierFiches = path.join(donnees, "equipe");
  const dossierHistorique = path.join(donnees, "historique-agents");
  const dossierRecues = path.join(donnees, "definitions-recues");
  const fichierMes = path.join(donnees, "mes-agents.json");
  const fichierMeta = path.join(donnees, "agents-meta.json");
  const fichierAncien = path.join(donnees, "equipe.json");

  const cheminFiche = (id) => {
    if (typeof id !== "string" || !NOM_VALIDE.test(id)) throw new ErreurEquipe("nom-invalide", `Nom d’agent invalide : « ${String(id)} ».`);
    return path.join(dossierFiches, `${id}.md`);
  };
  const contenuValide = (contenu) => {
    if (typeof contenu !== "string" || contenu.length > FICHE_MAX) throw new ErreurEquipe("fiche-invalide", "Cette fiche est trop longue pour ce serveur.");
    return contenu;
  };

  function lireFiche(id) {
    const fichier = cheminFiche(id);
    try {
      const content = readFileSync(fichier, "utf8");
      return { name: id, path: fichier, content, modifiedAt: statSync(fichier).mtimeMs, empreinte: empreinteDe(content) };
    } catch {
      return null;
    }
  }

  function lister() {
    mkdirSync(dossierFiches, { recursive: true });
    const noms = readdirSync(dossierFiches).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((n) => NOM_VALIDE.test(n));
    return { dir: dossierFiches, exists: true, agents: noms.map(lireFiche).filter(Boolean) };
  }

  const mes = () => lireJson(fichierMes, null) ?? { version: 1, depart: "nouveau", assistant: { nom: null, teinte: null }, agents: {} };
  const initialise = () => existsSync(fichierMes);

  /** Claude Code ne voit que les agents actifs : `~/.claude/agents` en est le reflet exact. */
  function appliquerActifs(etat = mes()) {
    const dossier = path.join(dossierClaude, "agents");
    mkdirSync(dossier, { recursive: true });
    const voulus = new Map();
    for (const [id, entree] of Object.entries(etat.agents)) {
      if (!entree.actif) continue;
      const fiche = lireFiche(id);
      if (fiche) voulus.set(`${id}.md`, fiche.content);
    }
    for (const nom of readdirSync(dossier)) if (nom.endsWith(".md") && !voulus.has(nom)) rmSync(path.join(dossier, nom), { force: true });
    for (const [nom, contenu] of voulus) ecrireAtomique(path.join(dossier, nom), contenu);
  }

  function ecrireMes(etat) {
    ecrireAtomique(fichierMes, JSON.stringify(etat, null, 2));
    appliquerActifs(etat);
    return etat;
  }

  const entreeDe = (etat, id) => {
    const entree = etat.agents[id];
    if (!entree) throw new ErreurEquipe("introuvable", `« ${id} » n’est pas dans Mes agents.`);
    return entree;
  };

  function sauvegarder(fiche) {
    const dossier = path.join(dossierHistorique, fiche.name);
    mkdirSync(dossier, { recursive: true });
    writeFileSync(path.join(dossier, `${new Date(maintenant()).toISOString().replace(/[:.]/g, "-")}.md`), fiche.content, { mode: 0o600 });
  }

  function ecrireFiche(id, contenu, attendu) {
    const fichier = cheminFiche(id);
    contenuValide(contenu);
    const actuelle = lireFiche(id);
    if (!actuelle) throw new ErreurEquipe("introuvable", `La fiche « ${id} » n’existe plus sur ce serveur.`);
    if (attendu !== null && attendu !== undefined && Math.abs(actuelle.modifiedAt - attendu) > 1) {
      throw new ErreurEquipe("conflit", "La fiche a changé sur le serveur depuis que tu l’as ouverte.");
    }
    if (actuelle.content === contenu) return actuelle;
    sauvegarder(actuelle);
    ecrireAtomique(fichier, contenu);
    return lireFiche(id);
  }

  function creerFiche(id, contenu) {
    const fichier = cheminFiche(id);
    contenuValide(contenu);
    if (existsSync(fichier)) throw new ErreurEquipe("existe-deja", `Un agent « ${id} » existe déjà sur ce serveur.`);
    ecrireAtomique(fichier, contenu);
    return lireFiche(id);
  }

  const garderRecue = (id, partage) => {
    if (typeof partage !== "string" || partage.length > RECUE_MAX) return;
    cheminFiche(id);
    ecrireAtomique(path.join(dossierRecues, `${id}.md`), partage);
  };

  function ajouterEntree(id, origine, contenu) {
    cheminFiche(id);
    const etat = mes();
    const deja = etat.agents[id];
    if (deja) {
      delete deja.desactiveLe;
      deja.actif = true;
    } else {
      etat.agents[id] = { actif: true, ajouteLe: maintenant(), origine: origine ?? { type: "local" }, empreinte: contenu === null ? null : empreinteDe(contenu) };
    }
    return ecrireMes(etat);
  }

  /** Première fois sur un serveur qui recevait déjà les fiches du PC : elles deviennent son équipe. */
  function reprendreCeQuiEstLa() {
    if (initialise()) return;
    const ancien = lireJson(fichierAncien, null);
    const dossier = path.join(dossierClaude, "agents");
    const ids = existsSync(dossier) ? readdirSync(dossier).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((n) => NOM_VALIDE.test(n)) : [];
    if (!ancien && !ids.length) return;
    const etat = { version: 1, depart: "reprise", assistant: { nom: typeof ancien?.assistant === "string" ? ancien.assistant : null, teinte: null }, agents: {} };
    for (const id of ids) {
      const contenu = readFileSync(path.join(dossier, `${id}.md`), "utf8");
      ecrireAtomique(cheminFiche(id), contenu);
      etat.agents[id] = { actif: true, ajouteLe: maintenant(), origine: { type: "local" }, empreinte: empreinteDe(contenu) };
    }
    ecrireMes(etat);
  }

  /** Une seule fois, sur un serveur neuf : une copie des agents actifs du PC. Ensuite, l'équipe vit ici. */
  function initialiser(corps) {
    if (initialise()) return { initialise: true, copie: false, mes: mes() };
    const fiches = Array.isArray(corps?.fiches) ? corps.fiches.slice(0, FICHES_MAX) : [];
    const etat = {
      version: 1,
      depart: "reprise",
      assistant: { nom: typeof corps?.assistant === "string" ? corps.assistant.trim().slice(0, 40) || null : null, teinte: typeof corps?.teinte === "string" ? corps.teinte : null },
      agents: {},
    };
    for (const f of fiches) {
      if (!f || typeof f.id !== "string" || !NOM_VALIDE.test(f.id) || typeof f.contenu !== "string" || f.contenu.length > FICHE_MAX) continue;
      ecrireAtomique(cheminFiche(f.id), f.contenu);
      etat.agents[f.id] = { actif: true, ajouteLe: maintenant(), origine: { type: "local" }, empreinte: empreinteDe(f.contenu) };
    }
    return { initialise: true, copie: true, mes: ecrireMes(etat) };
  }

  const actifs = () => Object.entries(mes().agents).flatMap(([id, e]) => {
    if (!e.actif) return [];
    const fiche = lireFiche(id);
    return fiche ? [{ id, nom: nomDeFiche(id, fiche.content) }] : [];
  });
  const assistant = () => mes().assistant.nom ?? null;
  /** Change à chaque modification de l'équipe : une session lancée avant repart au message suivant. */
  const empreinte = () => {
    const etat = mes();
    const parts = Object.entries(etat.agents).filter(([, e]) => e.actif).map(([id]) => [id, lireFiche(id)?.empreinte ?? ""]);
    return empreinteDe(JSON.stringify([etat.assistant.nom, parts])).slice(0, 16);
  };

  /** Une méthode demandée par l'app ; lève `ErreurEquipe` pour un refus à montrer. */
  function appeler(methode, c = {}) {
    switch (methode) {
      case "etat":
        return { initialise: initialise() };
      case "initialiser":
        return initialiser(c);
      case "lister":
        return lister();
      case "ecrire": {
        const fiche = ecrireFiche(c.id, c.contenu, c.attendu);
        const etat = mes();
        const entree = etat.agents[c.id];
        /* Les consignes d'un agent reçu, modifiées ici : une copie privée, comme sur le PC. */
        if (entree?.origine?.type === "bibliotheque" && entree.empreinte !== fiche.empreinte) {
          const o = entree.origine;
          entree.origine = { type: "copie", definitionId: o.definitionId, version: o.version, auteur: o.auteur, compte: o.compte };
          entree.empreinte = fiche.empreinte;
        }
        ecrireMes(etat);
        return fiche;
      }
      case "creer": {
        const fiche = creerFiche(c.id, c.contenu);
        ajouterEntree(c.id, { type: "local" }, fiche.content);
        return fiche;
      }
      case "installer": {
        const fiche = creerFiche(c.id, c.contenu);
        if (c.origine?.type === "bibliotheque") garderRecue(c.id, c.partage);
        return { file: fiche, mes: ajouterEntree(c.id, c.origine, fiche.content) };
      }
      case "appliquer": {
        const etat = mes();
        const entree = entreeDe(etat, c.id);
        const actuelle = lireFiche(c.id);
        if (actuelle && entree.empreinte !== null && actuelle.empreinte !== entree.empreinte && !c.forcer) {
          throw new ErreurEquipe("modifie-localement", "Cette fiche a été modifiée sur ce serveur depuis son ajout.");
        }
        const fiche = ecrireFiche(c.id, c.contenu, c.attendu);
        if (c.origine?.type === "bibliotheque") garderRecue(c.id, c.partage);
        const suite = mes();
        suite.agents[c.id] = { ...suite.agents[c.id], origine: c.origine, empreinte: fiche.empreinte };
        return { file: fiche, mes: ecrireMes(suite) };
      }
      case "mes":
        return mes();
      case "assistant": {
        const nom = String(c.nom ?? "").trim().replace(/\s+/g, " ");
        if (!nom || nom.length > 40) throw new ErreurEquipe("nom-invalide", "Le nom de l’assistant doit faire de 1 à 40 caractères.");
        const etat = mes();
        etat.assistant = { nom, teinte: c.teinte ?? etat.assistant.teinte };
        return ecrireMes(etat);
      }
      case "activer": {
        const etat = mes();
        const entree = entreeDe(etat, c.id);
        entree.actif = c.actif === true;
        if (entree.actif) delete entree.desactiveLe;
        else entree.desactiveLe = maintenant();
        return ecrireMes(etat);
      }
      case "ajouter": {
        const fiche = lireFiche(c.id);
        if (!fiche) throw new ErreurEquipe("introuvable", `La fiche « ${String(c.id)} » n’existe plus sur ce serveur.`);
        return ajouterEntree(c.id, { type: "local" }, fiche.content);
      }
      case "origine": {
        const etat = mes();
        const entree = entreeDe(etat, c.id);
        etat.agents[c.id] = { ...entree, origine: c.origine };
        return ecrireMes(etat);
      }
      case "recue": {
        cheminFiche(c.id);
        try {
          return readFileSync(path.join(dossierRecues, `${c.id}.md`), "utf8");
        } catch {
          return null;
        }
      }
      case "historique": {
        cheminFiche(c.id);
        const dossier = path.join(dossierHistorique, c.id);
        if (!existsSync(dossier)) return [];
        return readdirSync(dossier)
          .filter((f) => f.endsWith(".md"))
          .map((f) => ({ id: f.slice(0, -3), savedAt: statSync(path.join(dossier, f)).mtimeMs }))
          .sort((a, b) => b.savedAt - a.savedAt);
      }
      case "version": {
        cheminFiche(c.id);
        if (typeof c.version !== "string" || !/^[0-9TZ-]+$/.test(c.version)) throw new ErreurEquipe("introuvable", "Version introuvable.");
        try {
          return readFileSync(path.join(dossierHistorique, c.id, `${c.version}.md`), "utf8");
        } catch {
          throw new ErreurEquipe("introuvable", "Version introuvable.");
        }
      }
      case "meta":
        return lireJson(fichierMeta, {});
      case "meta-ecrire":
        if (!c.meta || typeof c.meta !== "object" || Array.isArray(c.meta)) throw new ErreurEquipe("meta-invalide", "Réglages d’agents illisibles.");
        ecrireAtomique(fichierMeta, JSON.stringify(c.meta, null, 2));
        return null;
      default:
        throw new ErreurEquipe("inconnu", "Ce serveur ne connaît pas cette demande.");
    }
  }

  reprendreCeQuiEstLa();
  return { appeler, initialise, actifs, assistant, empreinte, appliquerActifs };
}
