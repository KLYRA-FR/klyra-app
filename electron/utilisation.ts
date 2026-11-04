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
  /** Pourquoi aucune fenêtre n'a pu être lue (Grok : erreur ou forme de sa réponse), montré au survol. */
  note?: string | null;
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

type Objet = Record<string, unknown>;
const objet = (v: unknown): Objet | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Objet) : null);

/** Un nombre de Grok : nombre, ou texte qui en est un (« 37.5 »). */
function nombre(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Une date de Grok en millisecondes : texte ISO, ou nombre en secondes ou en millisecondes. */
function dateGrok(brut: unknown): number | null {
  if (typeof brut === "string" && brut.trim() && !Number.isFinite(Number(brut))) {
    const ms = Date.parse(brut);
    return Number.isFinite(ms) ? ms : null;
  }
  const n = nombre(brut);
  return n !== null && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
}

/** La configuration de facturation, là où Grok la met : `config`, ou sous une enveloppe (`billing`, `result`, `data`). */
function configGrok(reponse: Objet): { config: Objet; enveloppe: Objet } | null {
  const enveloppes = [reponse, objet(reponse.billing), objet(reponse.result), objet(reponse.data)].filter((e): e is Objet => !!e);
  for (const enveloppe of enveloppes) {
    for (const config of [objet(enveloppe.config), objet(enveloppe.billingConfig), enveloppe]) {
      if (config && ("creditUsagePercent" in config || "monthlyLimit" in config || "currentPeriod" in config)) return { config, enveloppe };
    }
  }
  return null;
}

/**
 * La part utilisée, de 0 à 100 : `creditUsagePercent` quand Grok la donne ; sinon ce qui a été utilisé
 * dans la période en cours (`history`, `includedUsed` puis `totalUsed`) rapporté à `monthlyLimit`, deux
 * chiffres de Grok. Rien d'autre : sans eux, null.
 */
function pourcentGrok(config: Objet): number | null {
  const direct = nombre(config.creditUsagePercent);
  if (direct !== null) return direct;
  const limite = nombre(config.monthlyLimit);
  const historique = Array.isArray(config.history) ? config.history.map(objet).filter((h): h is Objet => !!h) : [];
  const courant = historique.at(-1);
  const utilise = courant ? (nombre(courant.includedUsed) ?? nombre(courant.totalUsed)) : null;
  return limite !== null && limite > 0 && utilise !== null ? (utilise / limite) * 100 : null;
}

/**
 * Lit la réponse de `x.ai/billing` de Grok Build (`BillingConfigResponse` : `config`, `on_demand_enabled`,
 * `subscription_tier`). L'abonnement donne des crédits par période de facturation : la part utilisée
 * (`pourcentGrok`) et `config.currentPeriod.end` (remise à zéro) font la fenêtre du mois. Sans chiffre
 * lisible, rien n'est inventé : la précédente reste. La limite n'est atteinte que si le paiement à l'usage
 * n'est pas activé : sinon les agents continuent, facturés à part.
 */
export function lireUtilisationGrok(brut: unknown, precedente: Utilisation | null, maintenant = Date.now()): Utilisation | null {
  const reponse = objet(brut);
  const trouve = reponse ? configGrok(reponse) : null;
  if (!trouve) return precedente;
  const pourcent = pourcentGrok(trouve.config);
  if (pourcent === null) return precedente;
  const periode = objet(trouve.config.currentPeriod);
  const mois: FenetreUtilisation = { utilise: Math.max(0, Math.min(1, pourcent / 100)), reinitialiseA: dateGrok(periode?.end) };
  const aLUsage = [trouve.enveloppe, reponse!].some((o) => o.on_demand_enabled === true || o.onDemandEnabled === true);
  const pleine = mois.utilise >= 1 && (mois.reinitialiseA === null || mois.reinitialiseA > maintenant);
  return { session: null, semaine: null, mois, statut: pleine && !aLUsage ? "rejected" : "allowed", misAJour: maintenant };
}

/**
 * La forme d'une réponse, pour dire ce que Grok a répondu quand rien n'y est lisible : les noms des champs et
 * leur type, jamais leurs valeurs (« config{creditUsagePercent:null, monthlyLimit:number} »).
 */
export function formeReponse(brut: unknown, profondeur = 0): string {
  if (brut === null) return "null";
  if (Array.isArray(brut)) return `liste(${brut.length})`;
  const o = objet(brut);
  if (!o) return typeof brut;
  if (profondeur >= 2) return "objet";
  const champs = Object.entries(o).slice(0, 12).map(([cle, v]) => (objet(v) ? `${cle}${formeReponse(v, profondeur + 1)}` : `${cle}:${formeReponse(v, profondeur + 1)}`));
  return `{${champs.join(", ")}${Object.keys(o).length > 12 ? ", …" : ""}}`;
}

/**
 * L'utilisation de Grok après une lecture de `x.ai/billing` (sa réponse, ou l'erreur de la demande) : les
 * crédits du mois quand ils sont lisibles ; sinon une utilisation sans fenêtre qui dit pourquoi (`note`,
 * montrée au survol de l'anneau), sauf si des crédits ont déjà été lus : un échec passager ne les efface pas.
 */
export function utilisationGrok(lecture: { reponse: unknown } | { erreur: string }, precedente: Utilisation | null, maintenant = Date.now()): Utilisation {
  if ("reponse" in lecture) {
    const lue = lireUtilisationGrok(lecture.reponse, null, maintenant);
    if (lue) return lue;
  }
  if (precedente?.mois) return precedente;
  const note = "erreur" in lecture ? `Grok a répondu : ${lecture.erreur}` : `réponse sans crédits lisibles ${formeReponse(lecture.reponse)}`;
  return { session: null, semaine: null, mois: null, statut: "allowed", misAJour: maintenant, note: note.slice(0, 400) };
}
