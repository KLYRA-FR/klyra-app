/**
 * QR code, mode octet, correction M, versions 1 à 10. Aucune dépendance.
 * Le masque est choisi, puis indiqué dans les bits de format : un lecteur le retrouve.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

function mul(a, b) {
  let r = 0;
  while (b > 0) {
    if (b & 1) r ^= a;
    b >>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return r;
}

let valeur = 1;
for (let i = 0; i < 255; i += 1) {
  EXP[i] = valeur;
  LOG[valeur] = i;
  valeur = mul(valeur, 2);
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

function mulLog(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

const GENERATEURS = new Map();

function generateur(symboles) {
  const connu = GENERATEURS.get(symboles);
  if (connu) return connu;
  let g = [1];
  for (let i = 0; i < symboles; i += 1) {
    const suivant = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j += 1) {
      suivant[j] ^= g[j];
      suivant[j + 1] ^= mulLog(g[j], EXP[i]);
    }
    g = suivant;
  }
  GENERATEURS.set(symboles, g);
  return g;
}

function resteReedSolomon(donnees, symboles) {
  const gen = generateur(symboles);
  const msg = donnees.concat(new Array(symboles).fill(0));
  for (let i = 0; i < donnees.length; i += 1) {
    const coef = msg[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j += 1) msg[i + j] ^= mulLog(gen[j], coef);
  }
  return msg.slice(donnees.length);
}

/** ec, blocs groupe 1, données groupe 1, blocs groupe 2, données groupe 2. Niveau M. */
const BLOCS = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

const ALIGNEMENTS = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const RESTE_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

/** Niveau M = 0. Masque 0 et niveau M donnent 0x5412, vecteur connu. */
export function infoFormat(masque) {
  const data = masque & 7;
  let v = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if (v & (1 << i)) v ^= 0x537 << (i - 10);
  }
  return ((data << 10) | (v & 0x3ff)) ^ 0x5412;
}

/** Version 7 donne 0x07c94, vecteur connu. */
export function infoVersion(version) {
  let v = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if (v & (1 << i)) v ^= 0x1f25 << (i - 12);
  }
  return ((version << 12) | v) >>> 0;
}

function capacite(version) {
  const [, n1, d1, n2, d2] = BLOCS[version];
  return n1 * d1 + n2 * d2 - (version >= 10 ? 3 : 2);
}

function choisirVersion(octets) {
  for (let version = 1; version <= 10; version += 1) {
    if (octets <= capacite(version)) return version;
  }
  return 0;
}

function bitsDuMessage(octets, version, places) {
  const bits = [];
  const pousser = (valeurBit, largeur) => {
    for (let i = largeur - 1; i >= 0; i -= 1) bits.push((valeurBit >>> i) & 1);
  };
  pousser(0b0100, 4);
  pousser(octets.length, version >= 10 ? 16 : 8);
  for (const octet of octets) pousser(octet, 8);
  const fin = Math.min(4, places * 8 - bits.length);
  for (let i = 0; i < fin; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const remplissage = [0xec, 0x11];
  let tour = 0;
  while (bits.length < places * 8) {
    pousser(remplissage[tour % 2], 8);
    tour += 1;
  }
  return bits.slice(0, places * 8);
}

function entrelacer(octets, version) {
  const [ec, n1, d1, n2, d2] = BLOCS[version];
  const blocs = [];
  let curseur = 0;
  for (let i = 0; i < n1 + n2; i += 1) {
    const taille = i < n1 ? d1 : d2;
    const data = octets.slice(curseur, curseur + taille);
    curseur += taille;
    blocs.push({ data, ec: resteReedSolomon(data, ec) });
  }
  const sortie = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i += 1) {
    for (const bloc of blocs) if (i < bloc.data.length) sortie.push(bloc.data[i]);
  }
  for (let i = 0; i < ec; i += 1) {
    for (const bloc of blocs) sortie.push(bloc.ec[i]);
  }
  return sortie;
}

function poser(modules, reserves, rangee, colonne, noir) {
  modules[rangee][colonne] = noir ? 1 : 0;
  reserves[rangee][colonne] = 1;
}

function carre(modules, reserves, rangee, colonne, taille) {
  for (let y = 0; y < taille; y += 1) {
    for (let x = 0; x < taille; x += 1) {
      const bord = y === 0 || y === taille - 1 || x === 0 || x === taille - 1;
      const centre = y >= 2 && y <= taille - 3 && x >= 2 && x <= taille - 3;
      poser(modules, reserves, rangee + y, colonne + x, bord || centre);
    }
  }
}

