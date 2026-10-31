import { descendant, enfant, enfants, lireRelations, lireXml, texteDe, type Noeud } from "./xml";
import { estChiffre, estOle } from "./xls";
import { cibleRelation, ErreurApercu, ILLISIBLE, ouvrirZip, PROTEGE } from "./zip";

/**
 * Le texte d'un document Word (.docx), lu sur l'ordinateur : titres, paragraphes,
 * listes, tableaux, gras, italique et liens. Pas la mise en page de Word
 * (polices, marges, images, en-têtes, notes) : une lecture simple et fidèle.
 */

export interface Morceau {
  texte: string;
  gras?: true;
  italique?: true;
  souligne?: true;
  barre?: true;
  /** Lien externe (http, https, mailto) seulement. */
  lien?: string;
}

export interface CelluleDocument {
  morceaux: Morceau[];
  /** Colonnes fusionnées (gridSpan). */
  etendue?: number;
}

export type BlocDocument =
  | { type: "titre"; niveau: number; morceaux: Morceau[] }
  | { type: "paragraphe"; morceaux: Morceau[]; style?: "titre" | "sous-titre" | "citation" }
  | { type: "liste"; niveau: number; marque: string | null; morceaux: Morceau[] }
  | { type: "tableau"; lignes: CelluleDocument[][] };

const BLOCS_MAX = 5000;

interface Style {
  nom: string;
  plan: number | null;
  numerotation: { id: string; niveau: number } | null;
  parent: string | null;
}

interface Niveau {
  format: string;
  texte: string;
  depart: number;
}

