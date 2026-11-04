import { corpsFiche, descriptionFiche, ficheAgent, type AjoutFiche, type BrouillonAgent } from "@/lib/atelier-agent";
import type { KlyraBridge } from "@/lib/bridge";
import type { MessagePart } from "@/types/domain";
import { empreinteFiche, type CasEpreuve, type ResultatCas } from "../../electron/epreuve";

/**
 * L'épreuve d'un agent de l'atelier, lancée de la carte du bureau ou du téléphone (geste
 * `atelier.essayer`) : les essais qui tournent sont notés sur la carte (`essais`), chaque résultat y
 * est rangé dès qu'il arrive. Les deux écrans lisent la même carte.
 */

type PartAtelier = Extract<MessagePart, { type: "atelier-agent" }>;
type PatchAtelier = Partial<Pick<PartAtelier, "teinte" | "cree" | "resultats" | "ajouts" | "essais">>;
export type MarquerAtelier = (messageId: string, etapeId: string, patch: PatchAtelier | ((part: PartAtelier) => PatchAtelier)) => void;
export type EssayerAtelier = NonNullable<KlyraBridge["claude"]["essayer"]>;

export interface Essai {
  b: BrouillonAgent;
  /** L'identifiant de l'agent sur sa fiche (celui qu'il recevra). */
  id: string;
  /** Les demandes à jouer (toutes, ou celle qu'une correction fait rejouer). */
  cas: CasEpreuve[];
  ajouts: AjoutFiche[];
  /** La conversation et sa machine : sur un VPS, l'essai tourne là-bas. */
  lieu: string | null;
  conversation: string;
  /** L'appel de l'atelier où ranger les résultats. */
  messageId: string;
  etapeId: string;
  /** Les résultats de la série avant cet essai (ils peuvent être sur un appel plus ancien). */
  depart: ResultatCas[];
}

export async function jouerEpreuve(essayer: EssayerAtelier, marquer: MarquerAtelier, e: Essai, surResultat?: (r: ResultatCas) => void): Promise<void> {
  const types = e.cas.map((c) => c.type);
  marquer(e.messageId, e.etapeId, (part) => ({ essais: [...new Set([...(part.essais ?? []), ...types])] }));
  const fiche = ficheAgent(e.b, e.id);
  const brouillon = { id: e.id, description: descriptionFiche(e.b), corps: corpsFiche(e.b), modele: e.b.modele || "opus", fiche };
  const echec = (c: CasEpreuve, message: string): ResultatCas => ({ ...c, reponse: "", verdict: null, raison: "", correction: null, jetons: 0, empreinte: empreinteFiche(fiche), erreur: message });
  await Promise.all(
    e.cas.map(async (c) => {
      let resultat: ResultatCas;
      try {
        const r = await essayer(crypto.randomUUID(), brouillon, c, { lieu: e.lieu, conversation: e.conversation, ajouts: e.ajouts });
        resultat = r.ok ? r.data : echec(c, r.message);
      } catch (err) {
        resultat = echec(c, err instanceof Error ? err.message : String(err));
      }
      marquer(e.messageId, e.etapeId, (part) => ({
        resultats: [...(part.resultats ?? e.depart).filter((x) => x.type !== c.type), resultat],
        essais: (part.essais ?? []).filter((t) => t !== c.type),
      }));
      surResultat?.(resultat);
    }),
  );
}