function separateur(modules, reserves, taille) {
  const blanc = (rangee, colonne) => {
    if (rangee < 0 || colonne < 0 || rangee >= taille || colonne >= taille) return;
    poser(modules, reserves, rangee, colonne, false);
  };
  for (let i = 0; i < 8; i += 1) {
    blanc(7, i);
    blanc(i, 7);
    blanc(7, taille - 8 + i);
    blanc(i, taille - 8);
    blanc(taille - 8, i);
    blanc(taille - 8 + i, 7);
  }
}

function alignement(modules, reserves, centreLigne, centreColonne) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      poser(modules, reserves, centreLigne + y, centreColonne + x, Math.max(Math.abs(x), Math.abs(y)) !== 1);
    }
  }
}

function reserverFormat(reserves, taille) {
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserves[8][i] = 1;
      reserves[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserves[8][taille - 1 - i] = 1;
    reserves[taille - 1 - i][8] = 1;
  }
}

function ecrireFormatSimple(modules, taille, masque) {
  const info = infoFormat(masque);
  for (let i = 0; i < 15; i += 1) {
    const allume = (info >>> i) & 1;
    const [ligne, colonne] = POSITIONS_FORMAT[i];
    modules[ligne][colonne] = allume;
    if (i < 8) modules[8][taille - 1 - i] = allume;
    else modules[taille - 15 + i][8] = allume;
  }
}

function ecrireVersion(modules, taille, version) {
  if (version < 7) return;
  const info = infoVersion(version);
  for (let i = 0; i < 18; i += 1) {
    const allume = (info >>> i) & 1;
    const ligne = taille - 11 + (i % 3);
    const colonne = Math.floor(i / 3);
    modules[ligne][colonne] = allume;
    modules[colonne][ligne] = allume;
  }
}

function reserverVersion(reserves, taille, version) {
  if (version < 7) return;
  for (let i = 0; i < 18; i += 1) {
    const ligne = taille - 11 + (i % 3);
    const colonne = Math.floor(i / 3);
    reserves[ligne][colonne] = 1;
    reserves[colonne][ligne] = 1;
  }
}

function masqueActif(masque, ligne, colonne) {
  switch (masque) {
    case 0: return (ligne + colonne) % 2 === 0;
    case 1: return ligne % 2 === 0;
    case 2: return colonne % 3 === 0;
    case 3: return (ligne + colonne) % 3 === 0;
    case 4: return (Math.floor(ligne / 2) + Math.floor(colonne / 3)) % 2 === 0;
    case 5: return ((ligne * colonne) % 2) + ((ligne * colonne) % 3) === 0;
    case 6: return (((ligne * colonne) % 2) + ((ligne * colonne) % 3)) % 2 === 0;
    default: return (((ligne + colonne) % 2) + ((ligne * colonne) % 3)) % 2 === 0;
  }
}

function penalite(modules) {
  const taille = modules.length;
  let score = 0;
  const suite = (lire) => {
    for (let a = 0; a < taille; a += 1) {
      let compte = 1;
      let precedent = lire(a, 0);
      for (let b = 1; b < taille; b += 1) {
        const courant = lire(a, b);
        if (courant === precedent) compte += 1;
        else {
          if (compte >= 5) score += 3 + (compte - 5);
          compte = 1;
          precedent = courant;
        }
      }
      if (compte >= 5) score += 3 + (compte - 5);
    }
  };
  suite((ligne, colonne) => modules[ligne][colonne]);
  suite((colonne, ligne) => modules[ligne][colonne]);
  for (let ligne = 0; ligne < taille - 1; ligne += 1) {
    for (let colonne = 0; colonne < taille - 1; colonne += 1) {
      const valeurModule = modules[ligne][colonne];
      if (valeurModule === modules[ligne][colonne + 1] && valeurModule === modules[ligne + 1][colonne] && valeurModule === modules[ligne + 1][colonne + 1]) {
        score += 3;
      }
    }
  }
  const motif = (ligne) => {
    let texte = "";
    for (let colonne = 0; colonne < taille; colonne += 1) texte += modules[ligne][colonne];
    return texte;
  };
  const chercher = (texte) => {
    const formes = ["10111010000", "00001011101"];
    for (const forme of formes) {
      let depuis = 0;
      while (depuis <= texte.length - forme.length) {
        const trouve = texte.indexOf(forme, depuis);
        if (trouve < 0) break;
        score += 40;
        depuis = trouve + 1;
      }
    }
  };
  for (let ligne = 0; ligne < taille; ligne += 1) chercher(motif(ligne));
  for (let colonne = 0; colonne < taille; colonne += 1) {
    let texte = "";
    for (let ligne = 0; ligne < taille; ligne += 1) texte += modules[ligne][colonne];
    chercher(texte);
  }
  let noirs = 0;
  for (const ligne of modules) for (const cellule of ligne) noirs += cellule;
  const ratio = Math.abs(noirs * 100 / (taille * taille) - 50) / 5;
  score += Math.floor(ratio) * 10;
  return score;
}

