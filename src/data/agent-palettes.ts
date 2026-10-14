import type { RoleTeinte } from "@/types/domain";

/**
 * Couleurs pastel des cartes d'agents et des pastilles (illustrations :
 * palette étendue autorisée) : même clarté et même
 * intensité pour toutes les teintes (OKLCH), pour qu'aucune carte ne crie plus
 * fort que les autres. Les trois jaunes sont écartés (abricot, gold, citron).
 * - `haut` / `bas` : dégradé du fond, du haut vers le bas ;
 * - `accent` : point de couleur, barre ;
 * - `encre` : icône sur le pastel (contraste ≥ 3,9:1 sur `haut`).
 */
export interface AgentPastel {
  haut: string;
  bas: string;
  accent: string;
  encre: string;
}

export const AGENT_PASTELS: Record<RoleTeinte, AgentPastel> = {
  "bleu-k1": { haut: "#c7ddff", bas: "#ebf3fe", accent: "#769edf", encre: "#4468a2" },
  "bleu-k2": { haut: "#b7e3ff", bas: "#e6f5fe", accent: "#55a7d9", encre: "#1c6f9d" },
  "bleu-k3": { haut: "#b0e7ef", bas: "#e1f7fa", accent: "#47afbd", encre: "#037683" },
  "violet": { haut: "#dbd6ff", bas: "#f2f0fe", accent: "#9e91da", encre: "#695c9e" },
  "rose": { haut: "#f5cdf1", bas: "#fdecfa", accent: "#c484bf", encre: "#8a5086" },
  "rouge": { haut: "#ffcfcc", bas: "#ffeeec", accent: "#dd817f", encre: "#9f4c4d" },
  "orange": { haut: "#ffd0c5", bas: "#feefea", accent: "#dc8372", encre: "#9e4f41" },
  "orange-k2": { haut: "#fbd4b8", bas: "#feefe4", accent: "#cd8f62", encre: "#915a31" },
  "jaune": { haut: "#f3eec1", bas: "#f5f3e2", accent: "#aba15c", encre: "#756a2a" },
  "ocre": { haut: "#f0dab4", bas: "#fbf1e1", accent: "#bd995a", encre: "#846328" },
  "vert": { haut: "#b1ebd4", bas: "#e1f9ee", accent: "#47b592", encre: "#067c5e" },
  "vert-k2": { haut: "#cde6bb", bas: "#ecf7e4", accent: "#85ad68", encre: "#527537" },
};
