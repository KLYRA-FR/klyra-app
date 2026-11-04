/**
 * L'entrée d'un outil pendant que le modèle l'écrit (`input_json_delta`) : un début de JSON. On le
 * referme au mieux (chaîne, tableaux, objets ouverts) pour montrer tout de suite ce qui est déjà là ;
 * la dernière clé sans valeur est laissée de côté. Sert à la carte de l'atelier qui s'écrit en
 * direct (cf. claude.ts). Pur et sans dépendance.
 */
export function lireJsonPartiel(texte: string): Record<string, unknown> | null {
  const debut = texte.indexOf("{");
  if (debut === -1) return null;
  const s = texte.slice(debut);
  const piles: string[] = [];
  let dansChaine = false;
  let echappe = false;
  /** La fin du dernier élément complet : on peut couper là sans casser le JSON. */
  let coupe = 0;
  let pilesALaCoupe: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (c === "\\") echappe = true;
      else if (c === '"') dansChaine = false;
      continue;
    }
    if (c === '"') dansChaine = true;
    else if (c === "{" || c === "[") piles.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      piles.pop();
      if (!piles.length) return lire(s.slice(0, i + 1));
    }
    if (c === "," || c === "{" || c === "[" || c === "}" || c === "]") {
      coupe = c === "," ? i : i + 1;
      pilesALaCoupe = [...piles];
    }
  }
  // Une chaîne ouverte : on la referme telle quelle (sans un échappement coupé en deux).
  if (dansChaine) {
    const corps = echappe ? s.slice(0, -1) : s;
    const ferme = `${corps.replace(/\\u[0-9a-fA-F]{0,3}$/, "")}"${[...piles].reverse().join("")}`;
    const v = lire(ferme);
    if (v) return v;
  }
  const v = lire(s + [...piles].reverse().join(""));
  if (v) return v;
  // Une clé sans valeur, ou un nombre coupé : on revient au dernier élément complet.
  return lire(s.slice(0, coupe) + [...pilesALaCoupe].reverse().join(""));
}

function lire(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
