/**
 * Coloration syntaxique de la vue Source, sans dépendance : chaque langage est
 * une liste de règles (expressions collées, drapeau `y`) essayées dans l'ordre,
 * puis les mots, classés en mots-clés, constantes ou types. C'est une lecture,
 * pas un analyseur : un cas rare peut rester sans couleur, jamais être modifié.
 * Un langage inconnu n'est pas coloré.
 */

export type Jeton = "motcle" | "chaine" | "nombre" | "commentaire" | "type" | "balise" | "attribut" | "cle" | "variable" | "titre" | "gras" | "lien";

export interface Morceau {
  texte: string;
  jeton: Jeton | null;
}

export type Langage = "js" | "jsx" | "json" | "css" | "html" | "python" | "go" | "rust" | "shell" | "yaml" | "sql" | "markdown";

const EXTENSIONS: Record<string, Langage> = {
  js: "js", mjs: "js", cjs: "js", ts: "js", mts: "js", cts: "js",
  jsx: "jsx", tsx: "jsx",
  json: "json", jsonc: "json", webmanifest: "json",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", xml: "html", xsd: "html", xsl: "html", plist: "html", vue: "html", svelte: "html",
  py: "python", pyw: "python",
  go: "go",
  rs: "rust",
  sh: "shell", bash: "shell", zsh: "shell",
  yml: "yaml", yaml: "yaml",
  sql: "sql",
  md: "markdown", markdown: "markdown",
};

export function langageDe(chemin: string): Langage | null {
  return EXTENSIONS[/\.([^./\\]+)$/.exec(chemin)?.[1].toLowerCase() ?? ""] ?? null;
}

/** Au-delà, la vue Source reste en noir : la coloration ralentirait l'ouverture. */
export const COLORATION_MAX = 400_000;

type Regle = [RegExp, Jeton | ((texte: string) => Morceau[])];

interface Grammaire {
  regles: Regle[];
  motscles?: Set<string>;
  constantes?: Set<string>;
  types?: Set<string>;
  /** SQL : mots-clés sans casse. */
  sansCasse?: boolean;
  /** Un mot qui commence par une majuscule est un type (classes, composants). */
  majuscules?: boolean;
}

