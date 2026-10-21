import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Rendu du Markdown des fiches d'agents : paragraphes, listes à puces et
 * numérotées (avec sous-listes et paragraphes de suite), blocs de code,
 * **gras** et `code`. Assez pour les fiches, sans dépendance ni HTML brut.
 */

type Block =
  | { kind: "p"; text: string }
  /** Titre `#`, `##`… : une ligne en semi-gras (les réponses des agents en ont). */
  | { kind: "h"; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; children: Block[] }[] };

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const titre = line.match(/^#{1,6}\s+(.*)$/);
    if (titre) {
      blocks.push({ kind: "h", text: titre[1] });
      i++;
      continue;
    }
    // Tableau : gardé tel quel, en bloc à chasse fixe, pour que les colonnes restent alignées.
    if (line.trim().startsWith("|")) {
      const rangees: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rangees.push(lines[i++].trim());
      blocks.push({ kind: "code", text: rangees.filter((r) => !/^\|[\s:|-]+\|$/.test(r)).join("\n") });
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item && item[1].length === 0) {
      const ordered = /\d/.test(item[2]);
      const items: { text: string; children: Block[] }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (!m || m[1].length > 0 || /\d/.test(m[2]) !== ordered) break;
        // Lignes en retrait (sous-liste, paragraphe de suite) jusqu'au prochain élément.
        const nested: string[] = [];
        i++;
        while (i < lines.length && (lines[i].startsWith(" ") || (!lines[i].trim() && lines[i + 1]?.startsWith(" ")))) {
          nested.push(lines[i].replace(/^ {1,4}/, ""));
          i++;
        }
        items.push({ text: m[3], children: nested.length ? parseBlocks(nested.join("\n")) : [] });
        while (i < lines.length && !lines[i].trim() && lines[i + 1]?.match(LIST_ITEM)?.[1] === "") i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    const finDeParagraphe = (l: string) =>
      !l.trim() || !!l.match(LIST_ITEM) || l.trim().startsWith("```") || /^#{1,6}\s/.test(l) || l.trim().startsWith("|");
    while (i < lines.length && !finDeParagraphe(lines[i])) {
      para.push(lines[i++].trim());
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

/** **gras** et `code` dans une ligne. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-texte-principal">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="klyra-mono rounded-2xs [overflow-wrap:anywhere] bg-fond-surface-grise px-1 py-px text-[0.92em] text-texte-principal">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function renderBlocks(blocks: Block[], renderItem?: (text: string) => ReactNode, colonnes = false): ReactNode {
  return blocks.map((block, i) => {
    if (block.kind === "p") {
      return (
        <p key={i} className="m-0">
          <Inline text={block.text} />
        </p>
      );
    }
    if (block.kind === "h") {
      return (
        <p key={i} className="m-0 font-semibold text-texte-principal">
          <Inline text={block.text} />
        </p>
      );
    }
    if (block.kind === "code") {
      return (
        <pre
          key={i}
          className="klyra-mono m-0 overflow-x-auto rounded-md border border-bordure-subtile bg-fond-page p-3 text-ui-xs leading-[1.6] whitespace-pre text-texte-principal"
        >
          {block.text}
        </pre>
      );
    }
    const List = block.ordered ? "ol" : "ul";
    return (
      <List
        key={i}
        className={cn(
          "m-0 list-none pl-0",
          colonnes ? "grid grid-cols-1 gap-x-8 gap-y-3 @4xl:grid-cols-2" : "flex flex-col gap-2",
        )}
      >
        {block.items.map((item, j) => (
          <li key={j} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "shrink-0",
                block.ordered ? "klyra-mono w-5 pt-px text-ui-xs font-medium text-texte-accent" : "mt-[0.6em] size-1 bg-gris-k1-300",
              )}
            >
              {block.ordered ? String(j + 1).padStart(2, "0") : null}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span>{renderItem ? renderItem(item.text) : <Inline text={item.text} />}</span>
              {item.children.length > 0 && renderBlocks(item.children, renderItem)}
            </div>
          </li>
        ))}
      </List>
    );
  });
}

interface MarkdownProps {
  source: string;
  className?: string;
  /** Rendu personnalisé d'un élément de liste (ex. collègues cliquables). */
  renderItem?: (text: string) => ReactNode;
  /** Listes de premier niveau sur deux colonnes quand la place le permet (@container). */
  colonnes?: boolean;
}

export function Markdown({ source, className, renderItem, colonnes }: MarkdownProps) {
  return (
    <div className={cn("flex flex-col gap-3 text-ui leading-[1.55] text-texte-secondaire", className)}>
      {renderBlocks(parseBlocks(source), renderItem, colonnes)}
    </div>
  );
}
