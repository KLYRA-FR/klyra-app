import type { EntreeConsommation } from "@/lib/bridge";
import type { Message } from "@/types/domain";

/**
 * Les chiffres du Profil, tirés des vraies données de l'app : l'historique des
 * conversations (messages, jours actifs) et le journal de consommation
 * (jetons et coûts renvoyés par Claude Code et les autres IA, enregistrés
 * depuis `depuis`). Rien n'est estimé ni inventé : sans donnée, null.
 */

export const UN_JOUR = 24 * 60 * 60 * 1000;

/** « 2026-10-29 » pour une date, à l'heure locale. */
export function cleJour(d: Date | number): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

const debutJour = (d: Date | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const totalJetons = (e: EntreeConsommation) => e.jetons.entree + e.jetons.sortie + e.jetons.cacheLu + e.jetons.cacheEcrit;

export interface Serie {
  jours: number;
  debut: Date | null;
  fin: Date | null;
}

export interface Statistiques {
  /** Messages de l'année, par jour (clé `cleJour`). */
  messagesParJour: Map<string, number>;
  /** Pour la carte d'activité : messages du jour, ou 1 si le jour n'a que des réponses comptées (historique). */
  activiteParJour: Map<string, number>;
  messages: number;
  joursActifs: number;
  serieActuelle: Serie;
  plusLongueSerie: Serie;
  /** Le jour de la semaine le plus actif (0 = dimanche), d'après les messages. */
  jourLePlusActif: number | null;
  /** Jetons de l'année ; null si rien n'est encore enregistré. */
  jetons: number | null;
  jourRecord: { jour: Date; jetons: number } | null;
  /** Par fournisseur, modèle et agent : jetons, du plus grand au plus petit. */
  fournisseurs: { nom: string; jetons: number }[];
  modeles: { nom: string; fournisseur: string; jetons: number }[];
  agents: { id: string; jetons: number }[];
  /** Coût en dollars renvoyé par Claude Code ; null si aucun. */
  coutUsd: number | null;
  /** Réponses d'agents par agent, d'après l'historique (quand les jetons manquent encore). */
  reponsesParAgent: { id: string; reponses: number }[];
}

function trier<K>(m: Map<K, number>): [K, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function ajouter<K>(m: Map<K, number>, k: K, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}

/** Les séries de jours actifs consécutifs. */
function series(jours: Set<string>, aujourdhui: Date): { actuelle: Serie; longue: Serie } {
  const tries = [...jours].sort();
  let longue: Serie = { jours: 0, debut: null, fin: null };
  let courante: Serie = { jours: 0, debut: null, fin: null };
  let precedent: Date | null = null;
  for (const cle of tries) {
    const [a, m, j] = cle.split("-").map(Number);
    const d = new Date(a, m - 1, j);
    const suite = precedent && Math.round((d.getTime() - precedent.getTime()) / UN_JOUR) === 1;
    courante = suite ? { jours: courante.jours + 1, debut: courante.debut, fin: d } : { jours: 1, debut: d, fin: d };
    if (courante.jours > longue.jours) longue = courante;
    precedent = d;
  }
  // La série actuelle va jusqu'à aujourd'hui, ou hier si aujourd'hui n'est pas encore actif.
  const hier = new Date(aujourdhui.getTime() - UN_JOUR);
  const actuelle = courante.fin && (cleJour(courante.fin) === cleJour(aujourdhui) || cleJour(courante.fin) === cleJour(hier)) ? courante : { jours: 0, debut: null, fin: null };
  return { actuelle, longue };
}

export function calculer(messages: Message[], conso: EntreeConsommation[], maintenant = new Date()): Statistiques {
  const aujourdhui = debutJour(maintenant);
  const limite = aujourdhui.getTime() - 364 * UN_JOUR;

  const messagesParJour = new Map<string, number>();
  const parJourSemaine = new Map<number, number>();
  const reponses = new Map<string, number>();
  let total = 0;
  for (const m of messages) {
    const t = Date.parse(m.createdAt);
    if (!Number.isFinite(t) || t < limite) continue;
    total += 1;
    ajouter(messagesParJour, cleJour(t), 1);
    ajouter(parJourSemaine, new Date(t).getDay(), 1);
    if (m.author.kind === "role") ajouter(reponses, m.author.roleId, 1);
  }

  const jetonsParJour = new Map<string, number>();
  const fournisseurs = new Map<string, number>();
  const modeles = new Map<string, number>();
  const fournisseurDuModele = new Map<string, string>();
  const agents = new Map<string, number>();
  let jetons = 0;
  let cout = 0;
  let aDuCout = false;
  for (const e of conso) {
    if (e.at < limite) continue;
    const n = totalJetons(e);
    // Une ligne de coût seul (historique) ne compte ni dans les jetons ni dans les classements.
    if (n > 0) {
      jetons += n;
      ajouter(jetonsParJour, cleJour(e.at), n);
      ajouter(fournisseurs, e.fournisseur, n);
      ajouter(modeles, e.modele, n);
      fournisseurDuModele.set(e.modele, e.fournisseur);
      ajouter(agents, e.agent, n);
    }
    if (typeof e.coutUsd === "number") {
      cout += e.coutUsd;
      aDuCout = true;
    }
  }

  const actifs = new Set([...messagesParJour.keys(), ...jetonsParJour.keys()]);
  /* La carte d'activité : les messages du jour ; un jour sans message gardé mais avec des réponses comptées vaut 1. */
  const activiteParJour = new Map(messagesParJour);
  for (const jour of jetonsParJour.keys()) if (!activiteParJour.has(jour)) activiteParJour.set(jour, 1);
  const { actuelle, longue } = series(actifs, aujourdhui);
  const record = trier(jetonsParJour)[0];
  const [a, m, j] = record ? record[0].split("-").map(Number) : [0, 0, 0];
  /* Jour le plus actif : d'après les messages de l'app ; sans eux, d'après les jetons (terminal, IDE). */
  if (!parJourSemaine.size) {
    for (const [cle, n] of jetonsParJour) {
      const [aa, mm, jj] = cle.split("-").map(Number);
      ajouter(parJourSemaine, new Date(aa, mm - 1, jj).getDay(), n);
    }
  }

  return {
    messagesParJour,
    activiteParJour,
    messages: total,
    joursActifs: actifs.size,
    serieActuelle: actuelle,
    plusLongueSerie: longue,
    jourLePlusActif: trier(parJourSemaine)[0]?.[0] ?? null,
    jetons: conso.length ? jetons : null,
    jourRecord: record ? { jour: new Date(a, m - 1, j), jetons: record[1] } : null,
    fournisseurs: trier(fournisseurs).map(([nom, n]) => ({ nom, jetons: n })),
    modeles: trier(modeles).map(([nom, n]) => ({ nom, fournisseur: fournisseurDuModele.get(nom) ?? "", jetons: n })),
    agents: trier(agents).map(([id, n]) => ({ id, jetons: n })),
    coutUsd: aDuCout ? cout : null,
    reponsesParAgent: trier(reponses).map(([id, n]) => ({ id, reponses: n })),
  };
}

/* ─── Mise en forme ───────────────────────────────────────────── */

const decimal = (n: number, chiffres: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres });

/** 87 240 000 → « 87,24 M » ; 1 450 → « 1,45 k ». */
export function compact(n: number): string {
  if (n >= 1e9) return `${decimal(n / 1e9, 2)} Md`;
  if (n >= 1e6) return `${decimal(n / 1e6, 2)} M`;
  if (n >= 1e4) return `${decimal(n / 1e3, 1)} k`;
  if (n >= 1e3) return `${decimal(n / 1e3, 2)} k`;
  return String(n);
}

export const dateCourte = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const dateAnnee = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const NOMS_JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
