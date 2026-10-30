/**
 * Format d'une fiche de sous-agent Claude Code :
 *
 *   ---
 *   name: dev
 *   displayName: Hugo
 *   description: "Dev frontend… Appelle Hugo dès qu’il faut…"
 *   model: opus
 *   memory: project
 *   ---
 *
 *   # Hugo — Dev
 *   Présentation…
 *   ## Section
 *   …
 *
 * On lit et on réécrit l'en-tête en gardant l'ordre et les clés inconnues :
 * une fiche modifiée dans l'app reste identique au reste près.
 */

export interface Frontmatter {
  /** Paires clé / valeur, dans l'ordre du fichier. */
  entries: [string, string][];
}

export interface ParsedAgentFile {
  frontmatter: Frontmatter;
  body: string;
}

export interface AgentSection {
  title: string;
  body: string;
}

export interface ParsedBody {
  /** Le titre `# Hugo — Dev`, sans le dièse. */
  heading: string;
  /** Le texte entre le titre et la première section. */
  pitch: string;
  sections: AgentSection[];
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\])/g, "$1").replace(/\\n/g, "\n");
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Valeur YAML sûre : entre guillemets si elle contient un caractère spécial. */
function quote(value: string): string {
  if (/^[A-Za-z0-9 _.\-À-ÿ’]+$/.test(value) && value.trim() === value && value !== "") return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function parseAgentFile(content: string): ParsedAgentFile {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: { entries: [] }, body: normalized };
  const entries: [string, string][] = [];
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z][\w-]*):\s?(.*)$/);
    if (m) entries.push([m[1], unquote(m[2])]);
  }
  return { frontmatter: { entries }, body: normalized.slice(match[0].length).replace(/^\n+/, "") };
}

export function getField(fm: Frontmatter, key: string): string | undefined {
  return fm.entries.find(([k]) => k === key)?.[1];
}

/** Met à jour (ou ajoute) des clés, en gardant l'ordre et les autres clés. */
export function setFields(fm: Frontmatter, values: Record<string, string | undefined>): Frontmatter {
  const entries = fm.entries.map(([k, v]): [string, string] => [k, k in values && values[k] !== undefined ? values[k]! : v]);
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && !entries.some(([key]) => key === k)) entries.push([k, v]);
  }
  return { entries: entries.filter(([, v]) => v !== "") };
}

export function serializeAgentFile({ frontmatter, body }: ParsedAgentFile): string {
  const head = frontmatter.entries.map(([k, v]) => `${k}: ${k === "description" ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : quote(v)}`);
  return `---\n${head.join("\n")}\n---\n\n${body.trim()}\n`;
}

export function parseBody(body: string): ParsedBody {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let heading = "";
  const pitch: string[] = [];
  const sections: AgentSection[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) inFence = !inFence;
    const h1 = !inFence && line.match(/^#\s+(.+)$/);
    const h2 = !inFence && line.match(/^##\s+(.+)$/);
    if (h1 && !heading && sections.length === 0) heading = h1[1].trim();
    else if (h2) sections.push({ title: h2[1].trim(), body: "" });
    else if (sections.length) sections[sections.length - 1].body += `${line}\n`;
    else pitch.push(line);
  }
  return {
    heading,
    pitch: pitch.join("\n").trim(),
    sections: sections.map((s) => ({ title: s.title, body: s.body.trim() })),
  };
}

/** Découpe sur les virgules qui ne sont pas entre parenthèses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * La description suit le motif « Rôle — ce qu’il couvre. Appelle X dès… » :
 * on en tire le rôle complet, les compétences et la phrase « quand l’appeler ».
 */
export function splitDescription(description: string): { title: string; skills: string[]; whenToCall: string } {
  const [before, ...rest] = description.split(" — ");
  const after = rest.join(" — ");
  if (!after) return { title: "", skills: [], whenToCall: description };
  const idx = after.search(/\bAppelle\b/);
  const coverage = (idx >= 0 ? after.slice(0, idx) : after).trim().replace(/[.;:]\s*$/, "");
  const whenToCall = idx >= 0 ? after.slice(idx).trim() : "";
  return {
    title: before.trim(),
    skills: splitTopLevel(coverage.replace(/^[^:]+:\s*/, (m) => (m.length < 60 ? "" : m))).map(capitalize),
    whenToCall,
  };
}

/** Collègues cités dans « Ce que je ne fais pas » : « → Iris (designer) ». */
export function findColleagues(text: string): { name: string; id: string }[] {
  return [...text.matchAll(/([A-ZÀ-Ý][\p{L}-]+)\s*\(([a-z0-9-]+)\)/gu)].map((m) => ({ name: m[1], id: m[2] }));
}

/** Squelette d'une nouvelle fiche, avec le bloc commun de l'équipe. */
export function newAgentBody(displayName: string, role: string, commonBlock: string): string {
  return `# ${displayName || "Prénom"} — ${role || "Rôle"}

Présente-toi en deux phrases, à la première personne : ce que tu fais, ce que tu livres.

## Comment je travaille

1. **Le projet fait autorité.** Ce que tu lis avant de commencer.
2. Ta deuxième règle.

## Ce que je ne fais pas

- Une tâche qui revient à un collègue → le collègue actif qui s’en charge.

## Critères de sortie

- Ce qui doit être vrai pour que ton travail soit fini, et ce que tu as vérifié toi-même.

${commonBlock}`;
}
