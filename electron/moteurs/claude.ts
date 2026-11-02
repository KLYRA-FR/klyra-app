import { autoriser, cancelAgent, compteClaude, connecterClaude, deconnecterClaude, findClaude, streamAgent } from "../claude";
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
};
