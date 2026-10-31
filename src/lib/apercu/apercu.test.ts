// @vitest-environment node
import { describe, expect, test } from "vitest";
import { colorer, langageDe, type Jeton, type Langage } from "./coloration";
import { ancreDe, cibleLien } from "./liens";
import { lireMarkdown, texteBrut, type Bloc, type Inline } from "./markdown";
import { aUnEntete, indenterJson, lireCsv, renduDe } from "./texte";

const premier = (source: string): Bloc => lireMarkdown(source).blocs[0];
const enLigne = (source: string): Inline[] => {
  const b = premier(source);
  if (b.type !== "paragraphe") throw new Error(`paragraphe attendu, reçu ${b.type}`);
  return b.contenu;
};

describe("liens d'un document", () => {
  const ici = "00_CONTROL/DASHBOARD.md";
  test.each([
    ["https://klyra.fr/a?b=1#c", { type: "externe", url: "https://klyra.fr/a?b=1#c" }],
    ["HTTP://Klyra.fr", { type: "externe", url: "http://klyra.fr/" }],
    ["mailto:corentin@klyra.fr", { type: "externe", url: "mailto:corentin@klyra.fr" }],
    ["../30_CLIENTS/CL-0001-acclaro/CLIENT.md", { type: "fichier", chemin: "30_CLIENTS/CL-0001-acclaro/CLIENT.md", ancre: null }],
    ["FILING-RULES.md#nommage", { type: "fichier", chemin: "00_CONTROL/FILING-RULES.md", ancre: "nommage" }],
    ["./imports/Mon%20fichier.csv", { type: "fichier", chemin: "00_CONTROL/imports/Mon fichier.csv", ancre: null }],
    ["/README.md", { type: "fichier", chemin: "README.md", ancre: null }],
    ["..\\README.md", { type: "fichier", chemin: "README.md", ancre: null }],
    ["#actifs-et-en-revue", { type: "ancre", ancre: "actifs-et-en-revue" }],
  ])("%s", (href, attendu) => expect(cibleLien(href, ici)).toEqual(attendu));

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    " javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "C:\\Windows\\win.ini",
    "//evil.example/x",
    "../../etc/passwd",
    "../../../../Users/moi/.ssh/id_rsa",
    "%2e%2e/%2e%2e/secret.md",
    "..%2F..%2Fsecret.md",
    "",
  ])("ignoré : %j", (href) => expect(cibleLien(href, ici)).toEqual({ type: "ignore" }));

  test("ancres comme GitHub", () => {
    expect(ancreDe("Actifs et en revue")).toBe("actifs-et-en-revue");
    expect(ancreDe("Étape 2 : livrer !")).toBe("étape-2--livrer-");
  });
});