export function lireDocx(octets: Buffer): BlocDocument[] {
  // Un document chiffré, ou un ancien .doc renommé : conteneur OLE, pas d'aperçu.
  if (estOle(octets)) throw new ErreurApercu(estChiffre(octets) ? PROTEGE : ILLISIBLE);
  const zip = ouvrirZip(octets);
  const principal = [...lireRelations(zip.lireTexte("_rels/.rels")).values()].find((r) => r.type.endsWith("/officeDocument"))?.cible;
  const partie = cibleRelation("", principal ?? "word/document.xml");
  const dossier = partie.split("/").slice(0, -1).join("/");
  const xml = zip.lireTexte(partie);
  if (!xml) throw new ErreurApercu(ILLISIBLE);
  const relations = lireRelations(zip.lireTexte(`${dossier}/_rels/${partie.split("/").pop()}.rels`));
  const cheminDe = (type: string, defaut: string) => {
    const r = [...relations.values()].find((x) => x.type.endsWith(`/${type}`));
    return r ? cibleRelation(dossier, r.cible) : `${dossier}/${defaut}`;
  };

  const styles = lireStyles(zip.lireTexte(cheminDe("styles", "styles.xml")));
  const numerotations = lireNumerotations(zip.lireTexte(cheminDe("numbering", "numbering.xml")));
  const compteurs = new Map<string, number[]>();

  const lienDe = (id: string | undefined) => {
    const r = id ? relations.get(id) : undefined;
    return r?.externe && /^(https?:|mailto:)/i.test(r.cible) ? r.cible : undefined;
  };

  /** Le style d'un paragraphe et de ses parents (basedOn), du plus proche au plus lointain. */
  const lignee = (id: string | undefined): Style[] => {
    const suite: Style[] = [];
    for (let s = id ? styles.get(id) : undefined; s && suite.length < 10; s = s.parent ? styles.get(s.parent) : undefined) suite.push(s);
    return suite;
  };

  const morceauxDe = (paragraphe: Noeud): Morceau[] => {
    const morceaux: Morceau[] = [];
    const parcourir = (noeud: Noeud, lien?: string) => {
      for (const e of enfants(noeud)) {
        if (e.nom === "r") ajouterRun(e, lien, morceaux);
        else if (e.nom === "hyperlink") parcourir(e, lienDe(e.attributs.id));
        else if (["ins", "smartTag", "fldSimple", "customXml", "sdtContent", "sdt"].includes(e.nom)) parcourir(e, lien);
      }
    };
    parcourir(paragraphe);
    return fusionner(morceaux);
  };

  const blocs: BlocDocument[] = [];
  const paragraphe = (p: Noeud) => {
    const pPr = enfant(p, "pPr");
    const suite = lignee(enfant(pPr, "pStyle")?.attributs.val);
    const morceaux = morceauxDe(p);
    if (!morceaux.some((m) => m.texte.trim())) return;

    const nom = suite[0]?.nom ?? "";
    const titre = suite.map((s) => /^heading (\d)$/.exec(s.nom)?.[1]).find(Boolean);
    const planDirect = enfant(pPr, "outlineLvl")?.attributs.val;
    const plan = planDirect !== undefined ? Number(planDirect) : suite.find((s) => s.plan !== null)?.plan ?? null;
    if (titre || (plan !== null && plan < 6)) {
      blocs.push({ type: "titre", niveau: Math.min(6, titre ? Number(titre) : (plan ?? 0) + 1), morceaux });
      return;
    }
    if (suite.some((s) => s.nom === "title" || s.nom === "subtitle")) {
      blocs.push({ type: "paragraphe", style: suite.some((s) => s.nom === "title") ? "titre" : "sous-titre", morceaux });
      return;
    }

    const numPr = enfant(pPr, "numPr");
    const numero = numPr
      ? { id: enfant(numPr, "numId")?.attributs.val ?? "0", niveau: Number(enfant(numPr, "ilvl")?.attributs.val ?? 0) }
      : suite.find((s) => s.numerotation)?.numerotation ?? null;
    if (numero && numero.id !== "0" && numerotations.has(numero.id)) {
      const niveaux = numerotations.get(numero.id)!;
      const compte = compteurs.get(numero.id) ?? [];
      compte[numero.niveau] = (compte[numero.niveau] ?? (niveaux[numero.niveau]?.depart ?? 1) - 1) + 1;
      compte.length = numero.niveau + 1;
      compteurs.set(numero.id, compte);
      blocs.push({ type: "liste", niveau: numero.niveau, marque: marque(niveaux, compte, numero.niveau), morceaux });
      return;
    }
    blocs.push({ type: "paragraphe", morceaux, ...(/quote/.test(nom) ? { style: "citation" as const } : {}) });
  };

  const tableau = (tbl: Noeud) => {
    const lignes = enfants(tbl, "tr").map((tr) =>
      enfants(tr, "tc").map((tc) => {
        const tcPr = enfant(tc, "tcPr");
        const etendue = Number(enfant(tcPr, "gridSpan")?.attributs.val ?? 1);
        const fusionVerticale = enfant(tcPr, "vMerge");
        const suite = fusionVerticale && fusionVerticale.attributs.val !== "restart";
        const morceaux: Morceau[] = [];
        if (!suite) {
          for (const p of paragraphesDe(tc)) {
            const m = morceauxDe(p);
            if (!m.length) continue;
            if (morceaux.length) morceaux.push({ texte: "\n" });
            morceaux.push(...m);
          }
        }
        return { morceaux: fusionner(morceaux), ...(etendue > 1 ? { etendue } : {}) };
      }),
    );
    if (lignes.some((l) => l.some((c) => c.morceaux.length))) blocs.push({ type: "tableau", lignes });
  };

  const corps = (noeud: Noeud) => {
    for (const e of enfants(noeud)) {
      if (blocs.length >= BLOCS_MAX) return;
      if (e.nom === "p") paragraphe(e);
      else if (e.nom === "tbl") tableau(e);
      else if (["sdt", "sdtContent", "customXml", "ins"].includes(e.nom)) corps(e);
    }
  };
  corps(descendant(lireXml(xml), "body") ?? lireXml(""));
  return blocs;
}

/** Les paragraphes d'une cellule, tableaux imbriqués compris. */
function paragraphesDe(noeud: Noeud): Noeud[] {
  return enfants(noeud).flatMap((e) => (e.nom === "p" ? [e] : ["tbl", "tr", "tc", "sdt", "sdtContent"].includes(e.nom) ? paragraphesDe(e) : []));
}

const actif = (rPr: Noeud | undefined, nom: string) => {
  const e = enfant(rPr, nom);
  return !!e && !["0", "false", "none"].includes(e.attributs.val ?? "");
};

