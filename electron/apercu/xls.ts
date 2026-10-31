import { formatIntegre, formaterNombre, Grille, type Cellule, type Feuille } from "./classeur";
import { ErreurApercu, ILLISIBLE, PROTEGE } from "./zip";

/**
 * Les feuilles visibles d'un ancien classeur Excel (.xls, BIFF8 d'Excel 97 à
 * 2003), lues sur l'ordinateur : le conteneur OLE, puis les enregistrements
 * de cellules. Les classeurs Excel 95 et chiffrés n'ont pas d'aperçu.
 */
export function lireXls(octets: Buffer): Feuille[] {
  if (!estOle(octets)) throw new ErreurApercu(ILLISIBLE);
  if (estChiffre(octets)) throw new ErreurApercu(PROTEGE);
  try {
    return lireBiff(fluxClasseur(octets));
  } catch (e) {
    if (e instanceof ErreurApercu) throw e;
    throw new ErreurApercu(ILLISIBLE);
  }
}

/** Un conteneur OLE (anciens formats Office, ou fichier Office chiffré). */
export function estOle(octets: Buffer): boolean {
  return octets.length >= 512 && octets.readUInt32LE(0) === 0xe011cfd0 && octets.readUInt32LE(4) === 0xe11ab1a1;
}

/** Un fichier Office récent chiffré : son paquet est rangé dans un conteneur OLE. */
export function estChiffre(octets: Buffer): boolean {
  return octets.includes(Buffer.from("EncryptedPackage", "utf16le"));
}

/* ─── Conteneur OLE (Compound File Binary) ──────────────────────── */

const FIN_CHAINE = 0xfffffffe;

function fluxClasseur(octets: Buffer): Buffer {
  const tailleSecteur = 1 << octets.readUInt16LE(0x1e);
  const tailleMini = 1 << octets.readUInt16LE(0x20);
  const seuilMini = octets.readUInt32LE(0x38);
  const nbSecteurs = Math.ceil(octets.length / tailleSecteur);
  const secteur = (n: number) => {
    const debut = (n + 1) * tailleSecteur;
    if (debut >= octets.length) throw new ErreurApercu(ILLISIBLE);
    return octets.subarray(debut, debut + tailleSecteur);
  };

  // Les secteurs de la FAT : 109 dans l'en-tête, puis la chaîne DIFAT.
  const secteursFat: number[] = [];
  for (let i = 0; i < 109; i++) secteursFat.push(octets.readUInt32LE(0x4c + i * 4));
  let difat = octets.readUInt32LE(0x44);
  for (let garde = 0; difat < FIN_CHAINE && garde < nbSecteurs; garde++) {
    const s = secteur(difat);
    for (let i = 0; i < tailleSecteur / 4 - 1; i++) secteursFat.push(s.readUInt32LE(i * 4));
    difat = s.readUInt32LE(tailleSecteur - 4);
  }
  const fat: number[] = [];
  for (const n of secteursFat.slice(0, octets.readUInt32LE(0x2c))) {
    const s = secteur(n);
    for (let i = 0; i < tailleSecteur / 4; i++) fat.push(s.readUInt32LE(i * 4));
  }

  const chaine = (table: number[], depart: number) => {
    const suite: number[] = [];
    for (let n = depart; n < FIN_CHAINE && suite.length <= table.length; n = table[n] ?? FIN_CHAINE) suite.push(n);
    return suite;
  };
  const lireChaine = (depart: number) => Buffer.concat(chaine(fat, depart).map(secteur));

  // Le répertoire : on cherche « Workbook » (BIFF8). « Book » est un classeur Excel 95.
  const repertoire = lireChaine(octets.readUInt32LE(0x30));
  let racine: { depart: number; taille: number } | null = null;
  let classeur: { depart: number; taille: number } | null = null;
  for (let pos = 0; pos + 128 <= repertoire.length; pos += 128) {
    const longueur = repertoire.readUInt16LE(pos + 0x40);
    const nom = repertoire.toString("utf16le", pos, pos + Math.max(0, longueur - 2)).toLowerCase();
    const type = repertoire[pos + 0x42];
    const entree = { depart: repertoire.readUInt32LE(pos + 0x74), taille: repertoire.readUInt32LE(pos + 0x78) };
    if (type === 5) racine = entree;
    else if (type === 2 && nom === "workbook") classeur = entree;
    else if (type === 2 && nom === "book" && !classeur) throw new ErreurApercu("Classeur Excel 95 : pas d’aperçu.");
  }
  if (!classeur) throw new ErreurApercu(ILLISIBLE);

  if (classeur.taille >= seuilMini) return lireChaine(classeur.depart).subarray(0, classeur.taille);
  // Petit flux : dans le mini-flux de la racine, découpé en mini-secteurs.
  if (!racine) throw new ErreurApercu(ILLISIBLE);
  const miniFlux = lireChaine(racine.depart);
  const miniFatOctets = lireChaine(octets.readUInt32LE(0x3c));
  const miniFat = Array.from({ length: miniFatOctets.length / 4 }, (_, i) => miniFatOctets.readUInt32LE(i * 4));
  return Buffer.concat(chaine(miniFat, classeur.depart).map((n) => miniFlux.subarray(n * tailleMini, (n + 1) * tailleMini))).subarray(0, classeur.taille);
}