const mots = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const COMMENTAIRE_C: Regle[] = [
  [/\/\/[^\n]*/y, "commentaire"],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, "commentaire"],
];
const CHAINES: Regle[] = [
  [/"(?:[^"\\\n]|\\.)*"?/y, "chaine"],
  [/'(?:[^'\\\n]|\\.)*'?/y, "chaine"],
];
const NOMBRE: Regle = [/(?:0x[\da-f_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?|\.\d+)[a-z%]*/iy, "nombre"];
const DIESE: Regle = [/(?<=^|[ \t\n])#[^\n]*/y, "commentaire"];

const JS: Grammaire = {
  regles: [...COMMENTAIRE_C, [/`(?:[^`\\]|\\[\s\S])*`?/y, "chaine"], ...CHAINES, NOMBRE],
  motscles: mots(
    "break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await as interface type enum implements private protected public readonly declare namespace abstract keyof satisfies",
  ),
  constantes: mots("true false null undefined NaN Infinity"),
  types: mots("string number boolean any unknown never object void bigint symbol"),
  majuscules: true,
};

/** Une balise HTML, XML ou JSX découpée : nom, attributs, valeurs. */
function balise(texte: string): Morceau[] {
  const morceaux: Morceau[] = [];
  const nom = /^<\/?[^\s/>]+/.exec(texte)![0];
  morceaux.push({ texte: nom, jeton: "balise" });
  let reste = texte.slice(nom.length);
  const fin = /\/?>$/.exec(reste)?.[0] ?? "";
  reste = reste.slice(0, reste.length - fin.length);
  for (const m of reste.matchAll(/(\s+)|([^\s=]+)(?=\s*=)|("[^"]*"|'[^']*'|\{[^}]*\})|(=)|([^\s=]+)/g)) {
    if (m[2]) morceaux.push({ texte: m[2], jeton: "attribut" });
    else if (m[3]) morceaux.push({ texte: m[3], jeton: m[3].startsWith("{") ? null : "chaine" });
    else if (m[5]) morceaux.push({ texte: m[5], jeton: "attribut" });
    else morceaux.push({ texte: m[0], jeton: null });
  }
  if (fin) morceaux.push({ texte: fin, jeton: "balise" });
  return morceaux;
}

const BALISE = /<\/?[A-Za-z][\w:.-]*(?:\s+[^\s=/>"'{]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}\n]*\}|[^\s>"']+))?)*\s*\/?>/y;

const LANGAGES: Record<Langage, Grammaire> = {
  js: JS,
  jsx: { ...JS, regles: [...COMMENTAIRE_C, [BALISE, balise], [/<\/?[A-Za-z][\w.]*(?=[\s>/])/y, "balise"], ...JS.regles.slice(2)] },
  json: {
    regles: [...COMMENTAIRE_C, [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, "cle"], ...CHAINES, [/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/iy, "nombre"]],
    constantes: mots("true false null"),
  },
  css: {
    regles: [
      [/\/\*[\s\S]*?(?:\*\/|$)/y, "commentaire"],
      [/(?<=^|[\s;{])\/\/[^\n]*/y, "commentaire"],
      ...CHAINES,
      [/#[\da-f]{3,8}\b/iy, "nombre"],
      [/@[\w-]+/y, "motcle"],
      [/!important\b/y, "motcle"],
      [/--?[A-Za-z][\w-]*(?=\s*:[^;{}\n]*(?:[;}\n]|$))|[A-Za-z][\w-]*(?=\s*:[^;{}\n]*(?:[;}\n]|$))/y, "cle"],
      [/\$[\w-]+/y, "variable"],
      [/-?(?:\d*\.\d+|\d+)(?:px|r?em|%|vh|vw|vmin|vmax|ch|ex|s|ms|deg|turn|fr|dpi)?\b/y, "nombre"],
    ],
  },
  html: {
    regles: [
      [/<!--[\s\S]*?(?:-->|$)/y, "commentaire"],
      [/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/y, "chaine"],
      [/<![A-Za-z][^>]*>|<\?[\s\S]*?(?:\?>|$)/y, "motcle"],
      [BALISE, balise],
      [/&(?:#x?[\da-f]+|[a-z]+);/iy, "nombre"],
    ],
  },
  python: {
    regles: [
      DIESE,
      [/[rbuf]{0,2}("""|''')[\s\S]*?(?:\1|$)/iy, "chaine"],
      [/[rbuf]{0,2}"(?:[^"\\\n]|\\.)*"?/iy, "chaine"],
      [/[rbuf]{0,2}'(?:[^'\\\n]|\\.)*'?/iy, "chaine"],
      [/@[\w.]+/y, "variable"],
      NOMBRE,
    ],
    motscles: mots("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
    constantes: mots("True False None self cls"),
    types: mots("int float str bool list dict set tuple bytes object"),
    majuscules: true,
  },
  go: {
    regles: [...COMMENTAIRE_C, [/`[^`]*`?/y, "chaine"], ...CHAINES, NOMBRE],
    motscles: mots("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
    constantes: mots("true false nil iota"),
    types: mots("string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 bool byte rune error any"),
    majuscules: true,
  },
  rust: {
    regles: [
      ...COMMENTAIRE_C,
      [/r(#*)"[\s\S]*?(?:"\1|$)/y, "chaine"],
      [/b?"(?:[^"\\]|\\[\s\S])*"?/y, "chaine"],
      [/b?'(?:[^'\\\n]|\\.[^']*)'/y, "chaine"],
      [/'[a-z_]\w*/y, "type"],
      [/[a-z_]\w*!(?=\s*[([{])/y, "variable"],
      [/#!?\[[^\]\n]*\]/y, "variable"],
      NOMBRE,
    ],
    motscles: mots("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self static struct super trait type unsafe use where while"),
    constantes: mots("true false None Some Ok Err"),
    types: mots("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Self"),
    majuscules: true,
  },
  shell: {
    regles: [
      [/^#![^\n]*/y, "commentaire"],
      DIESE,
      [/\$\{[^}\n]*\}|\$\(|\$[\w@#?$!*-]/y, "variable"],
      [/"(?:[^"\\]|\\[\s\S])*"?/y, "chaine"],
      [/'[^']*'?/y, "chaine"],
      [/(?<![\w-])\d+(?![\w-])/y, "nombre"],
    ],
    motscles: mots("if then else elif fi for while until do done case esac in function return local export readonly declare set unset shift exit source alias select time break continue"),
  },
  yaml: {
    regles: [
      DIESE,
      [/(?<=^|\n)(?:---|\.\.\.)(?=\s|$)/y, "motcle"],
      [/(?<=^|\n)[ \t]*(?:- +)?(?:"[^"\n]*"|'[^'\n]*'|[^\s#:"'\-[{][^:\n#]*?)(?=:(?:[ \t]|\n|$))/y, "cle"],
      ...CHAINES,
      [/[&*][\w-]+|!![\w]+/y, "variable"],
      [/(?<=[\s:\-[,])-?\d+(?:\.\d+)?(?=\s*(?:$|\n|#|,|\]))/y, "nombre"],
    ],
    constantes: mots("true false null yes no on off True False Null"),
  },
  sql: {
    regles: [[/--[^\n]*/y, "commentaire"], [/\/\*[\s\S]*?(?:\*\/|$)/y, "commentaire"], [/'(?:[^']|'')*'?/y, "chaine"], [/"[^"\n]*"?/y, "cle"], NOMBRE],
    motscles: mots(
      "select from where and or not insert into values update set delete create table alter add drop index view join left right inner outer full cross on as group by order having limit offset union all distinct case when then else end is null like ilike in between exists primary key foreign references default unique check constraint begin commit rollback transaction returning with recursive grant revoke if replace cascade asc desc function returns language trigger schema sequence do",
    ),
    constantes: mots("true false"),
    types: mots("int integer bigint smallint text varchar char boolean bool date time timestamp timestamptz interval numeric decimal serial bigserial uuid json jsonb float real double precision bytea"),
    sansCasse: true,
  },
  markdown: {
    regles: [
      [/<!--[\s\S]*?(?:-->|$)/y, "commentaire"],
      [/(?<=^|\n) {0,3}(?:`{3,}|~{3,})[^\n]*/y, "commentaire"],
      [/(?<=^|\n) {0,3}#{1,6}(?=[ \t]|$|\n)[^\n]*/y, "titre"],
      [/(?<=^|\n) {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*(?=\n|$)/y, "motcle"],
      [/(?<=^|\n)[ \t]*(?:>[ \t]?)+/y, "motcle"],
      [/(?<=^|\n)[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t])/y, "motcle"],
      [/`[^`\n]+`/y, "chaine"],
      [/!?\[[^\]\n]*\]\([^)\n]*\)|<https?:\/\/[^>\s]+>/y, "lien"],
      [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, "gras"],
    ],
  },
};

const MOT = /[A-Za-z_$\u00c0-\u024f][\w$\u00c0-\u024f]*/y;
const BLANCS = /\s+/y;

/** Le texte en lignes de morceaux colorés ; sans langage (ou trop long), des lignes sans couleur. */
export function colorer(texte: string, langage: Langage | null): Morceau[][] {
  if (!langage || texte.length > COLORATION_MAX) return texte.split("\n").map((l) => (l ? [{ texte: l, jeton: null }] : []));
  const g = LANGAGES[langage];
  const morceaux: Morceau[] = [];
  let simple = "";
  const pousser = (m: Morceau) => {
    if (m.jeton === null) {
      simple += m.texte;
      return;
    }
    if (simple) morceaux.push({ texte: simple, jeton: null });
    simple = "";
    morceaux.push(m);
  };

  let i = 0;
  suivant: while (i < texte.length) {
    BLANCS.lastIndex = i;
    const blanc = BLANCS.exec(texte);
    if (blanc) {
      // Les règles ancrées en début de ligne (titres, clés YAML…) gardent leur retrait.
      const ligne = blanc[0].lastIndexOf("\n");
      if (ligne < 0) {
        simple += blanc[0];
        i += blanc[0].length;
        continue;
      }
      simple += blanc[0].slice(0, ligne + 1);
      i += ligne + 1;
      if (i >= texte.length) break;
    }
    for (const [re, jeton] of g.regles) {
      re.lastIndex = i;
      const m = re.exec(texte);
      if (!m || !m[0]) continue;
      if (typeof jeton === "function") jeton(m[0]).forEach(pousser);
      else pousser({ texte: m[0], jeton });
      i += m[0].length;
      continue suivant;
    }
    MOT.lastIndex = i;
    const mot = MOT.exec(texte);
    if (mot) {
      const cle = g.sansCasse ? mot[0].toLowerCase() : mot[0];
      const jeton: Jeton | null = g.motscles?.has(cle)
        ? "motcle"
        : g.constantes?.has(cle)
          ? "nombre"
          : g.types?.has(cle) || (g.majuscules && /^[A-Z]/.test(mot[0]) && /[a-z]/.test(mot[0]))
            ? "type"
            : null;
      pousser({ texte: mot[0], jeton });
      i += mot[0].length;
      continue;
    }
    simple += texte[i++];
  }
  if (simple) morceaux.push({ texte: simple, jeton: null });

  // Un morceau peut couvrir plusieurs lignes (commentaire de bloc, chaîne) : on le découpe.
  const lignes: Morceau[][] = [[]];
  for (const m of morceaux) {
    m.texte.split("\n").forEach((bout, k) => {
      if (k > 0) lignes.push([]);
      if (bout) lignes[lignes.length - 1].push({ texte: bout, jeton: m.jeton });
    });
  }
  return lignes;
}
