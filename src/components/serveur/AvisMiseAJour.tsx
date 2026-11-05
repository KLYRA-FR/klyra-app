import { Groupe, Ligne } from "@/components/reglages/ui";
import { COMMANDE_SERVEUR, VERSION_CODE_SERVEUR } from "@/lib/serveur-vps";
import { Commande } from "./Commande";

/** Le code de ce VPS est plus ancien que celui que cette app attend : ce qui manque, et la commande qui le rattrape. */
export function AvisMiseAJour({ versionCode }: { versionCode?: number }) {
  const ecart = versionCode
    ? `Il a la version ${versionCode}, cette app attend la version ${VERSION_CODE_SERVEUR}.`
    : `Il n’annonce pas sa version : son code date d’avant ce contrôle. Cette app attend la version ${VERSION_CODE_SERVEUR}.`;
  return (
    <div role="status">
      <Groupe titre="Mise à jour à faire">
        <Ligne pile libelle="Ce serveur a un code plus ancien que cette app" description={`${ecart} Les fonctions récentes peuvent manquer à ses agents : l’app se met à jour seule, pas le serveur.`}>
          <div className="flex w-full flex-col gap-2">
            <Commande texte={COMMANDE_SERVEUR} />
            <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">
              Colle cette commande dans un terminal connecté au VPS. Elle redémarre le serveur : attends que ses agents aient fini. Les appareils reliés le restent, et le nouveau lien qu’elle affiche ne sert pas ici.
            </p>
          </div>
        </Ligne>
      </Groupe>
    </div>
  );
}
