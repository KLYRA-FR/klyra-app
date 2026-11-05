import { ficheAgent } from "@/lib/atelier-agent";
import { bilanEquipe, identifiantsLibres, membresVus, plierEquipes, type EtatEquipe } from "@/lib/atelier-equipe";
import { chaine, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import type { Message, MessagePart, Role, RoleTeinte } from "@/types/domain";

/**
 * L'atelier d'une équipe depuis le téléphone (gestes `atelier.equipe*`, faits par l'ordinateur ouvert) :
 * garder un agent ou le laisser de côté, créer l'équipe. Le téléphone n'envoie que la conversation,
 * l'appel (`etapeId`) et la clé du membre : la carte est repliée ici, depuis la conversation de
 * l'ordinateur, jamais d'après ce que le téléphone a affiché. Mêmes règles que la carte du bureau
 * (src/components/chat/CarteEquipe.tsx).
 */

type PartEquipe = Extract<MessagePart, { type: "atelier-equipe" }>;
type PatchEquipe = Partial<Pick<PartEquipe, "teintes" | "ecartes" | "crees">>;

export interface DepsEquipe {
  /** Les messages de la conversation ; null : elle n'est plus sur l'ordinateur. */
  messages: (conversation: string) => Message[] | null;
  /** Les agents actifs (l'assistant compris). */
  roles: Role[];
  identifiantLibre: (propose: string) => string;
  create: (id: string, content: string, reglage: { tag: string; teinte: RoleTeinte }) => Promise<void>;
  marquer: (messageId: string, etapeId: string, patch: PatchEquipe | ((part: PartEquipe) => PatchEquipe)) => void;
  teinteDe: (id: string) => RoleTeinte;
}

interface Carte {
  etapeId: string;
  messageId: string;
  etat: EtatEquipe;
}

export function gestesEquipe(d: DepsEquipe): Gestes {
  /** La carte d'équipe de la conversation, relue sur l'ordinateur ; refusée si elle n'est plus la dernière. */
  const carteDe = (args: Record<string, unknown>): Carte => {
    const conversation = chaine(args, "conversation", 200);
    const etapeId = chaine(args, "etapeId", 200);
    const messages = d.messages(conversation);
    if (!messages) throw new ErreurPoste("conversation_absente", "Cette conversation n’est plus sur l’ordinateur.");
    const etat = plierEquipes(messages).get(etapeId);
    const message = messages.find((m) => m.parts.some((p) => p.type === "atelier-equipe" && p.etapeId === etapeId));
    if (!etat || !message) throw new ErreurPoste("carte_absente", "Cette carte n’existe plus.");
    if (!etat.dernier || (!etat.courante && !Object.keys(etat.crees).length)) throw new ErreurPoste("remplacee", "L’assistant a composé une équipe plus récente : agis sur celle-ci.");
    if (etat.provisoire) throw new ErreurPoste("provisoire", "L’assistant compose encore l’équipe.");
    return { etapeId, messageId: message.id, etat };
  };

  return {
    "atelier.equipeGarder": async (args) => {
      const a = objet(args);
      const cle = chaine(a, "membre", 80);
      if (typeof a.garder !== "boolean") throw new ErreurPoste("arguments", "Demande illisible.");
      const garder = a.garder;
      const c = carteDe(a);
      const vu = membresVus(c.etat, d.roles, d.teinteDe).find((x) => x.m.cle === cle);
      if (!vu) throw new ErreurPoste("membre_absent", "Cet agent n’est plus dans l’équipe.");
      if (vu.idCree) throw new ErreurPoste("deja_cree", "Cet agent est déjà dans ton équipe.");
      d.marquer(c.messageId, c.etapeId, (p) => {
        const ecartes = p.ecartes ?? c.etat.ecartes;
        return { ecartes: garder ? ecartes.filter((x) => x !== cle) : [...new Set([...ecartes, cle])] };
      });
      return { ok: true };
    },

    "atelier.equipeCreer": async (args) => {
      const c = carteDe(objet(args));
      const bilan = bilanEquipe(c.etat, membresVus(c.etat, d.roles, d.teinteDe));
      if (bilan.nee) throw new ErreurPoste("deja_cree", "Cette équipe est déjà dans Mes agents.");
      if (bilan.manques.length) throw new ErreurPoste("incomplet", `Il manque ${bilan.manques.join(" ; ")}.`);
      const ids = identifiantsLibres(bilan.aCreer.map((x) => x.m.cle), d.identifiantLibre);
      const crees: string[] = [];
      for (const [i, x] of bilan.aCreer.entries()) {
        await d.create(ids[i], ficheAgent(x.m.agent, ids[i]), { tag: x.m.agent.role, teinte: x.teinte });
        // Noté à chaque naissance : une erreur plus loin garde ceux qui sont déjà là.
        d.marquer(c.messageId, c.etapeId, (p) => ({ crees: { ...(p.crees ?? {}), [x.m.cle]: ids[i] }, teintes: { ...(p.teintes ?? {}), [x.m.cle]: x.teinte } }));
        crees.push(ids[i]);
      }
      return { ids: crees };
    },
  };
}
