import { formatIntegre, formaterNombre, Grille, reference, type Cellule, type Feuille } from "./classeur";
import { descendant, enfant, enfants, lireRelations, lireXml, texteDe, type Noeud } from "./xml";
import { estOle, lireXls } from "./xls";
import { cibleRelation, ErreurApercu, ILLISIBLE, ouvrirZip, type Archive } from "./zip";

/** Les feuilles visibles d'un classeur Excel (.xlsx, .xlsm), lues sur l'ordinateur. */
export function lireXlsx(octets: Buffer): Feuille[] {
  // Un ancien classeur renommé en .xlsx, ou un classeur chiffré (conteneur OLE dans les deux cas).
  if (estOle(octets)) return lireXls(octets);
  const zip = ouvrirZip(octets);
  const cheminClasseur = [...lireRelations(zip.lireTexte("_rels/.rels")).values()].find((r) => r.type.endsWith("/officeDocument"))?.cible;
  const classeurPartie = cibleRelation("", cheminClasseur ?? "xl/workbook.xml");
  const dossier = classeurPartie.split("/").slice(0, -1).join("/");
  const xmlClasseur = zip.lireTexte(classeurPartie);
  if (!xmlClasseur) throw new ErreurApercu(ILLISIBLE);

  const classeur = lireXml(xmlClasseur);
  const proprietes = descendant(classeur, "workbookPr")?.attributs;
  const date1904 = proprietes?.date1904 === "1" || proprietes?.date1904 === "true";
  const relations = lireRelations(zip.lireTexte(`${dossier}/_rels/${classeurPartie.split("/").pop()}.rels`));
  const partie = (type: string, defaut: string) => {
    const r = [...relations.values()].find((x) => x.type.endsWith(`/${type}`));
    return r ? cibleRelation(dossier, r.cible) : `${dossier}/${defaut}`;
  };

  const chaines = lireChaines(zip, partie("sharedStrings", "sharedStrings.xml"));
  const formats = lireFormats(zip, partie("styles", "styles.xml"));

  const feuilles: Feuille[] = [];
  for (const f of enfants(descendant(classeur, "sheets"), "sheet")) {
    if (f.attributs.state === "hidden" || f.attributs.state === "veryHidden") continue;
    const relation = relations.get(f.attributs.id);
    if (!relation || !relation.type.endsWith("/worksheet")) continue;
    const xml = zip.lireTexte(cibleRelation(dossier, relation.cible));
    if (xml) feuilles.push(lireFeuille(f.attributs.name ?? "Feuille", lireXml(xml), chaines, formats, date1904));
  }
  if (!feuilles.length) throw new ErreurApercu("Ce classeur n’a pas de feuille à montrer.");
  return feuilles;
}

/** Le texte d'une chaîne riche, sans les indications phonétiques (`rPh`). */
function texteChaine(si: Noeud): string {
  return enfants(si)
    .filter((e) => e.nom !== "rPh" && e.nom !== "phoneticPr")
    .map((e) => (e.nom === "t" ? texteDe(e) : texteDe(e, "t")))
    .join("");
}

function lireChaines(zip: Archive, chemin: string): string[] {
  const xml = zip.lireTexte(chemin);
  if (!xml) return [];
  return enfants(descendant(lireXml(xml), "sst"), "si").map(texteChaine);
}

/** Pour chaque style de cellule (`s`), son format de nombre. */
function lireFormats(zip: Archive, chemin: string): (string | null)[] {
  const xml = zip.lireTexte(chemin);
  if (!xml) return [];
  const styles = lireXml(xml);
  const personnalises = new Map<number, string>();
  for (const f of enfants(descendant(styles, "numFmts"), "numFmt")) personnalises.set(Number(f.attributs.numFmtId), f.attributs.formatCode ?? "");
  return enfants(descendant(styles, "cellXfs"), "xf").map((xf) => {
    const id = Number(xf.attributs.numFmtId ?? 0);
    return personnalises.get(id) ?? formatIntegre(id);
  });
}

function lireFeuille(nom: string, xml: Noeud, chaines: string[], formats: (string | null)[], date1904: boolean): Feuille {
  const grille = new Grille();
  let numeroLigne = -1;
  for (const ligne of enfants(descendant(xml, "sheetData"), "row")) {
    numeroLigne = ligne.attributs.r ? Number(ligne.attributs.r) - 1 : numeroLigne + 1;
    let numeroColonne = -1;
    for (const c of enfants(ligne, "c")) {
      const ref = c.attributs.r ? reference(c.attributs.r) : null;
      numeroColonne = ref ? ref[1] : numeroColonne + 1;
      const cellule = valeur(c, chaines, formats, date1904);
      if (cellule) grille.poser(ref ? ref[0] : numeroLigne, numeroColonne, cellule);
    }
  }
  return grille.feuille(nom);
}

function valeur(c: Noeud, chaines: string[], formats: (string | null)[], date1904: boolean): Cellule | null {
  const v = texteDe(enfant(c, "v"));
  switch (c.attributs.t) {
    case "s":
      return { texte: chaines[Number(v)] ?? "" };
    case "inlineStr":
      return { texte: texteChaine(enfant(c, "is") ?? c) };
    case "str":
    case "e":
      return { texte: v };
    case "b":
      return { texte: v === "1" || v === "true" ? "VRAI" : "FAUX" };
    case "d": {
      const date = new Date(v);
      if (Number.isNaN(date.getTime())) return { texte: v };
      const serie = (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
      return { texte: formaterNombre(serie, formats[Number(c.attributs.s ?? 0)] ?? "dd/mm/yyyy", false), nombre: true };
    }
    default: {
      if (v === "") return null;
      const n = Number(v);
      if (Number.isNaN(n)) return { texte: v };
      return { texte: formaterNombre(n, formats[Number(c.attributs.s ?? 0)] ?? null, date1904), nombre: true };
    }
  }
}