/* ─── Enregistrements BIFF8 ─────────────────────────────────────── */

const BOF = 0x0809;
const EOF = 0x000a;
const CONTINUE = 0x003c;

interface Enregistrement {
  type: number;
  donnees: Buffer;
  suite: Buffer[];
}

/** Les enregistrements d'un sous-flux, avec leurs CONTINUE, jusqu'à son EOF. */
function* enregistrements(flux: Buffer, depart: number): Generator<Enregistrement> {
  let pos = depart;
  let courant: Enregistrement | null = null;
  while (pos + 4 <= flux.length) {
    const type = flux.readUInt16LE(pos);
    const longueur = flux.readUInt16LE(pos + 2);
    const donnees = flux.subarray(pos + 4, pos + 4 + longueur);
    pos += 4 + longueur;
    if (type === CONTINUE && courant) {
      courant.suite.push(donnees);
      continue;
    }
    if (courant) yield courant;
    if (type === EOF) return;
    courant = { type, donnees, suite: [] };
  }
  if (courant) yield courant;
}

/** Lecture d'octets à cheval sur un enregistrement et ses CONTINUE (chaînes partagées). */
class Lecteur {
  private morceau = 0;
  private pos = 0;
  constructor(private morceaux: Buffer[]) {}

  private courant(): Buffer {
    while (this.pos >= this.morceaux[this.morceau].length) {
      if (this.morceau + 1 >= this.morceaux.length) throw new RangeError("fin des données");
      this.morceau++;
      this.pos = 0;
    }
    return this.morceaux[this.morceau];
  }
  u8(): number {
    return this.courant()[this.pos++];
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  sauter(n: number) {
    for (let i = 0; i < n; i++) this.u8();
  }
  /** `n` caractères ; à chaque nouvel enregistrement, un octet redit leur largeur. */
  caracteres(n: number, larges: boolean): string {
    let texte = "";
    let restant = n;
    while (restant > 0) {
      if (this.pos >= this.morceaux[this.morceau].length) {
        this.courant();
        larges = (this.u8() & 1) === 1;
      }
      const morceau = this.morceaux[this.morceau];
      const disponibles = Math.floor((morceau.length - this.pos) / (larges ? 2 : 1));
      const pris = Math.min(restant, Math.max(1, disponibles));
      const fin = this.pos + pris * (larges ? 2 : 1);
      texte += morceau.toString(larges ? "utf16le" : "latin1", this.pos, fin);
      this.pos = fin;
      restant -= pris;
    }
    return texte;
  }
  /** XLUnicodeRichExtendedString (chaîne partagée) ou XLUnicodeString (sans extensions). */
  chaine(longueurSur8 = false): string {
    const n = longueurSur8 ? this.u8() : this.u16();
    const drapeaux = this.u8();
    const runs = drapeaux & 0x08 ? this.u16() : 0;
    const etendue = drapeaux & 0x04 ? this.u32() : 0;
    const texte = this.caracteres(n, (drapeaux & 1) === 1);
    this.sauter(runs * 4 + etendue);
    return texte;
  }
}

/** Un nombre RK : entier sur 30 bits ou double tronqué, éventuellement divisé par 100. */
function rk(valeur: number): number {
  let n: number;
  if (valeur & 2) n = (valeur | 0) >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((valeur & 0xfffffffc) >>> 0, 4);
    n = b.readDoubleLE(0);
  }
  return valeur & 1 ? n / 100 : n;
}

