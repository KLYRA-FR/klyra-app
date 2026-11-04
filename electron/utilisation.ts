/**
 * L'utilisation de l'abonnement d'un fournisseur (Claude par Claude Code, ChatGPT par Codex, Grok par
 * Grok Build), dans une seule forme : une fenêtre de 5 h, une de 7 jours, les crédits du mois (Grok), et
 * si la limite est atteinte. Module pur, sans processus ni Electron : le PC (electron/claude.ts,
 * electron/moteurs/codex.ts, electron/moteurs/grok.ts) et le VPS (`serveur/utilisation.mjs`, généré par
 * scripts/serveur-genere.mjs) lisent les mêmes réponses avec lui.
 * Jamais de chiffre estimé : une fenêtre que le fournisseur n'a pas donnée reste null.
 */

/** Une fenêtre de limite : la part utilisée (0 à 1) et quand elle repart à zéro. */
export interface FenetreUtilisation {
  utilise: number;
  /** Date de remise à zéro, en millisecondes. */
  reinitialiseA: number | null;
}

export interface Utilisation {
  /** Fenêtre de 5 h. */
  session: FenetreUtilisation | null;
  /** Fenêtre de 7 jours. */
  semaine: FenetreUtilisation | null;
  /** Crédits du mois (Grok : l'abonnement donne des crédits par période de facturation, pas de fenêtre 5 h ni semaine). */
  mois?: FenetreUtilisation | null;
  /** « allowed », « allowed_warning » ou « rejected » (limite atteinte). */
  statut: string;
  misAJour: number;
}

/* ─── Claude Code ──────────────────────────────────────────────── */

function fenetreClaude(brut: unknown): FenetreUtilisation | null {
  const f = brut as { utilization?: unknown; resetsAt?: unknown } | undefined;
  if (!f || typeof f.utilization !== "number") return null;
  return { utilise: f.utilization, reinitialiseA: typeof f.resetsAt === "number" ? f.resetsAt * 1000 : null };
}

/**
 * Lit un `rate_limit_info` de Claude Code. Deux formes : `unifiedWindows`
 * (les deux fenêtres d'un coup, champ interne que toutes les versions
 * n'envoient pas) et la forme publique, une seule fenêtre nommée par
 * `rateLimitType`. Une fenêtre absente de l'événement garde sa dernière
 * valeur connue : un événement sans chiffre n'efface rien.
 */
export function lireUtilisation(info: unknown, precedente: Utilisation | null, maintenant = Date.now()): Utilisation | null {
  const i = info as { status?: unknown; rateLimitType?: unknown; unifiedWindows?: Record<string, unknown> } | undefined;
  if (!i || typeof i !== "object") return precedente;
  const seule = fenetreClaude(i);
  const lue = (type: string) => fenetreClaude(i.unifiedWindows?.[type]) ?? (i.rateLimitType === type ? seule : null);
  return {
    session: lue("five_hour") ?? precedente?.session ?? null,
    semaine: lue("seven_day") ?? precedente?.semaine ?? null,
    statut: typeof i.status === "string" ? i.status : (precedente?.statut ?? "allowed"),
    misAJour: maintenant,
  };
}

/* ─── Codex (ChatGPT) ──────────────────────────────────────────── */

/** Au-delà d'un jour, la fenêtre est celle de la semaine (Codex donne sa durée en minutes). */
const UN_JOUR_MIN = 24 * 60;

