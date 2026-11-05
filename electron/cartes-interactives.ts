/**
 * Les cartes interactives d'un agent, dans le fil : au lieu d'une liste de questions, une carte que
 * la personne remplit et envoie d'un clic (outil `proposer_carte`). Quatre genres : un formulaire
 * (brief à remplir), une comparaison (pistes à départager), une liste à valider, des créneaux.
 * Ce qu'elle envoie part comme un message d'elle, lisible tel quel : l'agent le reçoit à son tour
 * suivant, comme une réponse écrite.
 *
 * Module pur, le même pour ce PC (electron/ia.ts, l'écran par src/lib/cartes-interactives.ts) et
 * pour un VPS (généré en serveur/cartes-interactives.mjs par scripts/serveur-genere.mjs).
 */

/* ─── Les formes ──────────────────────────────────────────────────── */

export const GENRES = ["formulaire", "comparaison", "liste", "creneaux"] as const;
export type GenreCarte = (typeof GENRES)[number];

export const TYPES_CHAMP = ["texte", "long", "nombre", "date", "choix", "multiple", "interrupteur", "curseur"] as const;
export type TypeChamp = (typeof TYPES_CHAMP)[number];

export type ValeurChamp = string | number | boolean | string[];

export interface ChampCarte {
  id: string;
  libelle: string;
  type: TypeChamp;
  /** Pour `choix` et `multiple` : 2 à 8 réponses. */
  options: string[];
  requis: boolean;
  aide: string;
  /** Ce que l'agent pré-remplit, d'après ce qu'il sait déjà. */
  valeur: ValeurChamp | null;
  /** Pour `nombre` et `curseur`. */
  min: number | null;
  max: number | null;
  pas: number | null;
  unite: string;
}

export interface OptionComparee {
  id: string;
  titre: string;
  resume: string;
  pour: string[];
  contre: string[];
  recommandee: boolean;
}

export interface ElementListe {
  id: string;
  texte: string;
  coche: boolean;
}

export interface Creneau {
  /** AAAA-MM-JJ */
  date: string;
  /** HH:MM */
  heure: string;
  /** En minutes. */
  duree: number;
}

interface Base {
  titre: string;
  intro: string;
}

export type Carte =
  | (Base & { genre: "formulaire"; champs: ChampCarte[] })
  | (Base & { genre: "comparaison"; options: OptionComparee[] })
  | (Base & { genre: "liste"; elements: ElementListe[] })
  | (Base & { genre: "creneaux"; creneaux: Creneau[] });

/** Ce que la personne a rempli : les valeurs d'un formulaire, l'option choisie, les éléments gardés, le créneau. */
export interface ReponseCarte {
  valeurs?: Record<string, ValeurChamp>;
  choix?: string;
  coches?: string[];
  creneau?: number;
  /** Un mot à ajouter (comparaison, créneaux). */
  mot?: string;
}

export const LIBELLES_GENRE: Record<GenreCarte, string> = {
  formulaire: "À remplir",
  comparaison: "À départager",
  liste: "À valider",
  creneaux: "Un créneau à choisir",
};

/* ─── L'outil ─────────────────────────────────────────────────────── */

const tableau = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const OUTIL_CARTE = {
  name: "proposer_carte",
  description:
    "Montre sous ta réponse une carte que la personne remplit et envoie d'un clic, au lieu de lui poser une liste de questions. genre « formulaire » : les informations dont tu as besoin (champs), pré-remplies avec ce que tu sais déjà ; « comparaison » : 2 à 4 pistes à départager, avec leurs pour et contre, au plus une recommandée ; « liste » : des éléments à garder ou retirer (un plan, des tâches, des destinataires) ; « creneaux » : 2 à 8 créneaux proposés. Ce qu'elle envoie t'arrive dans son prochain message : termine ta réponse juste après l'appel.",
  inputSchema: {
    type: "object",
    properties: {
      genre: { type: "string", enum: [...GENRES] },
      titre: { type: "string", description: "Ce que la carte demande, en quelques mots." },
      intro: { type: "string", description: "Une phrase de contexte, si besoin." },
      champs: {
        type: "array",
        description: "formulaire : 1 à 8 champs.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            libelle: { type: "string" },
            type: { type: "string", enum: [...TYPES_CHAMP], description: "texte, long (plusieurs lignes), nombre, date, choix (une réponse), multiple (plusieurs), interrupteur (oui/non), curseur (min, max, pas)." },
            options: tableau("choix et multiple : 2 à 8 réponses."),
            requis: { type: "boolean" },
            aide: { type: "string" },
            valeur: { description: "Valeur pré-remplie." },
            min: { type: "number" },
            max: { type: "number" },
            pas: { type: "number" },
            unite: { type: "string", description: "Ex. €, jours, %." },
          },
          required: ["libelle", "type"],
        },
      },
      options: {
        type: "array",
        description: "comparaison : 2 à 4 pistes.",
        items: {
          type: "object",
          properties: { id: { type: "string" }, titre: { type: "string" }, resume: { type: "string" }, pour: tableau("Ses atouts."), contre: tableau("Ses limites."), recommandee: { type: "boolean" } },
          required: ["titre"],
        },
      },
      elements: {
        type: "array",
        description: "liste : 2 à 12 éléments, cochés par défaut sauf coche: false.",
        items: { type: "object", properties: { id: { type: "string" }, texte: { type: "string" }, coche: { type: "boolean" } }, required: ["texte"] },
      },
      creneaux: {
        type: "array",
        description: "creneaux : 2 à 8 créneaux.",
        items: { type: "object", properties: { date: { type: "string", description: "AAAA-MM-JJ" }, heure: { type: "string", description: "HH:MM" }, duree: { type: "number", description: "En minutes." } }, required: ["date", "heure"] },
      },
    },
    required: ["genre", "titre"],
  },
};