function lireBiff(flux: Buffer): Feuille[] {
  const premier = enregistrements(flux, 0).next().value;
  if (!premier || premier.type !== BOF || premier.donnees.readUInt16LE(0) !== 0x0600) throw new ErreurApercu("Classeur Excel 95 : pas d’aperçu.");

  const feuilles: { nom: string; position: number }[] = [];
  const formats = new Map<number, string>();
  const styles: number[] = [];
  let chaines: string[] = [];
  let date1904 = false;

  for (const e of enregistrements(flux, 0)) {
    const d = e.donnees;
    switch (e.type) {
      case 0x002f:
        throw new ErreurApercu(PROTEGE);
      case 0x0022:
        date1904 = d.readUInt16LE(0) === 1;
        break;
      case 0x0085: // BOUNDSHEET : feuilles de calcul visibles seulement.
        if ((d[4] & 3) === 0 && d[5] === 0) feuilles.push({ nom: new Lecteur([d.subarray(6)]).chaine(true), position: d.readUInt32LE(0) });
        break;
      case 0x041e:
        formats.set(d.readUInt16LE(0), new Lecteur([d.subarray(2)]).chaine());
        break;
      case 0x00e0:
        styles.push(d.readUInt16LE(2));
        break;
      case 0x00fc: {
        const lecteur = new Lecteur([d, ...e.suite]);
        lecteur.sauter(4);
        const nombre = lecteur.u32();
        chaines = [];
        for (let i = 0; i < nombre; i++) chaines.push(lecteur.chaine());
        break;
      }
    }
  }

  const format = (xf: number) => {
    const id = styles[xf] ?? 0;
    return formats.get(id) ?? formatIntegre(id);
  };
  const nombre = (n: number, xf: number): Cellule => ({ texte: formaterNombre(n, format(xf), date1904), nombre: true });

  const resultat = feuilles.map(({ nom, position }) => {
    const grille = new Grille();
    let formuleTexte: [number, number] | null = null;
    for (const e of enregistrements(flux, position)) {
      const d = e.donnees;
      if (e.type === BOF) continue;
      const ligne = d.length >= 4 ? d.readUInt16LE(0) : 0;
      const colonne = d.length >= 4 ? d.readUInt16LE(2) : 0;
      switch (e.type) {
        case 0x00fd: // LABELSST
          grille.poser(ligne, colonne, { texte: chaines[d.readUInt32LE(6)] ?? "" });
          break;
        case 0x0204: // LABEL
          grille.poser(ligne, colonne, { texte: new Lecteur([d.subarray(6), ...e.suite]).chaine() });
          break;
        case 0x0203: // NUMBER
          grille.poser(ligne, colonne, nombre(d.readDoubleLE(6), d.readUInt16LE(4)));
          break;
        case 0x027e: // RK
          grille.poser(ligne, colonne, nombre(rk(d.readUInt32LE(6)), d.readUInt16LE(4)));
          break;
        case 0x00bd: // MULRK : plusieurs RK sur une ligne.
          for (let i = 0, pos = 4; pos + 6 <= d.length - 2; i++, pos += 6) {
            grille.poser(ligne, colonne + i, nombre(rk(d.readUInt32LE(pos + 2)), d.readUInt16LE(pos)));
          }
          break;
        case 0x0205: // BOOLERR
          grille.poser(ligne, colonne, { texte: d[7] ? ERREURS[d[6]] ?? "#ERREUR" : d[6] ? "VRAI" : "FAUX" });
          break;
        case 0x0006: // FORMULA : le dernier résultat enregistré.
          formuleTexte = null;
          if (d.readUInt16LE(12) !== 0xffff) grille.poser(ligne, colonne, nombre(d.readDoubleLE(6), d.readUInt16LE(4)));
          else if (d[6] === 0) formuleTexte = [ligne, colonne];
          else if (d[6] === 1) grille.poser(ligne, colonne, { texte: d[8] ? "VRAI" : "FAUX" });
          else if (d[6] === 2) grille.poser(ligne, colonne, { texte: ERREURS[d[8]] ?? "#ERREUR" });
          break;
        case 0x0207: // STRING : résultat texte de la formule qui précède.
          if (formuleTexte) grille.poser(formuleTexte[0], formuleTexte[1], { texte: new Lecteur([d, ...e.suite]).chaine() });
          formuleTexte = null;
          break;
      }
    }
    return grille.feuille(nom);
  });
  if (!resultat.length) throw new ErreurApercu("Ce classeur n’a pas de feuille à montrer.");
  return resultat;
}

const ERREURS: Record<number, string> = { 0: "#NUL!", 7: "#DIV/0!", 15: "#VALEUR!", 23: "#REF!", 29: "#NOM?", 36: "#NOMBRE!", 42: "#N/A" };
