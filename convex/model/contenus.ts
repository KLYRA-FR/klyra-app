/** Les textes des e-mails et de la page d'ouverture du lien. */

export const EXPEDITEUR_CONNEXION = "KLYRA <connexion@notifications.klyra.fr>";
export const EXPEDITEUR_RAPPELS = "KLYRA <rappels@notifications.klyra.fr>";

export const DUREE_LIEN_MINUTES = 15;

export type Courriel = { sujet: string; texte: string; html: string };

function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function courrielConnexion(lien: string): Courriel {
  const texte = [
    "Bonjour,",
    "",
    "Pour te connecter à l’app KLYRA, ouvre ce lien sur l’appareil où tu l’as demandé :",
    lien,
    "",
    `Il est valable ${DUREE_LIEN_MINUTES} minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore ce message.`,
  ].join("\n");
  const html = `<!doctype html><html lang="fr"><body style="font-family:'Google Sans Flex',system-ui,sans-serif;color:#303030;line-height:1.5">
<p>Bonjour,</p>
<p>Pour te connecter à l’app KLYRA, ouvre ce lien sur l’appareil où tu l’as demandé :</p>
<p><a href="${echapper(lien)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#303030;color:#ffffff;text-decoration:none">Se connecter à KLYRA</a></p>
<p style="color:#6b6b6b;font-size:13px">Il est valable ${DUREE_LIEN_MINUTES} minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore ce message.</p>
</body></html>`;
  return { sujet: "Ton lien de connexion à KLYRA", texte, html };
}

/** L'e-mail d'un rappel assigné pendant que l'app est fermée. Jamais les notes. */
export function courrielRappel(rappel: { titre: string; echeance: string; par: string }): Courriel {
  const titre = echapper(rappel.titre);
  const par = echapper(rappel.par);
  const echeance = echapper(rappel.echeance);
  const texte = [
    "Bonjour,",
    "",
    `${rappel.par} t’a assigné un rappel : « ${rappel.titre} ».`,
    `Échéance : ${rappel.echeance}.`,
    "",
    "Ouvre KLYRA pour le voir.",
  ].join("\n");
  const html = `<!doctype html><html lang="fr"><body style="font-family:'Google Sans Flex',system-ui,sans-serif;color:#303030;line-height:1.5">
<p>Bonjour,</p>
<p>${par} t’a assigné un rappel : « ${titre} ».</p>
<p>Échéance : ${echeance}.</p>
<p>Ouvre KLYRA pour le voir.</p>
</body></html>`;
  return { sujet: `Rappel : ${rappel.titre}`, texte, html };
}

/** Le code d'un lien magique : celui que génère Convex Auth (32 caractères alphanumériques). */
const CODE = /^[A-Za-z0-9]{16,128}$/;

const APP_URL = /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?(?:\/[\w./~-]*)?$/i;

/** L'adresse https de l'app, ou null si elle n'est pas posée ou pas en https. */
export function adresseApp(valeur: string | null | undefined): string | null {
  if (!valeur || !APP_URL.test(valeur)) return null;
  return valeur.replace(/\/$/, "");
}

/**
 * La page du lien reçu par e-mail.
 * Ordinateur : elle ouvre `klyra://`. Téléphone (`web`) : l'adresse https de l'app,
 * ou le lien https à coller si cette adresse n'est pas encore posée. Jamais `klyra://` dans ce cas.
 */
export function pageConnexion(
  code: string | null,
  options?: { web?: boolean; appUrl?: string | null; lienCopie?: string | null },
): Response {
  const valide = code !== null && CODE.test(code);
  const web = options?.web === true;
  const app = adresseApp(options?.appUrl);
  const ouvrir = !valide ? null : web ? (app ? `${app}/?code=${code}` : null) : `klyra://connexion?code=${code}`;
  const copieBrut = ouvrir ?? (web && valide ? (options?.lienCopie ?? null) : null);
  const copie = copieBrut && !/[\s<>"']/.test(copieBrut) ? copieBrut : null;
  const corps = !valide
    ? `<h1>Ce lien n’est pas valable</h1>
<p>Demande un nouveau lien depuis KLYRA.</p>`
    : `${ouvrir ? `<h1>Ouverture de KLYRA…</h1>
<p>Si l’app ne s’ouvre pas, clique sur le bouton.</p>
<p><a class="bouton" href="${echapper(ouvrir)}">Ouvrir KLYRA</a></p>` : `<h1>Ouvre KLYRA</h1>
<p>Copie ce lien et colle-le dans KLYRA, sous « Lien de connexion ».</p>`}
${copie ? `<p class="aide">Toujours rien ? Copie ce lien et colle-le dans KLYRA, sous « Lien de connexion ».</p>
<p class="lien" id="lien">${echapper(copie)}</p>
<p><button type="button" id="copier">Copier le lien</button></p>` : ""}`;
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${ouvrir ? `<meta http-equiv="refresh" content="0;url=${echapper(ouvrir)}">` : ""}
<title>KLYRA</title>
<style>
body{font-family:"Google Sans Flex",system-ui,sans-serif;background:#f9f9f9;color:#303030;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:#fff;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 12px}
p{font-size:14px;line-height:1.5}
.bouton,button{display:inline-block;padding:10px 16px;border-radius:6px;background:#303030;color:#fff;text-decoration:none;border:0;font:inherit}
.aide{color:#6b6b6b;font-size:13px}
.lien{font-size:12px;word-break:break-all;user-select:all;background:#f2f2f2;padding:8px;border-radius:6px}
</style></head>
<body><main>${corps}</main>
${copie ? `<script>document.getElementById("copier").addEventListener("click",function(){var t=document.getElementById("lien").textContent||"";if(navigator.clipboard)navigator.clipboard.writeText(t);this.textContent="Copié";});</script>` : ""}
</body></html>`;
  return new Response(html, {
    status: valide ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
