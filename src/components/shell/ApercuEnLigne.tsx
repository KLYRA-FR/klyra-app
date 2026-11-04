import type { Inline } from "@/lib/apercu/markdown";

/**
 * L'aperçu d'un message sur une ligne de la barre, avec sa mise en forme en ligne
 * (`extraitMarkdown`). Aucun lien actif : la ligne entière est déjà un lien.
 */
export function ApercuEnLigne({ contenu }: { contenu: Inline[] }) {
  return <>{contenu.map((n, i) => rendu(n, i))}</>;
}

function rendu(n: Inline, cle: number) {
  switch (n.type) {
    case "texte":
      return n.texte;
    case "code":
      return (
        <code key={cle} className="rounded-2xs bg-fond-surface-grise px-1 font-[inherit]">
          {n.texte}
        </code>
      );
    case "gras":
      return (
        <strong key={cle} className="font-semibold text-texte-secondaire">
          <ApercuEnLigne contenu={n.enfants} />
        </strong>
      );
    case "italique":
      return (
        <em key={cle}>
          <ApercuEnLigne contenu={n.enfants} />
        </em>
      );
    case "barre":
      return (
        <s key={cle}>
          <ApercuEnLigne contenu={n.enfants} />
        </s>
      );
    case "lien":
      return <ApercuEnLigne key={cle} contenu={n.enfants} />;
    case "image":
      return n.alt;
    case "saut":
      return " ";
  }
}
