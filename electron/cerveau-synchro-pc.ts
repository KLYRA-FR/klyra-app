import { ouvrirCerveau } from "./cerveau";
import { ETAT_VIDE, ecrireEtatSynchro, lireEtatsSynchro, synchroniser, type EtatLieu } from "./cerveau-synchro";

/**
 * Le côté PC de la synchronisation du second cerveau (règles dans cerveau-synchro.ts) : un serveur à la fois,
 * jamais deux tours en même temps pour le même serveur, toutes les 10 minutes pour les serveurs où la personne
 * l'a allumée (Mémoire › Notes et sources), et à sa demande. Rien ne part sans cet accord.
 */

const INTERVALLE_MS = 10 * 60_000;
export type Appel = (lieu: string, action: string, args: Record<string, unknown>) => Promise<unknown>;

/** Le nom court d'un serveur pour une copie de conflit (« version srv2083864 »). */
export function nomServeur(lieu: string): string {
  try { return new URL(lieu).hostname.split(".")[0] || "du serveur"; } catch { return "du serveur"; }
}
function messageErreur(e: unknown): string {
  const m = e instanceof Error ? e.message : "Synchronisation impossible.";
  return /Action de (mémoire|synchronisation) inconnue/.test(m) ? "Ce serveur ne sait pas encore synchroniser la mémoire : relancez son installation pour le mettre à jour." : m;
}

export function creerSynchroCerveau(opts: { donnees: string; appeler: Appel }) {
  const enCours = new Map<string, Promise<EtatLieu>>();
  const etat = (lieu: string): EtatLieu => ({ ...ETAT_VIDE, ...lireEtatsSynchro(opts.donnees)[lieu] });
  /** Ce que l'écran montre : jamais la table des empreintes. */
  const vue = (lieu: string) => {
    const e = etat(lieu);
    return { actif: e.actif, dernier: e.dernier, enCours: enCours.has(lieu), notesAccordees: Object.keys(e.base).length, enAttente: e.aRenvoyer.length };
  };
  function lancer(lieu: string): Promise<EtatLieu> {
    const deja = enCours.get(lieu);
    if (deja) return deja;
    const tour = (async () => {
      const avant = etat(lieu);
      try {
        const apres = await synchroniser(ouvrirCerveau(opts.donnees), (action, args) => opts.appeler(lieu, action, args), avant, nomServeur(lieu));
        ecrireEtatSynchro(opts.donnees, lieu, apres);
        return apres;
      } catch (e) {
        const echec = { ...avant, dernier: { le: new Date().toISOString(), envoyees: 0, recues: 0, conflits: 0, erreur: messageErreur(e) } };
        ecrireEtatSynchro(opts.donnees, lieu, echec);
        return echec;
      }
    })().finally(() => enCours.delete(lieu));
    enCours.set(lieu, tour);
    return tour;
  }
  function activer(lieu: string, actif: boolean) {
    ecrireEtatSynchro(opts.donnees, lieu, { ...etat(lieu), actif });
    return vue(lieu);
  }
  function demarrer() {
    const passer = () => {
      for (const [lieu, e] of Object.entries(lireEtatsSynchro(opts.donnees))) if (e?.actif) void lancer(lieu);
    };
    setTimeout(passer, 30_000);
    setInterval(passer, INTERVALLE_MS);
  }
  return { lancer, activer, vue, demarrer };
}