function fenetreCodex(brut: unknown): { fenetre: FenetreUtilisation; minutes: number | null } | null {
  const f = brut as { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null | undefined;
  if (!f || typeof f.usedPercent !== "number" || !Number.isFinite(f.usedPercent)) return null;
  return {
    fenetre: { utilise: Math.max(0, Math.min(1, f.usedPercent / 100)), reinitialiseA: typeof f.resetsAt === "number" ? f.resetsAt * 1000 : null },
    minutes: typeof f.windowDurationMins === "number" ? f.windowDurationMins : null,
  };
}

/**
 * Lit un `RateLimitSnapshot` de Codex (`account/rateLimits/read`, ou la notification
 * `account/rateLimits/updated`, qui ne donne que ce qui a changé). `primary` est la fenêtre courte
 * (5 h) et `secondary` la semaine, sauf si leur durée dit le contraire. Une réponse de lecture qui a
 * plusieurs compteurs : celui de Codex (`rateLimitsByLimitId.codex`) d'abord. Comme pour Claude, une
 * fenêtre absente garde sa dernière valeur ; `rateLimitReachedType` posé = limite atteinte.
 */
export function lireUtilisationCodex(brut: unknown, precedente: Utilisation | null, maintenant = Date.now()): Utilisation | null {
  const enveloppe = brut as { rateLimits?: unknown; rateLimitsByLimitId?: Record<string, unknown> | null } | null | undefined;
  if (!enveloppe || typeof enveloppe !== "object") return precedente;
  const snapshot = (enveloppe.rateLimitsByLimitId?.codex ?? enveloppe.rateLimits ?? enveloppe) as {
    primary?: unknown;
    secondary?: unknown;
    rateLimitReachedType?: unknown;
  };
  if (!snapshot || typeof snapshot !== "object") return precedente;
  const lues = [fenetreCodex(snapshot.primary), fenetreCodex(snapshot.secondary)];
  let session: FenetreUtilisation | null = null;
  let semaine: FenetreUtilisation | null = null;
  lues.forEach((lue, rang) => {
    if (!lue) return;
    const longue = lue.minutes !== null ? lue.minutes > UN_JOUR_MIN : rang === 1;
    if (longue) semaine ??= lue.fenetre;
    else session ??= lue.fenetre;
  });
  const atteinte = typeof snapshot.rateLimitReachedType === "string";
  if (!session && !semaine && !atteinte) return precedente;
  const fusion = { session: session ?? precedente?.session ?? null, semaine: semaine ?? precedente?.semaine ?? null };
  /* Une mise à jour partielle peut ne pas redire `rateLimitReachedType` : les fenêtres tranchent alors
     (une fenêtre pleine dont la remise à zéro est passée ne compte plus). */
  const pleine = (f: FenetreUtilisation | null) => !!f && f.utilise >= 1 && (f.reinitialiseA === null || f.reinitialiseA > maintenant);
  const statut = atteinte || pleine(fusion.session) || pleine(fusion.semaine) ? "rejected" : "allowed";
  return { ...fusion, statut, misAJour: maintenant };
}

/* ─── Grok (SuperGrok, X Premium+) ─────────────────────────────── */

/** Une date de Grok en millisecondes : texte ISO, ou nombre en secondes ou en millisecondes. */
function dateGrok(brut: unknown): number | null {
  if (typeof brut === "string" && brut.trim()) {
    const ms = Date.parse(brut);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof brut === "number" && Number.isFinite(brut) && brut > 0) return brut < 1e12 ? brut * 1000 : brut;
  return null;
}

/**
 * Lit la réponse de `x.ai/billing` de Grok Build (`BillingConfigResponse` : `config`, `on_demand_enabled`,
 * `subscription_tier`). L'abonnement donne des crédits par période de facturation : `config.creditUsagePercent`
 * (part utilisée, de 0 à 100) et `config.currentPeriod.end` (remise à zéro) font la fenêtre du mois. Sans
 * pourcentage lisible (connecté par une clé API, réponse d'une autre forme), rien n'est inventé : la
 * précédente reste. La limite n'est atteinte que si le paiement à l'usage n'est pas activé : sinon les agents
 * continuent, facturés à part.
 */
export function lireUtilisationGrok(brut: unknown, precedente: Utilisation | null, maintenant = Date.now()): Utilisation | null {
  const reponse = brut as { config?: unknown; on_demand_enabled?: unknown; onDemandEnabled?: unknown } | null | undefined;
  if (!reponse || typeof reponse !== "object") return precedente;
  const config = (reponse.config && typeof reponse.config === "object" ? reponse.config : reponse) as {
    creditUsagePercent?: unknown;
    currentPeriod?: { end?: unknown } | null;
  };
  const pourcent = config.creditUsagePercent;
  if (typeof pourcent !== "number" || !Number.isFinite(pourcent)) return precedente;
  const mois: FenetreUtilisation = { utilise: Math.max(0, Math.min(1, pourcent / 100)), reinitialiseA: dateGrok(config.currentPeriod?.end) };
  const aLUsage = reponse.on_demand_enabled === true || reponse.onDemandEnabled === true;
  const pleine = mois.utilise >= 1 && (mois.reinitialiseA === null || mois.reinitialiseA > maintenant);
  return { session: null, semaine: null, mois, statut: pleine && !aLUsage ? "rejected" : "allowed", misAJour: maintenant };
}
