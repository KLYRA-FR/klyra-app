import { app, net, safeStorage } from "electron";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Usage et coût réels d'une organisation Claude Console (facturation à
 * l'usage), par l'API Usage and Cost Analytics d'Anthropic, avec une clé Admin
 * (`sk-ant-admin01-…`) donnée dans les Réglages. Facultatif : sans clé, rien.
 *
 * Doc : https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
 * - GET /v1/organizations/analytics/usage et /analytics/cost, en bêta :
 *   en-têtes `anthropic-version: 2023-06-01` et `anthropic-beta: analytics-usage-cost-2026-08-24`.
 * - Une requête couvre 31 jours au plus, à partir du 01/01/2026 et dans les 365 derniers jours.
 * - Coût : `cost.amount`, chaîne décimale en centimes de dollar (« 41280.000000 » = 412,80 $).
 * - Données à jour sous 4 h en général, jusqu'à 24 h (`data_refreshed_at`).
 *
 * La clé est chiffrée par le trousseau du système (safeStorage) et ne revient
 * jamais vers l'interface.
 */

/* Tests seulement : KLYRA_ANTHROPIC_API remplace l'adresse de l'API (faux serveur local). Ignorée dans l'app installée. */
const BASE = `${(!app.isPackaged && process.env.KLYRA_ANTHROPIC_API) || "https://api.anthropic.com"}/v1/organizations/analytics`;
const fichier = () => path.join(app.getPath("userData"), "anthropic-admin.json");
const JOURS = 30;

export interface RapportAdmin {
  debut: string;
  fin: string;
  /** En dollars, après remises et avant crédits. */
  coutUsd: number;
  /** Au prix catalogue. */
  coutCatalogueUsd: number;
  jetons: number;
  requetes: number;
  parModele: { modele: string; jetons: number }[];
  /** Les données valent jusqu'à cette date (au-delà, partielles). */
  donneesAu: string | null;
  lu: number;
}

async function lireCle(): Promise<string | null> {
  try {
    const { cle } = JSON.parse(await readFile(fichier(), "utf8")) as { cle?: string };
    return cle ? safeStorage.decryptString(Buffer.from(cle, "base64")) : null;
  } catch {
    return null;
  }
}

/** Une page de l'API ; lève une erreur lisible. */
async function appeler(cle: string, chemin: "usage" | "cost", params: URLSearchParams) {
  const reponse = await net
    .fetch(`${BASE}/${chemin}?${params}`, {
      headers: {
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "analytics-usage-cost-2026-08-24",
        "User-Agent": `KLYRA/${app.getVersion()} (app de bureau)`,
      },
    })
    .catch(() => {
      throw new Error("Impossible de joindre l’API d’Anthropic : vérifie ta connexion.");
    });
  const corps = (await reponse.json().catch(() => null)) as {
    data?: Record<string, unknown>[];
    has_more?: boolean;
    next_page?: string | null;
    data_refreshed_at?: string | null;
    error?: { message?: string };
  } | null;
  if (reponse.status === 401 || reponse.status === 403) {
    throw Object.assign(new Error("Anthropic refuse cette clé : il faut une clé Admin (sk-ant-admin01-…) d’une organisation Console."), { code: "cle_invalide" });
  }
  if (!reponse.ok) throw new Error(`L’API d’Anthropic a répondu ${reponse.status}${corps?.error?.message ? ` : ${corps.error.message}` : ""}.`);
  return corps ?? {};
}

/** Toutes les pages d'une requête. */
async function toutes(cle: string, chemin: "usage" | "cost", base: Record<string, string | string[]>) {
  const lignes: Record<string, unknown>[] = [];
  let page: string | null | undefined;
  let donneesAu: string | null = null;
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(base)) for (const x of [v].flat()) params.append(k, x);
    params.set("limit", "100");
    if (page) params.set("page", page);
    const r = await appeler(cle, chemin, params);
    lignes.push(...(r.data ?? []));
    donneesAu = r.data_refreshed_at ?? donneesAu;
    if (!r.has_more || !r.next_page) break;
    page = r.next_page;
  }
  return { lignes, donneesAu };
}

/** Les 30 derniers jours : coût total, jetons par modèle. */
async function rapport(cle: string): Promise<RapportAdmin> {
  const fin = new Date();
  fin.setUTCMinutes(0, 0, 0);
  const debut = new Date(Math.max(fin.getTime() - JOURS * 24 * 3600 * 1000, Date.UTC(2026, 0, 1)));
  const periode = { starting_at: debut.toISOString().replace(/\.\d{3}Z$/, "Z"), ending_at: fin.toISOString().replace(/\.\d{3}Z$/, "Z") };

  const cout = await toutes(cle, "cost", periode);
  const usage = await toutes(cle, "usage", { ...periode, "group_by[]": "model" });
  const centimes = (v: unknown) => (typeof v === "string" || typeof v === "number" ? Number(v) || 0 : 0) / 100;
  const parModele = usage.lignes
    .map((l) => ({
      modele: String((l.group as { model?: string } | undefined)?.model ?? "autre"),
      jetons: Number((l.usage as { total_tokens?: number } | undefined)?.total_tokens ?? 0),
      requetes: Number((l.usage as { requests?: number } | undefined)?.requests ?? 0),
    }))
    .sort((a, b) => b.jetons - a.jetons);
  return {
    debut: periode.starting_at,
    fin: periode.ending_at,
    coutUsd: cout.lignes.reduce((s, l) => s + centimes((l.cost as { amount?: string } | undefined)?.amount), 0),
    coutCatalogueUsd: cout.lignes.reduce((s, l) => s + centimes((l.cost as { list_amount?: string } | undefined)?.list_amount), 0),
    jetons: parModele.reduce((s, m) => s + m.jetons, 0),
    requetes: parModele.reduce((s, m) => s + m.requetes, 0),
    parModele: parModele.map(({ modele, jetons }) => ({ modele, jetons })),
    donneesAu: cout.donneesAu ?? usage.donneesAu,
    lu: Date.now(),
  };
}

export async function etatAdmin(): Promise<{ configuree: boolean }> {
  return { configuree: !!(await lireCle()) };
}

/** Garde la clé après l'avoir essayée : une clé refusée n'est jamais enregistrée. */
export async function definirCleAdmin(cle: string): Promise<RapportAdmin> {
  const propre = String(cle ?? "").trim();
  if (!/^sk-ant-admin\d*-[\w-]{10,}$/.test(propre)) throw new Error("Ce n’est pas une clé Admin d’Anthropic (elle commence par sk-ant-admin01-).");
  const r = await rapport(propre);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : la clé ne peut pas être protégée, elle n’est pas gardée.");
  const temporaire = `${fichier()}.tmp`;
  await writeFile(temporaire, JSON.stringify({ cle: safeStorage.encryptString(propre).toString("base64") }), "utf8");
  await rename(temporaire, fichier());
  return r;
}

export async function retirerCleAdmin(): Promise<void> {
  await rm(fichier(), { force: true });
}

export async function rapportAdmin(): Promise<RapportAdmin | null> {
  const cle = await lireCle();
  return cle ? rapport(cle) : null;
}
