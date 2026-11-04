import { lireMarkdown, texteBrut, type Bloc, type Inline } from "./markdown";

/** Au-delà, on ne lit que le début du message : l'aperçu tient sur une ligne. */
const LONGUEUR_LUE = 600;

/**
 * Un message en Markdown ramené à une seule ligne, pour l'aperçu d'une conversation :
 * gras, italique, barré et code gardés ; titres, listes, citations et tableaux mis à
 * plat ; liens et images réduits à leur texte. Les espaces et sauts de ligne sont resserrés.
 */
export function extraitMarkdown(source: string): Inline[] {
  const { blocs } = lireMarkdown(debut(source));
  const morceaux: Inline[][] = [];
  for (const bloc of blocs) aplatir(bloc, morceaux);
  const resultat: Inline[] = [];
  morceaux.forEach((m, i) => {
    if (i > 0) resultat.push({ type: "texte", texte: " " });
    resultat.push(...m);
  });
  return resserrer(resultat);
}

/** Le même extrait, en texte seul. */
export function texteExtrait(source: string): string {
  return texteBrut(extraitMarkdown(source)).trim();
}

/** Le début du message, coupé à une fin de ligne pour ne pas laisser un `**` ouvert. */
function debut(source: string): string {
  if (source.length <= LONGUEUR_LUE) return source;
  const coupe = source.lastIndexOf("\n", LONGUEUR_LUE);
  return source.slice(0, coupe > 0 ? coupe : LONGUEUR_LUE);
}

function aplatir(bloc: Bloc, morceaux: Inline[][]): void {
  switch (bloc.type) {
    case "titre":
    case "paragraphe":
      morceaux.push(bloc.contenu);
      return;
    case "code":
      if (bloc.texte.trim()) morceaux.push([{ type: "texte", texte: bloc.texte }]);
      return;
    case "citation":
      for (const b of bloc.blocs) aplatir(b, morceaux);
      return;
    case "liste":
      for (const element of bloc.elements) for (const b of element.blocs) aplatir(b, morceaux);
      return;
    case "tableau":
      for (const ligne of [bloc.entete, ...bloc.lignes]) {
        const cellules = ligne.filter((c) => texteBrut(c).trim());
        if (cellules.length) morceaux.push(cellules.flatMap((c, i) => (i ? [{ type: "texte", texte: " · " } as Inline, ...c] : c)));
      }
      return;
    case "separateur":
      return;
  }
}

/** Liens et images réduits à leur texte, sauts en espaces, espaces resserrés. */
function resserrer(noeuds: Inline[]): Inline[] {
  const resultat: Inline[] = [];
  const ajouterTexte = (texte: string) => {
    const dernier = resultat.at(-1);
    if (dernier?.type === "texte") dernier.texte += texte;
    else resultat.push({ type: "texte", texte });
  };
  for (const n of noeuds) {
    if (n.type === "texte") ajouterTexte(n.texte.replace(/\s+/g, " "));
    else if (n.type === "saut") ajouterTexte(" ");
    else if (n.type === "image") ajouterTexte(n.alt);
    else if (n.type === "lien") resserrer(n.enfants).forEach((e) => (e.type === "texte" ? ajouterTexte(e.texte) : resultat.push(e)));
    else if (n.type === "code") resultat.push({ type: "code", texte: n.texte.replace(/\s+/g, " ") });
    else resultat.push({ type: n.type, enfants: resserrer(n.enfants) });
  }
  // Pas d'espace en tête ni en fin de ligne.
  const premier = resultat[0];
  if (premier?.type === "texte") premier.texte = premier.texte.trimStart();
  const dernier = resultat.at(-1);
  if (dernier?.type === "texte") dernier.texte = dernier.texte.trimEnd();
  return resultat.filter((n) => n.type !== "texte" || n.texte);
}