function trame(version) {
  const taille = 17 + 4 * version;
  const modules = Array.from({ length: taille }, () => new Array(taille).fill(0));
  const reserves = Array.from({ length: taille }, () => new Array(taille).fill(0));
  carre(modules, reserves, 0, 0, 7);
  carre(modules, reserves, 0, taille - 7, 7);
  carre(modules, reserves, taille - 7, 0, 7);
  separateur(modules, reserves, taille);
  for (let i = 0; i < taille; i += 1) {
    if (reserves[6][i]) continue;
    poser(modules, reserves, 6, i, i % 2 === 0);
    if (!reserves[i][6]) poser(modules, reserves, i, 6, i % 2 === 0);
  }
  const positions = ALIGNEMENTS[version] ?? [];
  const bords = new Set([6, positions[positions.length - 1]]);
  for (const ligne of positions) {
    for (const colonne of positions) {
      if (bords.has(ligne) && bords.has(colonne)) continue;
      alignement(modules, reserves, ligne, colonne);
    }
  }
  poser(modules, reserves, 4 * version + 9, 8, true);
  reserverFormat(reserves, taille);
  reserverVersion(reserves, taille, version);
  return { modules, reserves, taille };
}

function placer(modules, reserves, bits) {
  const taille = modules.length;
  let index = 0;
  let monter = true;
  for (let colonne = taille - 1; colonne > 0; colonne -= 2) {
    if (colonne === 6) colonne -= 1;
    for (let pas = 0; pas < taille; pas += 1) {
      const ligne = monter ? taille - 1 - pas : pas;
      for (const c of [colonne, colonne - 1]) {
        if (reserves[ligne][c]) continue;
        modules[ligne][c] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    monter = !monter;
  }
}

function appliquerMasque(modules, reserves, masque) {
  const taille = modules.length;
  const copie = modules.map((ligne) => ligne.slice());
  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      if (reserves[ligne][colonne]) continue;
      if (masqueActif(masque, ligne, colonne)) copie[ligne][colonne] ^= 1;
    }
  }
  ecrireFormatSimple(copie, taille, masque);
  return copie;
}

export function qrMatrice(texte) {
  /* TextEncoder plutôt que Buffer : le même module dessine le QR dans la fenêtre de l'app (Réglages › Mobile). */
  const octets = [...new TextEncoder().encode(texte)];
  const version = choisirVersion(octets.length);
  if (!version) throw new Error("lien trop long pour le QR");
  const [, n1, d1, n2, d2] = BLOCS[version];
  const places = n1 * d1 + n2 * d2;
  const bitsDonnees = bitsDuMessage(octets, version, places);
  const mots = [];
  for (let i = 0; i < bitsDonnees.length; i += 8) {
    let octet = 0;
    for (let b = 0; b < 8; b += 1) octet = (octet << 1) | bitsDonnees[i + b];
    mots.push(octet);
  }
  const code = entrelacer(mots, version);
  const bits = [];
  for (const octet of code) {
    for (let b = 7; b >= 0; b -= 1) bits.push((octet >>> b) & 1);
  }
  for (let i = 0; i < RESTE_BITS[version]; i += 1) bits.push(0);
  const { modules, reserves, taille } = trame(version);
  placer(modules, reserves, bits);
  ecrireVersion(modules, taille, version);
  let meilleur = null;
  let meilleurScore = Infinity;
  for (let masque = 0; masque < 8; masque += 1) {
    const candidat = appliquerMasque(modules, reserves, masque);
    const score = penalite(candidat);
    if (score < meilleurScore) {
      meilleurScore = score;
      meilleur = candidat;
    }
  }
  return meilleur;
}

export function qrSvg(texte) {
  const modules = qrMatrice(texte);
  const taille = modules.length;
  const marge = 4;
  const cote = taille + marge * 2;
  let chemin = "";
  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      if (!modules[ligne][colonne]) continue;
      chemin += `M${colonne + marge} ${ligne + marge}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cote} ${cote}" shape-rendering="crispEdges" role="img" aria-label="QR d’invitation"><rect width="${cote}" height="${cote}" fill="#fff"/><path d="${chemin}" fill="#111"/></svg>`;
}

