import { normaliser, occurrences, versOrigine, type Requete } from "@/lib/recherche";

/** Le nom du surlignage (CSS Custom Highlight API), stylé par `::highlight(klyra-recherche)` dans `globals.css`. */
export const SURLIGNAGE = "klyra-recherche";

/**
 * Les mots de la requête dans un message rendu, en `Range` sur ses textes
 * (`[data-cherchable]` : les bulles de texte), sans toucher au DOM
 * du Markdown. La normalisation se fait caractère par caractère, comme la
 * recherche, pour que les positions restent justes. Un lien dont seule
 * l'adresse correspond est surligné en entier.
 */
export function plagesDans(bloc: HTMLElement, requete: Requete): { textes: Range[]; liens: Range[]; lien: HTMLAnchorElement | null } {
  const textes: Range[] = [];
  for (const zone of bloc.querySelectorAll<HTMLElement>("[data-cherchable]")) {
    const noeuds: Text[] = [];
    const debuts: number[] = [];
    let texte = "";
    const marcheur = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      noeuds.push(n as Text);
      debuts.push(texte.length);
      texte += n.nodeValue ?? "";
    }
    if (!texte) continue;
    /* Le nœud qui contient la position `i` (`fin` : la dernière unité avant elle). */
    const noeudDe = (i: number, fin: boolean) => {
      let k = noeuds.length - 1;
      while (k > 0 && (fin ? debuts[k] >= i : debuts[k] > i)) k--;
      return k;
    };
    const normal = normaliser(texte);
    for (const plage of occurrences(normal.texte, requete.termes)) {
      const [debut, fin] = versOrigine(texte, normal, plage);
      const a = noeudDe(debut, false);
      const b = noeudDe(fin, true);
      const range = document.createRange();
      range.setStart(noeuds[a], debut - debuts[a]);
      range.setEnd(noeuds[b], fin - debuts[b]);
      textes.push(range);
    }
  }

  const liens: Range[] = [];
  let lien: HTMLAnchorElement | null = null;
  for (const a of bloc.querySelectorAll<HTMLAnchorElement>("[data-cherchable] a[href]")) {
    const adresse = normaliser(a.getAttribute("href") ?? "").texte;
    if (!requete.termes.some((t) => adresse.includes(t))) continue;
    lien ??= a;
    const range = document.createRange();
    range.selectNodeContents(a);
    liens.push(range);
  }
  return { textes, liens, lien };
}
