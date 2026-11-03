import type { AjoutFiche } from "./atelier-agent";
import { LIBELLES_CAS, PILIERS_LISTE, type CasEpreuve, type PilierListe, type ResultatCas } from "./epreuve";
import { enregistrerConsommation } from "./consommation";
import { ligneValide } from "./consommation-ecart";
import { appel, VIEUX_SERVEUR } from "./fournisseurs-vps";

/**
 * L'épreuve d'un agent dans une conversation sur un VPS relié : l'essai tourne sur le serveur, avec son
 * Claude Code (serveur/agents.mjs, `essayer`, mêmes règles que `essayerBrouillon` de ce PC). Même réponse
 * que l'IPC local : l'écran ne voit pas la différence.
 */

const PAS_ENCORE = "Ce VPS ne sait pas encore faire passer l’épreuve : relance la commande d’installation sur le VPS pour le mettre à jour.";
/** Un essai et son avis : deux tours de Claude Code, le plus long avec le modèle de l'agent. */
const ATTENTE_ESSAI_MS = 6 * 60_000;

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Ce que le VPS rend, vérifié champ par champ. */
function resultatDe(brut: unknown, cas: CasEpreuve): ResultatCas {
  const r = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  if (!Object.hasOwn(LIBELLES_CAS, String(r.type))) throw new Error("Le VPS n’a pas répondu comme prévu.");
  const c = r.correction as Record<string, unknown> | null | undefined;
  const correction = c && PILIERS_LISTE.includes(c.pilier as PilierListe) && typeof c.texte === "string" && c.texte ? { pilier: c.pilier as PilierListe, texte: texte(c.texte, 300) } : null;
  return {
    ...cas,
    reponse: texte(r.reponse, 20_000),
    verdict: r.verdict === "ok" || r.verdict === "ko" ? r.verdict : null,
    raison: texte(r.raison, 300),
    correction: r.verdict === "ko" ? correction : null,
    jetons: typeof r.jetons === "number" && Number.isFinite(r.jetons) && r.jetons > 0 ? Math.round(r.jetons) : 0,
    empreinte: texte(r.empreinte, 40),
    ...(typeof r.erreur === "string" && r.erreur ? { erreur: texte(r.erreur, 1000) } : {}),
  };
}

export async function essayerVps(
  origine: string,
  jeton: string | null,
  brouillon: { id: string; description: string; corps: string; modele: string; fiche: string },
  cas: CasEpreuve,
  conversation: string | null,
  ajouts: AjoutFiche[],
): Promise<ResultatCas> {
  try {
    const json = await appel(origine, jeton, "/klyra/v1/agent/essayer", "POST", { brouillon, cas, conversation, ajouts }, ATTENTE_ESSAI_MS);
    // Ce que l'essai a consommé sur le VPS, inscrit dans le journal de ce PC (comme une réponse du VPS).
    for (const brut of Array.isArray(json.consommation) ? json.consommation.slice(0, 10) : []) {
      const ligne = ligneValide(brut);
      if (ligne) enregistrerConsommation({ fournisseur: "Claude Code", modele: ligne.modele, agent: "principal", jetons: ligne.jetons, coutUsd: ligne.coutUsd });
    }
    return resultatDe(json.resultat, cas);
  } catch (e) {
    if (e instanceof Error && e.message === VIEUX_SERVEUR) throw new Error(PAS_ENCORE);
    throw e;
  }
}
