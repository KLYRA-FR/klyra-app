/** Un panier : une liste de lignes { libelle, prixCentimes, quantite }. */

export function totalCentimes(lignes) {
  return lignes.reduce((somme, l) => somme + l.prixCentimes * l.quantite, 0);
}

export function appliquerRemise(totalCentimes, pourcentage) {
  if (pourcentage < 0 || pourcentage > 100) throw new RangeError("Remise hors limites");
  return Math.round(totalCentimes * (1 - pourcentage / 100));
}
