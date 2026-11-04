import { actualiserUtilisation, autoriser, cancelAgent, compteClaude, connecterClaude, deconnecterClaude, derniereUtilisation, findClaude, streamAgent, surUtilisation } from "../claude";
import { commande, derniereVersionNpm } from "./installation";
import type { Moteur } from "./types";

/** Claude Code, lancé par electron/claude.ts. */
export const claude: Moteur = {
  id: "claude",
  nom: "Claude Code",
  fournisseur: "Claude",
  trouver: findClaude,
  compte: compteClaude,
  connecter: connecterClaude,
  deconnecter: deconnecterClaude,
  lancer: streamAgent,
  arreter: cancelAgent,
  autoriser,
  utilisation: (actualiser) => (actualiser ? actualiserUtilisation() : Promise.resolve(derniereUtilisation())),
  surUtilisation,
  versionDisponible: () => derniereVersionNpm("@anthropic-ai/claude-code"),
  /** Claude Code se met à jour lui-même (`claude update`), quel que soit l'endroit où il est installé. */
  async mettreAJour(progression) {
    const bin = findClaude();
    if (!bin) throw new Error("Claude Code n’est pas installé sur ce poste.");
    progression({ etape: "mise-a-jour", recu: 0, total: null });
    const r = await commande(bin, ["update"], 5 * 60_000);
    if (r.code !== 0) throw new Error(r.sortie.trim().split("\n").slice(-3).join(" ").slice(0, 400) || "La mise à jour de Claude Code a échoué.");
    return compteClaude();
  },
};