export const OUTIL_CARTE_CLAUDE = `mcp__klyra__${OUTIL_CARTE.name}`;

/** Ce que chaque agent apprend des cartes, quand l'outil est là (ce PC, ou un VPS). */
export const CONSIGNE_CARTES = `Pour lui demander plusieurs informations ou une décision (un brief, des pistes à départager, une liste à valider, un créneau), montre une carte avec proposer_carte plutôt qu'une liste de questions, puis termine ta réponse.`;

export const RETOUR_CARTE = "Carte affichée sous ta réponse. Termine ta réponse maintenant : ce qu'elle remplit arrivera dans son prochain message.";

/* ─── Lecture ─────────────────────────────────────────────────────── */

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const liste = (v: unknown, max: number, taille: number) =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
    .map((x) => texte(x, taille))
    .filter(Boolean)
    .slice(0, max);

/** Un identifiant court et stable : minuscules, chiffres et tirets ; sinon `prefixe` et son rang. */
function identifiant(v: unknown, prefixe: string, i: number, pris: Set<string>): string {
  const brut = texte(v, 40)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let id = brut || `${prefixe}${i + 1}`;
  for (let n = 2; pris.has(id); n++) id = `${brut || prefixe}-${n}`;
  pris.add(id);
  return id;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

function lireValeur(type: TypeChamp, v: unknown, options: string[]): ValeurChamp | null {
  switch (type) {
    case "texte":
    case "long":
      return typeof v === "string" && v.trim() ? v.trim().slice(0, type === "long" ? 2000 : 300) : null;
    case "nombre":
    case "curseur":
      return nombre(typeof v === "string" ? Number(v.replace(",", ".")) : v);
    case "date":
      return typeof v === "string" && DATE.test(v) ? v : null;
    case "choix":
      return typeof v === "string" && options.includes(v.trim()) ? v.trim() : null;
    case "multiple": {
      const l = liste(v, 8, 120).filter((x) => options.includes(x));
      return l.length ? l : null;
    }
    case "interrupteur":
      return typeof v === "boolean" ? v : null;
  }
}

function lireChamps(v: unknown): ChampCarte[] {
  if (!Array.isArray(v)) return [];
  const pris = new Set<string>();
  return v
    .flatMap((x, i): ChampCarte[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const libelle = texte(o.libelle, 80);
      const type = TYPES_CHAMP.find((t) => t === o.type);
      if (!libelle || !type) return [];
      const options = type === "choix" || type === "multiple" ? [...new Set(liste(o.options, 8, 120))] : [];
      if ((type === "choix" || type === "multiple") && options.length < 2) return [];
      const min = nombre(o.min);
      const max = nombre(o.max);
      if (type === "curseur" && (min === null || max === null || max <= min)) return [];
      return [
        {
          id: identifiant(o.id, "champ", i, pris),
          libelle,
          type,
          options,
          requis: o.requis === true,
          aide: texte(o.aide, 200),
          valeur: lireValeur(type, o.valeur, options),
          min,
          max,
          pas: nombre(o.pas) !== null && nombre(o.pas)! > 0 ? nombre(o.pas) : null,
          unite: texte(o.unite, 12),
        },
      ];
    })
    .slice(0, 8);
}

function lireOptions(v: unknown): OptionComparee[] {
  if (!Array.isArray(v)) return [];
  const pris = new Set<string>();
  const options = v
    .flatMap((x, i): OptionComparee[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const titre = texte(o.titre, 80);
      if (!titre) return [];
      return [{ id: identifiant(o.id, "piste", i, pris), titre, resume: texte(o.resume, 300), pour: liste(o.pour, 4, 140), contre: liste(o.contre, 4, 140), recommandee: o.recommandee === true }];
    })
    .slice(0, 4);
  // Au plus une recommandée : la première.
  const premiere = options.findIndex((o) => o.recommandee);
  return options.map((o, i) => ({ ...o, recommandee: i === premiere }));
}

function lireElements(v: unknown): ElementListe[] {
  if (!Array.isArray(v)) return [];
  const pris = new Set<string>();
  return v
    .flatMap((x, i): ElementListe[] => {
      const o = (typeof x === "string" ? { texte: x } : x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const t = texte(o.texte, 200);
      return t ? [{ id: identifiant(o.id, "element", i, pris), texte: t, coche: o.coche !== false }] : [];
    })
    .slice(0, 12);
}

function lireCreneaux(v: unknown): Creneau[] {
  if (!Array.isArray(v)) return [];
  const vus = new Set<string>();
  return v
    .flatMap((x): Creneau[] => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      const date = typeof o.date === "string" && DATE.test(o.date) ? o.date : "";
      const heure = typeof o.heure === "string" && HEURE.test(o.heure) ? o.heure : "";
      const duree = nombre(o.duree);
      if (!date || !heure || vus.has(`${date} ${heure}`)) return [];
      vus.add(`${date} ${heure}`);
      return [{ date, heure, duree: duree !== null && duree >= 5 && duree <= 720 ? Math.round(duree) : 60 }];
    })
    .sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`))
    .slice(0, 8);
}

/** La carte d'un appel à `proposer_carte`, ou la raison du refus. */
export function lireCarte(entree: Record<string, unknown>): { carte: Carte } | { refus: string } {
  const genre = GENRES.find((g) => g === entree.genre);
  if (!genre) return { refus: `Donne un genre : ${GENRES.join(", ")}.` };
  const base = { titre: texte(entree.titre, 120), intro: texte(entree.intro, 300) };
  if (!base.titre) return { refus: "Donne un titre à la carte : ce qu'elle demande, en quelques mots." };
  switch (genre) {
    case "formulaire": {
      const champs = lireChamps(entree.champs);
      return champs.length ? { carte: { ...base, genre, champs } } : { refus: "Un formulaire a de 1 à 8 champs, chacun avec un libellé et un type (2 réponses au moins pour choix et multiple, min < max pour un curseur)." };
    }
    case "comparaison": {
      const options = lireOptions(entree.options);
      return options.length >= 2 ? { carte: { ...base, genre, options } } : { refus: "Une comparaison a de 2 à 4 pistes, chacune avec un titre." };
    }
    case "liste": {
      const elements = lireElements(entree.elements);
      return elements.length >= 2 ? { carte: { ...base, genre, elements } } : { refus: "Une liste a de 2 à 12 éléments." };
    }
    case "creneaux": {
      const creneaux = lireCreneaux(entree.creneaux);
      return creneaux.length >= 2 ? { carte: { ...base, genre, creneaux } } : { refus: "Propose de 2 à 8 créneaux distincts (date AAAA-MM-JJ, heure HH:MM)." };
    }
  }
}

/** Un appel à `proposer_carte`, le même sur ce PC et sur un VPS : ce que l'outil répond. */
export function appelCarte(args: Record<string, unknown>): { texte: string; erreur: boolean } {
  const r = lireCarte(args);
  return "refus" in r ? { texte: r.refus, erreur: true } : { texte: RETOUR_CARTE, erreur: false };
}

/* ─── La réponse de la personne ───────────────────────────────────── */

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « mardi 12 novembre » (le jour de la semaine se calcule sans fuseau : la date seule). */
export function dateLisible(date: string): string {
  const [a, m, j] = date.split("-").map(Number);
  const jour = new Date(Date.UTC(a, m - 1, j)).getUTCDay();
  return `${JOURS[jour]} ${j === 1 ? "1er" : j} ${MOIS[m - 1]}`;
}

/** « 1 h 30 », « 45 min ». */
export function dureeLisible(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}

const nombreLisible = (n: number) => String(n).replace(".", ",");

/** Une valeur, telle qu'elle s'écrit dans le message envoyé ; vide si rien. */
export function valeurLisible(champ: ChampCarte, v: ValeurChamp | null | undefined): string {
  if (v === null || v === undefined) return "";
  switch (champ.type) {
    case "interrupteur":
      return v === true ? "oui" : v === false ? "non" : "";
    case "multiple":
      return Array.isArray(v) ? v.join(", ") : "";
    case "date":
      return typeof v === "string" && DATE.test(v) ? dateLisible(v) : "";
    case "nombre":
    case "curseur":
      return typeof v === "number" ? `${nombreLisible(v)}${champ.unite ? ` ${champ.unite}` : ""}` : "";
    default:
      return typeof v === "string" ? v.trim() : "";
  }
}

/** La valeur de départ d'un champ : celle pré-remplie, sinon le milieu d'un curseur, faux pour un interrupteur. */
export function valeurDepart(champ: ChampCarte): ValeurChamp | null {
  if (champ.valeur !== null) return champ.valeur;
  if (champ.type === "curseur" && champ.min !== null && champ.max !== null) return champ.min + Math.round((champ.max - champ.min) / 2 / (champ.pas ?? 1)) * (champ.pas ?? 1);
  if (champ.type === "interrupteur") return false;
  return null;
}

/** Ce qui manque avant d'envoyer (vide : la carte peut partir). */
export function manquantsCarte(carte: Carte, r: ReponseCarte): string[] {
  switch (carte.genre) {
    case "formulaire":
      return carte.champs.filter((c) => c.requis && !valeurLisible(c, r.valeurs?.[c.id] ?? null)).map((c) => c.libelle);
    case "comparaison":
      return carte.options.some((o) => o.id === r.choix) ? [] : ["une piste"];
    case "liste":
      return [];
    case "creneaux":
      return r.creneau !== undefined && carte.creneaux[r.creneau] ? [] : ["un créneau"];
  }
}

/** Le message que la carte envoie en son nom : lisible tel quel, par l'agent comme dans le fil. */
export function texteReponse(carte: Carte, r: ReponseCarte): string {
  const mot = r.mot?.trim() ? `\n\n${r.mot.trim().slice(0, 1000)}` : "";
  switch (carte.genre) {
    case "formulaire": {
      const lignes = carte.champs.map((c) => `- ${c.libelle} : ${valeurLisible(c, r.valeurs?.[c.id] ?? null) || "—"}`);
      return `${carte.titre}\n${lignes.join("\n")}${mot}`;
    }
    case "comparaison": {
      const o = carte.options.find((x) => x.id === r.choix);
      return `${carte.titre} : je choisis « ${o?.titre ?? "?"} ».${mot}`;
    }
    case "liste": {
      const gardes = carte.elements.filter((e) => r.coches?.includes(e.id) ?? e.coche);
      const retires = carte.elements.filter((e) => !gardes.includes(e));
      return [
        `${carte.titre} : ${gardes.length} sur ${carte.elements.length} gardés.`,
        gardes.length ? `Gardés :\n${gardes.map((e) => `- ${e.texte}`).join("\n")}` : "",
        retires.length ? `Retirés :\n${retires.map((e) => `- ${e.texte}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .concat(mot);
    }
    case "creneaux": {
      const c = r.creneau !== undefined ? carte.creneaux[r.creneau] : undefined;
      return `${carte.titre} : ${c ? `le ${dateLisible(c.date)} à ${c.heure} (${dureeLisible(c.duree)})` : "aucun"}.${mot}`;
    }
  }
}

/** La réponse à garder sur la carte, nettoyée (ce que l'écran note après l'envoi). */
export function reponseNette(carte: Carte, r: ReponseCarte): ReponseCarte {
  switch (carte.genre) {
    case "formulaire":
      return { valeurs: Object.fromEntries(carte.champs.flatMap((c) => (r.valeurs?.[c.id] !== undefined && r.valeurs[c.id] !== null ? [[c.id, r.valeurs[c.id]]] : []))) };
    case "comparaison":
      return { choix: r.choix, ...(r.mot?.trim() ? { mot: r.mot.trim().slice(0, 1000) } : {}) };
    case "liste":
      return { coches: carte.elements.filter((e) => r.coches?.includes(e.id) ?? e.coche).map((e) => e.id) };
    case "creneaux":
      return { creneau: r.creneau, ...(r.mot?.trim() ? { mot: r.mot.trim().slice(0, 1000) } : {}) };
  }
}
