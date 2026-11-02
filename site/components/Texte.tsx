import { morceaux } from "../lib/changelog";

/** Un texte de note avec son **gras** et son `code`, rendu en éléments React. */
export function Texte({ children }: { children: string }) {
  return (
    <>
      {morceaux(children).map((morceau, i) => {
        if (morceau.type === "gras") return <strong key={i} className="klyra-cl-gras">{morceau.texte}</strong>;
        if (morceau.type === "code") return <code key={i} className="klyra-cl-code">{morceau.texte}</code>;
        return <span key={i}>{morceau.texte}</span>;
      })}
    </>
  );
}