const POSITIONS_FORMAT = [
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
  [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
];

function desentrelacer(code, version) {
  const [ec, n1, d1, n2, d2] = BLOCS[version];
  const blocs = [];
  for (let i = 0; i < n1; i += 1) blocs.push({ data: new Array(d1), ec: new Array(ec) });
  for (let i = 0; i < n2; i += 1) blocs.push({ data: new Array(d2), ec: new Array(ec) });
  let curseur = 0;
  const maxData = Math.max(d1, d2 || d1);
  for (let i = 0; i < maxData; i += 1) {
    for (const bloc of blocs) if (i < bloc.data.length) bloc.data[i] = code[curseur++];
  }
  for (let i = 0; i < ec; i += 1) {
    for (const bloc of blocs) bloc.ec[i] = code[curseur++];
  }
  for (const bloc of blocs) {
    const reste = resteReedSolomon(bloc.data, ec);
    for (let i = 0; i < ec; i += 1) if (reste[i] !== bloc.ec[i]) throw new Error("correction");
  }
  return blocs.flatMap((bloc) => bloc.data);
}

/** Relit un QR produit ici. Sert à prouver que la matrice porte bien le lien. */
export function lireQr(modules) {
  const taille = modules.length;
  const version = (taille - 17) / 4;
  if (!BLOCS[version]) throw new Error("version");
  let info = 0;
  for (let i = 0; i < 15; i += 1) {
    const [ligne, colonne] = POSITIONS_FORMAT[i];
    if (modules[ligne][colonne]) info |= 1 << i;
  }
  const brut = info ^ 0x5412;
  const masque = (brut >>> 10) & 7;
  if ((brut >>> 13) !== 0 || infoFormat(masque) !== info) throw new Error("format");
  const { reserves } = trame(version);
  const copie = modules.map((ligne) => ligne.slice());
  for (let ligne = 0; ligne < taille; ligne += 1) {
    for (let colonne = 0; colonne < taille; colonne += 1) {
      if (reserves[ligne][colonne]) continue;
      if (masqueActif(masque, ligne, colonne)) copie[ligne][colonne] ^= 1;
    }
  }
  const bits = [];
  let monter = true;
  for (let colonne = taille - 1; colonne > 0; colonne -= 2) {
    if (colonne === 6) colonne -= 1;
    for (let pas = 0; pas < taille; pas += 1) {
      const ligne = monter ? taille - 1 - pas : pas;
      for (const c of [colonne, colonne - 1]) {
        if (reserves[ligne][c]) continue;
        bits.push(copie[ligne][c]);
      }
    }
    monter = !monter;
  }
  const [ec, n1, d1, n2, d2] = BLOCS[version];
  const total = (n1 * d1 + n2 * d2 + (n1 + n2) * ec) * 8;
  const mots = [];
  for (let i = 0; i < total; i += 8) {
    let octet = 0;
    for (let b = 0; b < 8; b += 1) octet = (octet << 1) | (bits[i + b] ?? 0);
    mots.push(octet);
  }
  const data = desentrelacer(mots, version);
  if ((data[0] >>> 4) !== 0b0100) throw new Error("mode");
  const compte = version >= 10 ? ((data[0] & 0x0f) << 12) | (data[1] << 4) | (data[2] >>> 4) : ((data[0] & 0x0f) << 4) | (data[1] >>> 4);
  const debut = version >= 10 ? 20 : 12;
  const octets = [];
  for (let i = 0; i < compte; i += 1) {
    const position = debut + i * 8;
    let octet = 0;
    for (let b = 0; b < 8; b += 1) {
      const bitIndex = position + b;
      const source = data[bitIndex >>> 3];
      octet = (octet << 1) | ((source >>> (7 - (bitIndex & 7))) & 1);
    }
    octets.push(octet);
  }
  return new TextDecoder().decode(Uint8Array.from(octets));
}

/** Le même QR pour un terminal, en demi-blocs : les modules clairs sont dessinés (terminal sombre), marge de 2. */
export function qrTerminal(texte) {
  const modules = qrMatrice(texte);
  const taille = modules.length;
  const clair = (y, x) => y < 0 || x < 0 || y >= taille || x >= taille || !modules[y][x];
  const lignes = [];
  for (let y = -2; y < taille + 2; y += 2) {
    let ligne = "";
    for (let x = -2; x < taille + 2; x += 1) {
      const haut = clair(y, x);
      const bas = clair(y + 1, x);
      ligne += haut && bas ? "\u2588" : haut ? "\u2580" : bas ? "\u2584" : " ";
    }
    lignes.push(ligne);
  }
  return lignes.join("\n");
}
