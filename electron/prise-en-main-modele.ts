/** Le parcours de ce poste. Distinct du nom de l'assistant et des données d'un VPS. */
export const ETAPES_PRISE_EN_MAIN = ["assistant", "ia", "acces", "demande", "conversation", "termine"] as const;
export type EtapePriseEnMain = (typeof ETAPES_PRISE_EN_MAIN)[number];
export type FournisseurDepart = "claude" | "codex" | "grok";
export interface PriseEnMain {
  version: 1;
  etape: EtapePriseEnMain;
  mode: "guide" | "exploration";
  fournisseur: FournisseurDepart | null;
  brouillon: string;
  conversation: { id: string; debut: string } | null;
}
export type ChoixPriseEnMain = Partial<Omit<PriseEnMain, "version">>;

export function debutPriseEnMain(nouveau: boolean): PriseEnMain {
  return { version: 1, etape: nouveau ? "assistant" : "termine", mode: "guide", fournisseur: null, brouillon: "", conversation: null };
}

/** Pas de reprise silencieuse d'un fichier illisible : on garde les données et on propose de réessayer. */
export function validerPriseEnMain(brut: unknown): PriseEnMain {
  if (!brut || typeof brut !== "object") throw new Error("La prise en main est illisible.");
  const b = brut as Record<string, unknown>;
  if (b.version !== 1 || !ETAPES_PRISE_EN_MAIN.includes(b.etape as EtapePriseEnMain) || !["guide", "exploration"].includes(String(b.mode))) throw new Error("La prise en main est illisible.");
  if (b.fournisseur !== null && !["claude", "codex", "grok"].includes(String(b.fournisseur))) throw new Error("Fournisseur de départ invalide.");
  if (typeof b.brouillon !== "string" || b.brouillon.length > 20_000) throw new Error("La demande doit faire au plus 20 000 caractères.");
  if (b.conversation !== null) {
    const c = b.conversation as Record<string, unknown>;
    if (!c || typeof c !== "object" || c.id !== "dm-principal" || typeof c.debut !== "string" || !Number.isFinite(Date.parse(c.debut))) throw new Error("Conversation de départ invalide.");
  }
  if (["acces", "demande", "conversation"].includes(String(b.etape)) && !b.fournisseur) throw new Error("Choisis d’abord une IA.");
  if (b.etape === "conversation" && !b.conversation) throw new Error("La première conversation n’a pas encore commencé.");
  const c = b.conversation as PriseEnMain["conversation"];
  return { version: 1, etape: b.etape as EtapePriseEnMain, mode: b.mode as PriseEnMain["mode"], fournisseur: b.fournisseur as FournisseurDepart | null, brouillon: b.brouillon, conversation: c ? { id: c.id, debut: c.debut } : null };
}

export function appliquerChoixPriseEnMain(actuel: PriseEnMain, brut: unknown): PriseEnMain {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) throw new Error("Choix de prise en main invalide.");
  if (Object.keys(brut).some((k) => !["etape", "mode", "fournisseur", "brouillon", "conversation"].includes(k))) throw new Error("Choix de prise en main inconnu.");
  const suivant = validerPriseEnMain({ ...actuel, ...brut });
  if (actuel.etape !== "termine" && suivant.etape === "termine" && (actuel.etape !== "conversation" || !actuel.conversation)) throw new Error("La première réponse n’a pas encore été reçue.");
  return suivant;
}