function ajouterRun(r: Noeud, lien: string | undefined, morceaux: Morceau[]) {
  const rPr = enfant(r, "rPr");
  let texte = "";
  for (const e of enfants(r)) {
    if (e.nom === "t") texte += texteDe(e);
    else if (e.nom === "tab" || e.nom === "ptab") texte += "\t";
    else if (e.nom === "br" || e.nom === "cr") texte += "\n";
    else if (e.nom === "noBreakHyphen") texte += "‑";
  }
  if (!texte) return;
  morceaux.push({
    texte,
    ...(actif(rPr, "b") ? { gras: true as const } : {}),
    ...(actif(rPr, "i") ? { italique: true as const } : {}),
    ...(actif(rPr, "u") ? { souligne: true as const } : {}),
    ...(actif(rPr, "strike") || actif(rPr, "dstrike") ? { barre: true as const } : {}),
    ...(lien ? { lien } : {}),
  });
}

const forme = (m: Morceau) => [m.gras, m.italique, m.souligne, m.barre, m.lien].join("|");

/** Deux morceaux voisins de même mise en forme n'en font qu'un. */
function fusionner(morceaux: Morceau[]): Morceau[] {
  const resultat: Morceau[] = [];
  for (const m of morceaux) {
    const precedent = resultat[resultat.length - 1];
    if (precedent && forme(precedent) === forme(m)) precedent.texte += m.texte;
    else resultat.push({ ...m });
  }
  return resultat;
}

function lireStyles(xml: string | null): Map<string, Style> {
  const styles = new Map<string, Style>();
  if (!xml) return styles;
  for (const s of enfants(descendant(lireXml(xml), "styles"), "style")) {
    const pPr = enfant(s, "pPr");
    const numPr = enfant(pPr, "numPr");
    const plan = enfant(pPr, "outlineLvl")?.attributs.val;
    styles.set(s.attributs.styleId ?? "", {
      nom: (enfant(s, "name")?.attributs.val ?? "").toLowerCase(),
      plan: plan !== undefined ? Number(plan) : null,
      numerotation: numPr ? { id: enfant(numPr, "numId")?.attributs.val ?? "0", niveau: Number(enfant(numPr, "ilvl")?.attributs.val ?? 0) } : null,
      parent: enfant(s, "basedOn")?.attributs.val ?? null,
    });
  }
  return styles;
}

/** Pour chaque liste (numId), le format de chacun de ses niveaux. */
function lireNumerotations(xml: string | null): Map<string, Niveau[]> {
  const listes = new Map<string, Niveau[]>();
  if (!xml) return listes;
  const racine = descendant(lireXml(xml), "numbering");
  const abstraits = new Map<string, Niveau[]>();
  for (const a of enfants(racine, "abstractNum")) {
    const niveaux: Niveau[] = [];
    for (const lvl of enfants(a, "lvl")) {
      niveaux[Number(lvl.attributs.ilvl ?? 0)] = {
        format: enfant(lvl, "numFmt")?.attributs.val ?? "decimal",
        texte: enfant(lvl, "lvlText")?.attributs.val ?? "",
        depart: Number(enfant(lvl, "start")?.attributs.val ?? 1),
      };
    }
    abstraits.set(a.attributs.abstractNumId ?? "", niveaux);
  }
  for (const n of enfants(racine, "num")) {
    const niveaux = abstraits.get(enfant(n, "abstractNumId")?.attributs.val ?? "");
    if (niveaux) listes.set(n.attributs.numId ?? "", niveaux);
  }
  return listes;
}

/** La marque d'un élément de liste : null pour une puce, « 2. » ou « 1.3 » pour une liste numérotée. */
function marque(niveaux: Niveau[], compte: number[], niveau: number): string | null {
  const n = niveaux[niveau];
  if (!n || n.format === "bullet") return null;
  if (n.format === "none") return "";
  return n.texte.replace(/%(\d)/g, (_, k: string) => compteur(compte[Number(k) - 1] ?? 1, niveaux[Number(k) - 1]?.format ?? "decimal"));
}

function compteur(n: number, format: string): string {
  if (format === "lowerLetter" || format === "upperLetter") {
    const lettre = String.fromCharCode(97 + ((n - 1) % 26));
    return format === "upperLetter" ? lettre.toUpperCase() : lettre;
  }
  if (format === "lowerRoman" || format === "upperRoman") {
    const romain = romains(n);
    return format === "upperRoman" ? romain : romain.toLowerCase();
  }
  return String(n);
}

function romains(n: number): string {
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let texte = "";
  for (const [valeur, signe] of table) {
    while (n >= valeur) {
      texte += signe;
      n -= valeur;
    }
  }
  return texte;
}
