// Généré par scripts/serveur-genere.mjs depuis electron/version-serveur.ts : ne pas modifier à la main.
/**
 * La version du code du serveur de VPS (`serveur/*.mjs` et `lancer.sh`), distincte du protocole : un VPS ne se met
 * pas à jour seul, et son protocole peut rester le même alors que son code a du retard.
 * L'app compare celle que le serveur annonce à celle-ci (`serveurEnRetard`, src/lib/serveur-vps.ts).
 * Écrit par `node scripts/serveur-genere.mjs`, qui la monte quand l'empreinte change ; `pnpm lint` et `test:serveur`
 * échouent si elle n'a pas suivi. Ne pas modifier à la main.
 */
export const VERSION_CODE_SERVEUR = 22;
export const EMPREINTE_CODE_SERVEUR = "a7f96ab601a27ea9527515419bb0f0591c9403e42c83d521572545d481bb94a7";