describe("Markdown", () => {
  test("un tableau GFM devient un tableau, alignements et cellules en ligne compris", () => {
    const b = premier("| Client | Statut | Projets |\n|:---|:---:|---:|\n| [ACCLARO](../30_CLIENTS/a.md) | **active** | 1 |\n| Air Cloud \\| filiale | `x` | 9 |");
    expect(b.type).toBe("tableau");
    if (b.type !== "tableau") return;
    expect(b.alignements).toEqual(["gauche", "centre", "droite"]);
    expect(b.entete.map(texteBrut)).toEqual(["Client", "Statut", "Projets"]);
    expect(b.lignes).toHaveLength(2);
    expect(b.lignes[0][0][0]).toMatchObject({ type: "lien", href: "../30_CLIENTS/a.md" });
    expect(b.lignes[0][1][0]).toMatchObject({ type: "gras" });
    expect(texteBrut(b.lignes[1][0])).toBe("Air Cloud | filiale");
  });

  test("tableau sans barres de bord, rangées courtes complétées", () => {
    const b = premier("a | b\n--|--\n1");
    expect(b.type === "tableau" && b.lignes[0].map(texteBrut)).toEqual(["1", ""]);
  });

  test("une ligne de tirets seule reste un séparateur, pas un tableau", () => {
    expect(lireMarkdown("Texte\n\n---\n\nSuite").blocs.map((b) => b.type)).toEqual(["paragraphe", "separateur", "paragraphe"]);
  });

  test("titres, ids uniques, titre souligné", () => {
    const { blocs } = lireMarkdown("# Clients\n\n## Clients ##\n\nAutre titre\n===");
    expect(blocs).toMatchObject([
      { type: "titre", niveau: 1, id: "clients" },
      { type: "titre", niveau: 2, id: "clients-1" },
      { type: "titre", niveau: 1, id: "autre-titre" },
    ]);
  });

  test("listes : imbriquées, numérotées, cases à cocher", () => {
    const b = premier("3. trois\n4. quatre\n   - sous\n   - [x] fait\n   - [ ] à faire");
    expect(b).toMatchObject({ type: "liste", ordonnee: true, debut: 3, serree: true });
    if (b.type !== "liste") return;
    const sous = b.elements[1].blocs[1];
    expect(sous).toMatchObject({ type: "liste", ordonnee: false });
    if (sous.type !== "liste") return;
    expect(sous.elements.map((e) => e.coche)).toEqual([null, true, false]);
  });

  test("le tableau de bord : une liste de liens", () => {
    const b = premier("- [CL-0001 — ACCLARO](../30_CLIENTS/CL-0001-acclaro/CLIENT.md) — active ; 1 projet(s) en cours\n- [CL-0002 — Air Cloud](../30_CLIENTS/CL-0002-air-cloud/CLIENT.md) — active");
    expect(b.type === "liste" && b.elements.length).toBe(2);
    if (b.type !== "liste") return;
    const p = b.elements[0].blocs[0];
    expect(p.type === "paragraphe" && p.contenu[0]).toMatchObject({ type: "lien", href: "../30_CLIENTS/CL-0001-acclaro/CLIENT.md" });
  });

  test("citations, alertes, code", () => {
    const { blocs } = lireMarkdown("> [!WARNING]\n> Attention\n\n> cité\nsuite paresseuse\n\n```ts\nconst a = 1;\n```\n\n    indenté");
    expect(blocs).toMatchObject([
      { type: "citation", alerte: "attention" },
      { type: "citation", alerte: null, blocs: [{ type: "paragraphe" }] },
      { type: "code", langage: "ts", texte: "const a = 1;" },
      { type: "code", langage: "", texte: "indenté" },
    ]);
  });

  test("emphases, barré, code, échappements, entités", () => {
    expect(enLigne("**gras** *it* _it_ ~~barré~~ `co*de*` \\*pas\\* snake_case_nom &amp; 2*3*4")).toEqual([
      { type: "gras", enfants: [{ type: "texte", texte: "gras" }] },
      { type: "texte", texte: " " },
      { type: "italique", enfants: [{ type: "texte", texte: "it" }] },
      { type: "texte", texte: " " },
      { type: "italique", enfants: [{ type: "texte", texte: "it" }] },
      { type: "texte", texte: " " },
      { type: "barre", enfants: [{ type: "texte", texte: "barré" }] },
      { type: "texte", texte: " " },
      { type: "code", texte: "co*de*" },
      { type: "texte", texte: " *pas* snake_case_nom & 2" },
      { type: "italique", enfants: [{ type: "texte", texte: "3" }] },
      { type: "texte", texte: "4" },
    ]);
  });

  test("liens : titre, référence, autoliens, adresses nues", () => {
    const n = lireMarkdown('[a](https://a.fr "Titre") [b][ref] <https://c.fr> <moi@klyra.fr> voir https://d.fr/x). et www.e.fr.\n\n[ref]: ./doc.md').blocs[0];
    if (n.type !== "paragraphe") throw new Error();
    const liens = n.contenu.filter((x) => x.type === "lien");
    expect(liens.map((l) => l.type === "lien" && [l.href, l.titre])).toEqual([
      ["https://a.fr", "Titre"],
      ["./doc.md", null],
      ["https://c.fr", null],
      ["mailto:moi@klyra.fr", null],
      ["https://d.fr/x", null],
      ["https://www.e.fr", null],
    ]);
  });

  test("HTML nettoyé : balises retirées, scripts vidés, <br> en saut", () => {
    const contenu = enLigne('Avant<script>alert("x")</script><img src=x onerror=alert(1)> <b>gras</b><br>après<!-- caché -->');
    expect(texteBrut(contenu)).toBe("Avant gras après");
    expect(contenu.some((n) => n.type === "saut")).toBe(true);
    expect(JSON.stringify(contenu)).not.toMatch(/alert|onerror|caché/);
    expect(lireMarkdown('<div align="center">\n<img src="logo.png">\n</div>\n\n<!--\nnote\n-->\nTexte').blocs).toMatchObject([{ type: "paragraphe" }]);
  });

  test("en-tête YAML en propriétés", () => {
    const doc = lireMarkdown('---\nname: dev\ndescription: "Dev : front"\ntags:\n  - a\n  - b\n---\n# Hugo');
    expect(doc.proprietes).toEqual([
      ["name", "dev"],
      ["description", "Dev : front"],
      ["tags", "a, b"],
    ]);
    expect(doc.blocs[0]).toMatchObject({ type: "titre", niveau: 1 });
  });
});

