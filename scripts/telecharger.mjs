// Téléchargement pour les scripts de préparation (Whisper, cua-driver) : github.com
// répond parfois 502, 503 ou 504 aux runners de l'action App, ce qui faisait échouer
// toute la publication. Un échec passager (réseau, 408, 429, 5xx) est retenté
// jusqu'à 5 fois (5, 10, 20, 40 s) ; une autre réponse (404…) échoue tout de suite.
// Le contrôle des empreintes reste à l'appelant.

const PAUSES_S = [5, 10, 20, 40];
const attendre = (s) => new Promise((r) => setTimeout(r, s * 1000));
const passager = (statut) => statut === 408 || statut === 429 || statut >= 500;

/** Les octets de `url`, ou une erreur « <nom> : <url> répond <statut>. » après les tentatives. */
export async function telecharger(url, nom) {
  for (let essai = 0; ; essai++) {
    let raison;
    try {
      const reponse = await fetch(url, { redirect: "follow" });
      if (reponse.ok) return Buffer.from(await reponse.arrayBuffer());
      if (!passager(reponse.status)) throw new Error(`${nom} : ${url} répond ${reponse.status}.`);
      raison = `répond ${reponse.status}`;
    } catch (erreur) {
      if (erreur instanceof Error && erreur.message.startsWith(`${nom} :`)) throw erreur;
      raison = `injoignable (${erreur instanceof Error ? (erreur.cause?.code ?? erreur.message) : erreur})`;
    }
    const pause = PAUSES_S[essai];
    if (pause === undefined) throw new Error(`${nom} : ${url} ${raison}, après ${essai + 1} tentatives.`);
    console.warn(`${nom} : ${url} ${raison}, nouvelle tentative dans ${pause} s.`);
    await attendre(pause);
  }
}

/** Relance `faire` (une commande qui passe par le réseau, comme `git clone`) après un échec. */
export async function avecTentatives(nom, faire) {
  for (let essai = 0; ; essai++) {
    try {
      return await faire();
    } catch (erreur) {
      const pause = PAUSES_S[essai];
      if (pause === undefined) throw erreur;
      console.warn(`${nom} : échec (${erreur instanceof Error ? erreur.message.split("\n")[0] : erreur}), nouvelle tentative dans ${pause} s.`);
      await attendre(pause);
    }
  }
}
