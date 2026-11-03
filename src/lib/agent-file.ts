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
  /**
   * Les lignes en retrait sous une clé (liste `- a`, sous-clés), gardées telles quelles : `skills:` ou
   * `tools:` en liste, `mcpServers:`, `hooks:`… La valeur de la clé est alors ce qui suit ses deux-points
   * (souvent vide). Une clé réécrite par l'app perd son bloc ; les autres le gardent mot pour mot.
   */
  blocs?: Record<string, string>;
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

/** Un bloc `>` (replié) ou `|` (littéral) : ses lignes sans leur retrait commun. */
function scalaireBloc(indicateur: string, lignes: string[]): string {
  const retrait = Math.min(...lignes.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  const texte = lignes.map((l) => l.slice(Number.isFinite(retrait) ? retrait : 0));
  return (indicateur.startsWith(">") ? texte.join(" ").replace(/ {2,}/g, " ") : texte.join("\n")).trim();
}

export function parseAgentFile(content: string): ParsedAgentFile {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: { entries: [] }, body: normalized };
  const entries: [string, string][] = [];
  const blocs: Record<string, string> = {};
  const suite: Record<string, string[]> = {};
  let cle: string | null = null;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z][\w-]*):\s?(.*)$/);
    if (m) {
      cle = m[1];
      entries.push([m[1], unquote(m[2])]);
    } else if (cle && /^(\s+\S|-\s)/.test(line)) (suite[cle] ??= []).push(line);
  }
  for (const [k, lignes] of Object.entries(suite)) {
    const i = entries.findIndex(([key]) => key === k);
    if (/^[|>][+-]?$/.test(entries[i][1])) entries[i] = [k, scalaireBloc(entries[i][1], lignes)];
    else blocs[k] = lignes.join("\n");
  }
  return { frontmatter: { entries, ...(Object.keys(blocs).length ? { blocs } : {}) }, body: normalized.slice(match[0].length).replace(/^\n+/, "") };
}

/** Une liste de l'en-tête : `cle: a, b`, `cle: [a, b]` ou en lignes `- a`. */
export function getListe(fm: Frontmatter, key: string): string[] {
  const nettoyer = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  const bloc = fm.blocs?.[key];
  if (bloc)
    return bloc
      .split("\n")
      .map((l) => /^\s*-\s+(.+)$/.exec(l)?.[1])
      .filter((v): v is string => !!v)
      .map(nettoyer)
      .filter(Boolean);
  return (getField(fm, key) ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(nettoyer)
    .filter(Boolean);
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
  // Une clé réécrite perd son bloc ; une clé vide disparaît, sauf si son bloc la porte.
  const blocs = Object.fromEntries(Object.entries(fm.blocs ?? {}).filter(([k]) => values[k] === undefined));
  return { entries: entries.filter(([k, v]) => v !== "" || k in blocs), ...(Object.keys(blocs).length ? { blocs } : {}) };
}

/** Écrit une liste en lignes `- a` (la forme de la documentation de Claude Code) ; vide, la clé disparaît. */
export function setListe(fm: Frontmatter, key: string, valeurs: string[]): Frontmatter {
  const propres = [...new Set(valeurs.map((v) => v.trim()).filter(Boolean))];
  const sans = setFields(fm, { [key]: "" });
  if (!propres.length) return sans;
  const entries: [string, string][] = fm.entries.some(([k]) => k === key)
    ? fm.entries.filter(([k, v]) => k === key || v !== "" || k in (sans.blocs ?? {})).map(([k, v]): [string, string] => [k, k === key ? "" : v])
    : [...sans.entries, [key, ""]];
  return { entries, blocs: { ...(sans.blocs ?? {}), [key]: propres.map((v) => `  - ${/^[\w.:-]+$/.test(v) ? v : JSON.stringify(v)}`).join("\n") } };
}

export function serializeAgentFile({ frontmatter, body }: ParsedAgentFile): string {
  const head = frontmatter.entries.map(([k, v]) => {
    const bloc = frontmatter.blocs?.[k];
    const ligne = bloc && v === "" ? `${k}:` : `${k}: ${k === "description" ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : quote(v)}`;
    return bloc ? `${ligne}\n${bloc}` : ligne;
  });
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
