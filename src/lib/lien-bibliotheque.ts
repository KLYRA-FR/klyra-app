import { getField, parseAgentFile } from "@/lib/agent-file";
import type { AgentLocal } from "@/lib/agents";
import type { EtatBibliotheque, EtatDefinition } from "@/lib/bibliotheque";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";

/**
 * Ce qu'un agent de cet ordinateur doit montrer de son lien avec la bibliothèque (spec §4, §4.1).
 * Ce qui suit le compte (auteur, version, propositions, rôle d'auteur) ne s'affiche que pour la session
 * qui l'a ajouté ou publié, et le rôle d'auteur vient toujours du serveur (`etats`), jamais du disque.
 */

export type Lien =
  /** À soi, jamais partagé (ou partagé sous un autre compte : rien n'en est dit). */
  | { type: "aucun" }
  /** Modèle KLYRA embarqué ; `aJour` : sa consigne est celle du modèle de cette version de l'app. */
  | { type: "modele"; aJour: boolean }
  /** Reçu de la bibliothèque, mais pas sous la session en cours : utilisable, sans nom, version ni proposition. */
  | { type: "suspendu"; raison: "deconnecte" | "autre-compte" | "retire" | "chargement" }
  | {
      type: "recu";
      auteur: string;
      version: number;
      /** Une version plus récente, pas écartée par la personne. */
      proposition: { version: number; majLe: number } | null;
      /** L'auteur l'a retirée de la bibliothèque. */
      retiree: boolean;
      /** La fiche a changé depuis la version suivie (ici ou ailleurs). */
      modifie: boolean;
      /** Hors ligne, ou état du serveur pas encore lu : les propositions attendent. */
      enAttente: boolean;
    }
  | { type: "copie"; auteur: string | null; versionPlusRecente: number | null; retiree: boolean }
  /** La session en cours en est l'autrice, d'après le serveur. */
  | { type: "publie"; definitionId: string; version: number };

export interface Session {
  etat: EtatBibliotheque;
  moiId: string | null;
  etats: Map<string, EtatDefinition>;
}

/** La consigne d'une fiche : « Quand l'appeler » et le corps. Le nom, le rôle court, la couleur et le modèle n'en font pas partie. */
export function consigne(contenu: string): string {
  const { frontmatter, body } = parseAgentFile(contenu);
  return `${(getField(frontmatter, "description") ?? "").trim()}\n\n${body.trim()}`;
}

const MODELES = new Map(AGENT_TEMPLATES.map((t) => [t.name, consigne(t.content)]));

/** Le modèle KLYRA embarqué de ce nom (contenu complet), s'il existe. */
export function modeleEmbarque(nom: string): string | null {
  return AGENT_TEMPLATES.find((t) => t.name === nom)?.content ?? null;
}

function raisonSuspendu(session: Session): "deconnecte" | "autre-compte" | "retire" | "chargement" {
  if (session.etat === "retire") return "retire";
  if (session.etat === "chargement") return "chargement";
  return session.moiId ? "autre-compte" : "deconnecte";
}

export function lienDe(agent: AgentLocal, session: Session): Lien {
  const o = agent.entree?.origine;
  if (!o) return { type: "aucun" };
  switch (o.type) {
    case "modele": {
      const reference = MODELES.get(o.modele);
      return { type: "modele", aJour: reference !== undefined && reference === consigne(agent.role.file?.content ?? "") };
    }
    case "local": {
      if (!o.publie || o.publie.compte !== session.moiId) return { type: "aucun" };
      const e = session.etats.get(o.publie.definitionId);
      return e?.deMoi && !e.retiree ? { type: "publie", definitionId: e._id, version: e.version } : { type: "aucun" };
    }
    case "bibliotheque": {
      if (o.compte !== session.moiId) return { type: "suspendu", raison: raisonSuspendu(session) };
      const e = session.etats.get(o.definitionId);
      const plusRecente = e && !e.retiree && e.version > o.version && e.version !== o.ignoree ? { version: e.version, majLe: e.majLe } : null;
      return {
        type: "recu",
        auteur: o.auteur,
        version: o.version,
        proposition: plusRecente,
        retiree: !!e?.retiree,
        modifie: agent.modifie,
        enAttente: session.etat !== "pret" || !e,
      };
    }
    case "copie": {
      if (o.compte !== session.moiId) return { type: "copie", auteur: null, versionPlusRecente: null, retiree: false };
      const e = session.etats.get(o.definitionId);
      return { type: "copie", auteur: o.auteur, versionPlusRecente: e && !e.retiree && e.version > o.version ? e.version : null, retiree: !!e?.retiree };
    }
  }
}
