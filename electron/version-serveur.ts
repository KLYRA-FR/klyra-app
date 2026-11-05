/**
 * La version du code du serveur de VPS (`serveur/*.mjs` et `lancer.sh`), distincte du protocole : un VPS ne se met
 * pas à jour seul, et son protocole peut rester le même alors que son code a du retard.
 * L'app compare celle que le serveur annonce à celle-ci (`serveurEnRetard`, src/lib/serveur-vps.ts).
 * Écrit par `node scripts/serveur-genere.mjs`, qui la monte quand l'empreinte change ; `pnpm lint` et `test:serveur`
 * échouent si elle n'a pas suivi. Ne pas modifier à la main.
 */
export const VERSION_CODE_SERVEUR = 4;
export const EMPREINTE_CODE_SERVEUR = "16b70096e4c52d640046bde745e2fce745cc6fde4a4ddd259a4f55eb6559620a";
