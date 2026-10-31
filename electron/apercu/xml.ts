/**
 * Un lecteur XML minimal pour les parties d'un xlsx ou d'un docx : éléments,
 * attributs et texte, préfixes d'espace de noms retirés (`w:p` → `p`).
 * Aucune entité externe ni DTD : seules les cinq entités de base et les
 * références numériques sont décodées.
 */

export interface Noeud {
  nom: string;
  attributs: Record<string, string>;
  enfants: (Noeud | string)[];
}

const ENTITES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decoder(texte: string): string {
  if (!texte.includes("&")) return texte;
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, e: string) => {
    if (e[0] !== "#") return ENTITES[e] ?? tout;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const local = (nom: string) => nom.slice(nom.indexOf(":") + 1);

export function lireXml(source: string): Noeud {
  const racine: Noeud = { nom: "#document", attributs: {}, enfants: [] };
  const pile: Noeud[] = [racine];
  let pos = 0;
  while (pos < source.length) {
    const ouvrant = source.indexOf("<", pos);
    const courant = pile[pile.length - 1];
    if (ouvrant < 0) break;
    if (ouvrant > pos) courant.enfants.push(decoder(source.slice(pos, ouvrant)));
    if (source.startsWith("<!--", ouvrant)) {
      const fin = source.indexOf("-->", ouvrant + 4);
      pos = fin < 0 ? source.length : fin + 3;
    } else if (source.startsWith("<![CDATA[", ouvrant)) {
      const fin = source.indexOf("]]>", ouvrant + 9);
      courant.enfants.push(source.slice(ouvrant + 9, fin < 0 ? source.length : fin));
      pos = fin < 0 ? source.length : fin + 3;
    } else if (source[ouvrant + 1] === "?" || source[ouvrant + 1] === "!") {
      const fin = source.indexOf(">", ouvrant);
      pos = fin < 0 ? source.length : fin + 1;
    } else if (source[ouvrant + 1] === "/") {
      const fin = source.indexOf(">", ouvrant);
      if (pile.length > 1) pile.pop();
      pos = fin < 0 ? source.length : fin + 1;
    } else {
      // Fin de la balise, hors des valeurs d'attribut entre guillemets.
      let fin = ouvrant + 1;
      let guillemet = "";
      for (; fin < source.length; fin++) {
        const c = source[fin];
        if (guillemet) {
          if (c === guillemet) guillemet = "";
        } else if (c === '"' || c === "'") guillemet = c;
        else if (c === ">") break;
      }
      const autoFermant = source[fin - 1] === "/";
      const corps = source.slice(ouvrant + 1, autoFermant ? fin - 1 : fin);
      const espace = corps.search(/\s/);
      const nom = local(espace < 0 ? corps : corps.slice(0, espace));
      const attributs: Record<string, string> = {};
      if (espace >= 0) {
        for (const m of corps.slice(espace).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          if (m[1] === "xmlns" || m[1].startsWith("xmlns:")) continue;
          attributs[local(m[1])] = decoder(m[2] ?? m[3] ?? "");
        }
      }
      const noeud: Noeud = { nom, attributs, enfants: [] };
      courant.enfants.push(noeud);
      if (!autoFermant) pile.push(noeud);
      pos = fin + 1;
    }
  }
  return racine;
}

/** Les enfants élément d'un nœud, ceux d'un nom donné s'il est précisé. */
export function enfants(noeud: Noeud | undefined, nom?: string): Noeud[] {
  if (!noeud) return [];
  return noeud.enfants.filter((e): e is Noeud => typeof e !== "string" && (!nom || e.nom === nom));
}

export function enfant(noeud: Noeud | undefined, nom: string): Noeud | undefined {
  return noeud?.enfants.find((e): e is Noeud => typeof e !== "string" && e.nom === nom);
}

/** Le premier descendant d'un nom donné (parcours en profondeur). */
export function descendant(noeud: Noeud | undefined, nom: string): Noeud | undefined {
  if (!noeud) return undefined;
  for (const e of enfants(noeud)) {
    if (e.nom === nom) return e;
    const trouve = descendant(e, nom);
    if (trouve) return trouve;
  }
  return undefined;
}

/** Tout le texte d'un nœud, ou seulement celui de ses éléments `nom` (`t` d'une chaîne partagée). */
export function texteDe(noeud: Noeud | undefined, nom?: string): string {
  if (!noeud) return "";
  let texte = "";
  for (const e of noeud.enfants) {
    if (typeof e === "string") {
      if (!nom) texte += e;
    } else if (nom && e.nom === nom) texte += texteDe(e);
    else texte += texteDe(e, nom);
  }
  return texte;
}

/** Les relations d'une partie (`_rels/x.xml.rels`) : id → cible et mode. */
export function lireRelations(xml: string | null): Map<string, { cible: string; externe: boolean; type: string }> {
  const relations = new Map<string, { cible: string; externe: boolean; type: string }>();
  if (!xml) return relations;
  for (const r of enfants(descendant(lireXml(xml), "Relationships"), "Relationship")) {
    relations.set(r.attributs.Id, { cible: r.attributs.Target ?? "", externe: r.attributs.TargetMode === "External", type: r.attributs.Type ?? "" });
  }
  return relations;
}
