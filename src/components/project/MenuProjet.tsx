"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ElementContextuel,
  EnteteContextuel,
  MenuContextuel,
  SeparateurContextuel,
  SousMenuContextuel,
  useMenuContextuel,
} from "@/components/ui/MenuContextuel";
import { useConfirmation } from "@/components/ui/Modale";
import { annoncer } from "@/lib/annonces";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { poste } from "@/lib/plateforme";
import { useWorkspace } from "@/lib/workspace";
import type { Project, ProjectStatus } from "@/types/domain";

const STATUTS: { value: ProjectStatus; label: string }[] = [
  { value: "en-cours", label: "En cours" },
  { value: "en-revue", label: "En revue" },
  { value: "livre", label: "Livré" },
];

/**
 * Le clic droit sur un projet (cartes de Projets, liste du panneau d'un projet) : l'ouvrir, l'épingler,
 * son statut, le modifier, le retirer de l'app. Ce que le formulaire d'ajout ne demande plus se règle ici.
 * Retirer ne touche jamais au dossier : il reste sur sa machine.
 */
export function useMenuProjet(): { ouvrirMenu: ReturnType<typeof useMenuContextuel<Project>>["ouvrir"]; menuProjet: ReactNode } {
  const router = useRouter();
  const pathname = usePathname();
  const idAffiche = useSearchParams().get("id");
  const { enregistrerProjet, retirerProjet } = useWorkspace();
  const serveurs = useServeursRelies();
  const { menu, ouvrir, fermer } = useMenuContextuel<Project>();
  const [demander, fenetre] = useConfirmation();

  const changer = (p: Project, patch: Partial<Project>, annonce: string) => {
    enregistrerProjet({ ...p, ...patch, updatedAt: new Date().toISOString() });
    annoncer(annonce);
  };

  const retirer = async (p: Project) => {
    const ou = p.lieu ? `sur ${nomLieu(p.lieu, serveurs)}` : `sur ${poste.ton}`;
    const ok = await demander({
      titre: `Retirer ${p.name} de l’app ?`,
      texte: `Son dossier reste ${ou} : rien n’est effacé. Ses conversations restent dans Chats.`,
      confirmer: "Retirer",
    });
    if (!ok) return;
    retirerProjet(p.id);
    annoncer(`${p.name} retiré de l’app.`);
    if (pathname === "/projet" && idAffiche === p.id) router.push("/projets");
  };

  const p = menu?.cible;
  const menuProjet = (
    <>
      {menu && p && (
        <MenuContextuel x={menu.x} y={menu.y} libelle={`Projet ${p.name}`} onFermer={fermer}>
          <EnteteContextuel titre={p.name} sousTitre={p.depot ?? (p.lieu ? nomLieu(p.lieu, serveurs) : undefined)} />
          <SeparateurContextuel />
          <ElementContextuel icone="folder-open-01" raccourci="↵" onChoisir={() => router.push(`/projet?id=${encodeURIComponent(p.id)}`)}>
            Ouvrir le projet
          </ElementContextuel>
          <ElementContextuel
            icone={p.pinned ? "pin-off-01" : "pin-01"}
            onChoisir={() => changer(p, { pinned: !p.pinned }, p.pinned ? `${p.name} n’est plus épinglé.` : `${p.name} épinglé.`)}
          >
            {p.pinned ? "Désépingler" : "Épingler"}
          </ElementContextuel>
          <SousMenuContextuel icone="circle" libelle="Statut">
            {STATUTS.map((s) => (
              <ElementContextuel
                key={s.value}
                icone={s.value === p.status ? "check-01" : "circle"}
                onChoisir={() => changer(p, { status: s.value }, `${p.name} : ${s.label.toLocaleLowerCase("fr")}.`)}
              >
                {s.label}
              </ElementContextuel>
            ))}
          </SousMenuContextuel>
          <ElementContextuel icone="pencil-01" onChoisir={() => router.push(`/projets?modifier=${encodeURIComponent(p.id)}`)}>
            Modifier…
          </ElementContextuel>
          <SeparateurContextuel />
          <ElementContextuel icone="trash-01" danger onChoisir={() => void retirer(p)}>
            Retirer de l’app…
          </ElementContextuel>
        </MenuContextuel>
      )}
      {fenetre}
    </>
  );
  return { ouvrirMenu: ouvrir, menuProjet };
}
