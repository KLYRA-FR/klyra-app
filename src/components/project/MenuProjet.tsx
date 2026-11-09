"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { Input } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ElementContextuel,
  EnteteContextuel,
  MenuContextuel,
  SeparateurContextuel,
  SousMenuContextuel,
  useMenuContextuel,
} from "@/components/ui/MenuContextuel";
import { Modale, useConfirmation } from "@/components/ui/Modale";
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
  const { enregistrerProjet, retirerProjet, state } = useWorkspace();
  /* « Nouvelle branche de travail » : le projet d'où elle part, le nom tapé, l'erreur éventuelle. */
  const [branche, setBranche] = useState<{ projet: Project; nom: string; erreur: string | null; occupe: boolean } | null>(null);
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

  /* Une branche de travail : un autre dossier du même dépôt, sur une branche neuve, ouvert comme un projet à part. */
  const creerBranche = async () => {
    const pont = getBridge()?.projets.brancheTravail;
    if (!branche || !pont) return;
    setBranche({ ...branche, occupe: true, erreur: null });
    const { projet, nom } = branche;
    const r = await pont(projet.folder, nom, projet.lieu ?? null);
    if (!r.ok) return setBranche({ ...branche, occupe: false, erreur: r.message });
    const maintenant = new Date().toISOString();
    const nomCourt = r.data.branche.replace(/^klyra\//, "");
    const id = `${projet.id}-${nomCourt}`.slice(0, 60);
    const suffixe = state.projects.some((x) => x.id === id) ? `-${crypto.randomUUID().slice(0, 4)}` : "";
    const nouveau: Project = {
      ...projet,
      id: `${id}${suffixe}`,
      name: `${projet.name} · ${nomCourt}`,
      folder: r.data.dossier,
      pinned: false,
      status: "en-cours",
      brancheDe: projet.id,
      branche: r.data.branche,
      files: [],
      updatedAt: maintenant,
    };
    enregistrerProjet(nouveau);
    setBranche(null);
    annoncer(`Branche de travail ${r.data.branche} ouverte.`);
    router.push(`/projet?id=${encodeURIComponent(nouveau.id)}&nouvelle=1`);
  };

  const retirerBranche = async (p: Project) => {
    const ok = await demander({
      titre: `Retirer la branche de travail ${p.branche ?? p.name} ?`,
      texte: "Son dossier est supprimé s’il n’a rien de non publié ; la branche et ses commits restent dans le dépôt. Ses conversations restent dans Chats.",
      confirmer: "Retirer",
    });
    if (!ok) return;
    const r = await getBridge()?.projets.retirerBrancheTravail?.(p.folder, p.lieu ?? null);
    if (r && !r.ok) {
      await demander({ titre: "La branche de travail reste", texte: r.message, confirmer: "Compris" });
      return;
    }
    retirerProjet(p.id);
    annoncer(`${p.name} retirée.`);
    if (pathname === "/projet" && idAffiche === p.id) router.push(p.brancheDe ? `/projet?id=${encodeURIComponent(p.brancheDe)}` : "/projets");
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
          <ElementContextuel
            icone="git-branch-02"
            detail="Un autre dossier du dépôt, sur une branche neuve : un agent y travaille à côté"
            onChoisir={() => setBranche({ projet: p, nom: "", erreur: null, occupe: false })}
          >
            Nouvelle branche de travail…
          </ElementContextuel>
          <SeparateurContextuel />
          {p.brancheDe ? (
            <ElementContextuel icone="trash-01" danger onChoisir={() => void retirerBranche(p)}>
              Retirer la branche de travail…
            </ElementContextuel>
          ) : (
            <ElementContextuel icone="trash-01" danger onChoisir={() => void retirer(p)}>
              Retirer de l’app…
            </ElementContextuel>
          )}
        </MenuContextuel>
      )}
      {fenetre}
      {branche && (
        <Modale
          titre="Nouvelle branche de travail"
          onFermer={() => setBranche(null)}
          actions={
            <>
              <Bouton variant="blanc" taille="md" onClick={() => setBranche(null)}>
                Annuler
              </Bouton>
              <Bouton variant="sombre" taille="md" disabled={branche.occupe || !branche.nom.trim()} onClick={() => void creerBranche()}>
                {branche.occupe ? "Création…" : "Créer la branche"}
              </Bouton>
            </>
          }
        >
          <form
            className="flex flex-col gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (branche.nom.trim() && !branche.occupe) void creerBranche();
            }}
          >
            <span>
              {branche.projet.name} continue tel quel. La branche part de son état actuel, dans un dossier à part : ses conversations y travaillent sans toucher au projet.
            </span>
            <Input
              size="sm"
              data-autofocus
              aria-label="Nom de la branche"
              placeholder="correctif-menu"
              value={branche.nom}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setBranche({ ...branche, nom: e.target.value, erreur: null })}
            />
            {branche.erreur && (
              <span role="alert" className="text-ui-xs text-texte-erreur">
                {branche.erreur}
              </span>
            )}
          </form>
        </Modale>
      )}
    </>
  );
  return { ouvrirMenu: ouvrir, menuProjet };
}