describe("CSV, TSV et JSON", () => {
  test("rendu selon l'extension", () => {
    expect(["a.md", "a.MARKDOWN", "a.csv", "a.tsv", "a.json", "a.ts", "README"].map(renduDe)).toEqual(["markdown", "markdown", "tableau", "tableau", "json", "brut", "brut"]);
  });

  test("CSV : BOM, guillemets, retours dans un champ, séparateur ; ou ,", () => {
    expect(lireCsv('\uFEFFclient_id,name\r\nCL-0001,"ACCLARO, ""SAS"""\r\nCL-0002,"Air\nCloud"\r\n')).toEqual([
      ["client_id", "name"],
      ["CL-0001", 'ACCLARO, "SAS"'],
      ["CL-0002", "Air\nCloud"],
    ]);
    expect(lireCsv("Nom;Montant\nBois;12,5")).toEqual([
      ["Nom", "Montant"],
      ["Bois", "12,5"],
    ]);
    expect(lireCsv("a\tb\n1\t2", true)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("en-tête détecté seulement quand la première ligne en est un", () => {
    expect(aUnEntete([["client_id", "name"], ["CL-0001", "ACCLARO"]])).toBe(true);
    expect(aUnEntete([["2026", "12"], ["2027", "13"]])).toBe(false);
    expect(aUnEntete([["a", "a"], ["1", "2"]])).toBe(false);
    expect(aUnEntete([["seule ligne"]])).toBe(false);
  });

  test("JSON minifié réindenté sans réinterpréter les valeurs", () => {
    const minifie = `{"id":12345678901234567890,"a":[1.50,{"b":"x\\"y,{"}],"vide":{},"liste":[]${",\"k\":0".repeat(40)}}`;
    const indente = indenterJson(minifie);
    expect(indente).not.toBeNull();
    expect(indente).toContain('"id": 12345678901234567890');
    expect(indente).toContain("1.50");
    expect(indente).toContain('"b": "x\\"y,{"');
    expect(indente).toContain('"vide": {}');
    expect(JSON.parse(indente!)).toEqual(JSON.parse(minifie));
    expect(indenterJson('{\n  "deja": "lisible"\n}')).toBeNull();
    expect(indenterJson("{invalide")).toBeNull();
  });
});

describe("coloration de la vue Source", () => {
  /** Les mots colorés d'un texte, « jeton:texte », dans l'ordre. */
  const jetons = (texte: string, langage: Langage) =>
    colorer(texte, langage)
      .flat()
      .filter((m) => m.jeton)
      .map((m) => `${m.jeton}:${m.texte}`);
  const contient = (texte: string, langage: Langage, attendus: `${Jeton}:${string}`[]) => {
    const trouves = jetons(texte, langage);
    for (const a of attendus) expect(trouves, `${langage} : ${a}`).toContain(a);
  };

  test("langage selon l'extension ; inconnu → pas de couleur", () => {
    expect(["a.js", "a.jsx", "a.ts", "a.tsx", "a.json", "a.css", "a.html", "a.py", "a.go", "a.rs", "a.sh", "a.yml", "a.yaml", "a.xml", "a.sql", "a.md"].map(langageDe)).toEqual([
      "js", "jsx", "js", "jsx", "json", "css", "html", "python", "go", "rust", "shell", "yaml", "yaml", "html", "sql", "markdown",
    ]);
    expect(langageDe("a.txt")).toBeNull();
    expect(langageDe("Makefile")).toBeNull();
    expect(colorer("const a = 1; // rien", null)).toEqual([[{ texte: "const a = 1; // rien", jeton: null }]]);
  });

  test("le texte est rendu à l'identique, ligne par ligne", () => {
    const source = "/* bloc\n   sur deux lignes */\nconst a = `x\ny`;\n\n\tfin";
    const lignes = colorer(source, "js");
    expect(lignes.map((l) => l.map((m) => m.texte).join("")).join("\n")).toBe(source);
    expect(lignes[1][0]).toEqual({ texte: "   sur deux lignes */", jeton: "commentaire" });
  });

  test("TypeScript et JSX", () => {
    contient('import { x } from "y";\nexport const N = 42; // note\nfunction f(a: string): Promise<void> {}', "js", [
      "motcle:import", "chaine:\"y\"", "motcle:export", "motcle:const", "nombre:42", "commentaire:// note", "type:string", "type:Promise",
    ]);
    contient('return <Bouton variant="blanc" onClick={() => go()}>Ok</Bouton>;', "jsx", ["motcle:return", "balise:<Bouton", "attribut:variant", 'chaine:"blanc"', "attribut:onClick", "balise:>", "balise:</Bouton"]);
  });

  test("JSON, CSS, HTML, XML", () => {
    contient('{"nom": "klyra", "n": 2, "ok": true, "rien": null}', "json", ['cle:"nom"', 'chaine:"klyra"', "nombre:2", "nombre:true", "nombre:null"]);
    contient("@media (max-width: 600px) {\n  .a:hover { color: #003fe4; margin: 0 1.5rem !important; }\n}", "css", ["motcle:@media", "cle:color", "nombre:#003fe4", "nombre:1.5rem", "motcle:!important"]);
    expect(jetons(".a:hover {", "css")).not.toContain("cle:a");
    contient('<!-- note -->\n<a href="/x" class=\'b\'>Lien &amp; texte</a>', "html", ["commentaire:<!-- note -->", "balise:<a", "attribut:href", 'chaine:"/x"', "balise:>", "nombre:&amp;", "balise:</a"]);
    contient('<?xml version="1.0"?>\n<racine id="1"/>', "html", ['motcle:<?xml version="1.0"?>', "balise:<racine", "balise:/>"]);
  });

  test("Python, Go, Rust, shell", () => {
    contient('@app.route("/")\ndef f(x=None):\n    """doc\n    suite"""\n    return x  # fin', "python", ['variable:@app.route', "motcle:def", "nombre:None", 'chaine:"""doc', "motcle:return", "commentaire:# fin"]);
    contient("package main\nfunc main() { var s string = `brut`; _ = nil }", "go", ["motcle:package", "motcle:func", "type:string", "chaine:`brut`", "nombre:nil"]);
    contient("fn main<'a>() { let v: Vec<u8> = vec![1]; println!(\"{}\", 'c'); }", "rust", ["motcle:fn", "type:'a", "motcle:let", "type:Vec", "type:u8", "variable:vec!", "chaine:\"{}\"", "chaine:'c'"]);
    contient('#!/bin/sh\nif [ -n "$X" ]; then echo ${HOME} # fin\nfi', "shell", ["commentaire:#!/bin/sh", "motcle:if", 'chaine:"$X"', "motcle:then", "variable:${HOME}", "commentaire:# fin", "motcle:fi"]);
    expect(jetons("echo a#b", "shell")).not.toContain("commentaire:#b");
  });

  test("YAML, SQL, Markdown", () => {
    contient("---\nnom: klyra # app\nliste:\n  - cle: 'v'\n    actif: true\n    n: 3", "yaml", ["motcle:---", "cle:nom", "commentaire:# app", "cle:  - cle", "chaine:'v'", "cle:    actif", "nombre:true", "nombre:3"]);
    contient("SELECT id, nom FROM clients WHERE statut = 'active' -- note\nLIMIT 10;", "sql", ["motcle:SELECT", "motcle:FROM", "motcle:WHERE", "chaine:'active'", "commentaire:-- note", "motcle:LIMIT", "nombre:10"]);
    contient("# Titre\n\n- [lien](a.md) et `code` et **gras**\n> cité\n```ts\nx\n```", "markdown", ["titre:# Titre", "motcle:-", "lien:[lien](a.md)", "chaine:`code`", "gras:**gras**", "motcle:> ", "commentaire:```ts", "commentaire:```"]);
  });
});
