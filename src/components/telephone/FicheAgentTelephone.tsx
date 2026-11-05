"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { Input } from "klyra-ui";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { RondApercu } from "@/components/roles/AgentRond";
import { compact } from "@/lib/consommation";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Markdown } from "@/components/ui/Markdown";
import { PRINCIPAL } from "@/data/agents";
import { roleFromContent } from "@/lib/agents";
import { messageErreur } from "@/lib/compte";
import type { Lien } from "@/lib/lien-bibliotheque";
import { useLecturePoste, type LecturePoste } from "@/lib/poste/client";
import { useDirectEspace } from "@/lib/telephone/espace";
import { ID_ASSISTANT, libelleRetour, roleLisible, syntheseUtilisation, teinteSure, texteConversations, type EtatsAgentsPoste } from "@/lib/telephone/agents";
import { nouvelIdFil } from "@/lib/telephone/chats";
import type { ApercuPartage, CompetenceLue, FicheLue, SouvenirsLus, UtilisationLue } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import type { Role, RoleSection, RoleTeinte } from "@/types/domain";
import { AvantApresFiche } from "./AvantApresFiche";
import { useAnnonce } from "./Annonce";
import { BoutonMenu, CHAMP_TELEPHONE, ChampTelephone, EntetePagePleine, ErreurGeste, HeroAgent, PagePleine, useCartesAgents } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, type ActionMenu, type ActionRapide } from "./Feuille";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { NotePoste, Squelette, VueLecture } from "./etats";
import { useSupport } from "./poste";
import { useRetour } from "./retour";

/**
 * La fiche d'un agent sur le téléphone (spec mobile T-09). L'identité (nom, couleur, rôle court) vient
 * de sa carte, dans le compte ; la fiche, section par section, se demande à l'ordinateur ouvert (P-6
 * fermé) ; chaque geste du menu « ⋯ » passe par lui (P-7 fermé).
 */

const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/* Comme au bureau : « Critères de sortie » près du haut, « Parler en équipe » tout en bas, replié. */
function rang(section: RoleSection): number {
  if (/^Critères de sortie/i.test(section.title)) return 0;
  if (/^Parler en équipe/i.test(section.title)) return 3;
  if (/^Ce que je ne fais pas/i.test(section.title)) return 2;
  return 1;
}

/** Ce qu'une lecture a de lisible : la réponse, ou la vue gardée de ce téléphone. */
function luDe<T>(l: LecturePoste<T>): T | null {
  return l.etat === "ok" ? l.data : l.etat === "ferme" ? (l.gardee?.data ?? null) : null;
}

function heureCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const auj = new Date();
  if (d.toDateString() === auj.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Les étiquettes du haut de la fiche : son origine en mots, jamais un chemin (C-2c). */
function etiquettesOrigine(lien: Lien, sur: string): ReactNode {
  switch (lien.type) {
    case "modele":
      return (
        <>
          <Etiquette>Modèle KLYRA</Etiquette>
          {lien.miseAJour !== null ? <Etiquette ton="bleue">Mise à jour</Etiquette> : null}
        </>
      );
    case "recu":
      return (
        <>
          <Etiquette>
            De {lien.auteur} · v{lien.version}
          </Etiquette>
          {lien.proposition ? <Etiquette ton="bleue">Mise à jour</Etiquette> : null}
        </>
      );
    case "suspendu":
      return <Etiquette>Lien suspendu</Etiquette>;
    case "copie":
      return <Etiquette>Copie privée</Etiquette>;
    case "publie":
      return <Etiquette>Partagé · v{lien.version}</Etiquette>;
    default:
      return <Etiquette>Créé sur {sur}</Etiquette>;
  }
}

/** La fiche section par section : « Quand l'appeler » en tête, le bloc commun replié en bas. Texte à 16 px. */
export function SectionsFiche({ role }: { role: Role }) {
  const sections = [...role.sections].sort((a, b) => rang(a) - rang(b));
  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-4">
        <h3 className="text-ui font-medium text-texte-secondaire">Quand l’appeler</h3>
        <p className="text-body-s font-medium text-texte-principal">{role.whenToCall}</p>
        {role.pitch ? <Markdown source={role.pitch} className="text-body-s text-texte-secondaire" /> : null}
      </section>
      {sections
        .filter((s) => rang(s) < 3)
        .map((s) => (
          <section key={s.title} className="flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-4">
            <h3 className="text-body-s font-semibold text-texte-principal">{s.title}</h3>
            <Markdown source={s.body} className="text-body-s text-texte-principal" />
          </section>
        ))}
      {sections
        .filter((s) => rang(s) === 3)
        .map((s) => (
          <details key={s.title} className="group rounded-xl border border-bordure-subtile bg-fond-page px-4">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-body-s font-semibold text-texte-principal">
              <Icon name="chevron-right" size={20} className="text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90 motion-reduce:transition-none" />
              {s.title}
            </summary>
            <p className="text-ui-xs text-texte-secondaire">Bloc commun à toute l’équipe</p>
            <Markdown source={s.body} className="py-3 text-body-s text-texte-principal" />
          </details>
        ))}
    </div>
  );
}

/** Le rôle tel que la fiche lue le décrit (nom, rôle court et couleur réglés dans l'app compris). */
export function roleDeFiche(f: Extract<FicheLue, { type: "agent" }>): Role {
  return roleFromContent(f.id, f.contenu, { [f.id]: f.reglage }, { path: f.chemin, content: f.contenu, modifiedAt: f.modifiedAt });
}

export function FicheAgentTelephone({ id }: { id: string }) {
  const direct = useDirectEspace();
  const router = useRouter();
  const params = useSearchParams();
  const sur = useSupport();
  const { carte, conversations, liste } = useCartesAgents();
  const assistant = id === ID_ASSISTANT;
  /* L'assistant n'a pas de fichier : rien à demander à l'ordinateur pour l'afficher. */
  const fiche = useLecturePoste<FicheLue>("agents.fiche", assistant ? null : { id });
  const { agir, occupe, ouvert, bandeau, montrer, erreur } = useGesteTelephone();
  const [menu, setMenu] = useState(false);
  const [conversationsOuvertes, setConversationsOuvertes] = useState(false);
  const [personnaliser, setPersonnaliser] = useState(false);
  const [desactiver, setDesactiver] = useState(false);
  const [partage, setPartage] = useState<"partager" | "mettre-a-jour" | null>(null);
  const [retirer, setRetirer] = useState(false);

  const lue = luDe(fiche);
  const etats = useLecturePoste<EtatsAgentsPoste>("agents.etats", {});
  const prefs = luDe(etats)?.agents.find((a) => a.id === id);
  const souvenirs = luDe(useLecturePoste<SouvenirsLus>("agents.souvenirs", { id }));
  const competences = luDe(useLecturePoste<{ competences: CompetenceLue[] }>("agents.competences", { id }));
  const utilisation = luDe(useLecturePoste<UtilisationLue>("agents.utilisation", { id }));
  const annoncer = useAnnonce();
  const [maintenant] = useState(() => Date.now());
  const agent = lue?.type === "agent" ? lue : null;
  const role = useMemo(() => (agent ? roleDeFiche(agent) : null), [agent]);
  const identite = carte(id);
  /* Jamais l'id à l'écran (socle § 8) : sans carte ni fiche lue, « Cet agent ». */
  const nom = identite?.nom ?? role?.name ?? "Cet agent";
  const teinte: RoleTeinte = identite?.teinte ?? role?.teinte ?? teinteSure(null);
  const roleCourt = identite?.roleCourt || roleLisible(role?.tag, id) || role?.title || "";
  const statut = agent?.statut ?? (assistant || identite?.actif ? "actif" : "desactive");
  const siennes = (conversations ?? []).filter((c) => c.roleIds.includes(id)).sort((a, b) => b.misAJour.localeCompare(a.misAJour));
  const creerFil = useMutation(api.operationsFile.creerFil);
  const [echecFil, setEchecFil] = useState<string | null>(null);
  const nouveauFil = () => {
    const origine = nouvelIdFil();
    setEchecFil(null);
    void creerFil({ origine, roleId: id })
      .then(() => router.push(`/chat?id=${encodeURIComponent(origine)}`))
      .catch((e: unknown) => setEchecFil(messageErreur(e)));
  };

  /* De retour de l'éditeur, de Lou ou de l'historique : « Enregistré » (spec § 5). */
  const enregistre = params.get("enregistre");
  const [eclaire, setEclaire] = useState(() => !!params.get("enregistre"));
  useEffect(() => {
    if (!enregistre) return;
    montrer("Enregistré");
    router.replace(`/equipe?agent=${encodeURIComponent(id)}`);
  }, [enregistre, id, montrer, router]);

  const apres = (ok: unknown) => {
    if (ok) fiche.relancer();
  };
  const poste = { desactivee: !ouvert || occupe, note: ouvert ? undefined : <NotePoste /> };
  const aller = (mode: string) => router.push(`/equipe?agent=${encodeURIComponent(id)}&mode=${mode}`);

  const rapides: ActionRapide[] = [{ libelle: "Nouveau fil", icone: "message-plus-01", onChoisir: nouveauFil }];
  if (!assistant) {
    rapides.push({
      libelle: prefs?.epingle ? "Épinglé" : "Épingler",
      icone: "pin-01",
      actif: !!prefs?.epingle,
      desactivee: poste.desactivee,
      onChoisir: () => void agir("agents.preference", { id, epingle: !prefs?.epingle }, prefs?.epingle ? `${nom} n’est plus épinglé.` : `${nom} épinglé.`).then((ok) => ok && etats.relancer()),
    });
  }
  rapides.push(
    {
      libelle: "Sourdine",
      icone: prefs?.muet ? "volume-01" : "bell-01",
      actif: !!prefs?.muet,
      desactivee: poste.desactivee,
      onChoisir: () => void agir("agents.preference", { id, muet: !prefs?.muet }, prefs?.muet ? `${nom} te prévient de nouveau.` : `${nom} en sourdine.`).then((ok) => ok && etats.relancer()),
    },
    { libelle: "Personnaliser", icone: "palette", desactivee: poste.desactivee, onChoisir: () => setPersonnaliser(true) },
  );
  const copierMention: ActionMenu = {
    libelle: `Copier la mention @${nom}`,
    icone: "copy-left",
    onChoisir: () => void navigator.clipboard?.writeText(`@${nom}`).then(() => annoncer({ texte: "Mention copiée." }), () => annoncer({ texte: "La mention n’a pas été copiée." })),
  };
  const actions: ActionMenu[] = assistant
    ? [copierMention]
    : [
        { libelle: "Modifier la fiche", icone: "pencil-01", onChoisir: () => aller("modifier"), ...poste },
        { libelle: "Modifier avec Lou", icone: "stars", onChoisir: () => aller("lou"), ...poste },
        { libelle: "Historique", icone: "clock-backward", onChoisir: () => aller("historique"), ...poste },
      ];
  if (agent?.partage) {
    actions.push({
      libelle: "Partager avec l’équipe",
      icone: "upload-01",
      onChoisir: () => setPartage("partager"),
      /* Fermé, la feuille s'ouvre et dit pourquoi (E5-29) ; seul un blocage de la fiche l'empêche. */
      desactivee: agent.partage.raison !== null,
      note: agent.partage.raison ?? undefined,
    });
  }
  if (agent?.lien.type === "publie") {
    actions.push({ libelle: "Publier une mise à jour", icone: "upload-01", onChoisir: () => setPartage("mettre-a-jour") });
    actions.push({ libelle: "Retirer de la bibliothèque", icone: "x-01", onChoisir: () => setRetirer(true), ...poste });
  }
  if (agent?.modeleKlyra) actions.push({ libelle: "Comparer au modèle KLYRA", icone: "refresh-01", onChoisir: () => aller("maj"), ...poste });
  if (!assistant) {
    actions.push(
      { libelle: "Ses tickets", icone: "list", chevron: true, separateurAvant: true, onChoisir: () => router.push(`/tickets?agent=${encodeURIComponent(id)}`) },
      copierMention,
      {
        libelle: prefs?.masque ? "Afficher dans la liste" : "Masquer de la liste",
        icone: "minimise-01",
        separateurAvant: true,
        onChoisir: () => void agir("agents.preference", { id, masque: !prefs?.masque }, prefs?.masque ? `${nom} de retour dans la liste.` : `${nom} masqué.`).then((ok) => ok && etats.relancer()),
        ...poste,
        note: ouvert ? "Il reste actif et appelable" : poste.note,
      },
      statut === "actif"
        ? { libelle: "Désactiver…", icone: "lock-01", onChoisir: () => setDesactiver(true), danger: true, ...poste }
        : {
            libelle: agent ? libelleRetour({ id, statut: agent.statut, desactiveLe: null, definitionId: null, modele: null }) : "Ajouter à mes agents",
            icone: "refresh-01",
            onChoisir: () => void agir("agents.activer", { id, actif: true }, `${nom} est de retour dans tes agents.`).then(apres),
            ...poste,
          },
    );
  }

  const etiquettes = agent ? etiquettesOrigine(agent.lien, sur) : assistant ? <Etiquette>Ton assistant</Etiquette> : null;
  const travaille = agent?.enCours === true && fiche.etat === "ok";
  const synthese = utilisation ? syntheseUtilisation(utilisation, "30", maintenant) : null;
  const nbSouvenirs = souvenirs?.souvenirs.length;
  const nbFiche = competences?.competences.filter((c) => c.origine === "fiche").length;
  const valeur = (texte: string | null) => <span className="flex shrink-0 items-center gap-1 text-ui text-texte-secondaire">{texte}<Icon name="chevron-right" size={20} className="text-icone-secondaire" /></span>;
  const reglages = (
    <SectionListe titre="Réglages">
      <GroupeListe>
        <LigneListe debut={<TuileIcone icone="note-01" />} retrait="tuile" nom="Souvenirs" fin={valeur(nbSouvenirs === undefined ? null : nbSouvenirs === 0 ? "Aucun" : `${nbSouvenirs} enregistré${nbSouvenirs > 1 ? "s" : ""}`)} href={`/equipe?agent=${encodeURIComponent(id)}&mode=souvenirs`} />
        <LigneListe debut={<TuileIcone icone="layers-01" />} retrait="tuile" nom="Compétences" fin={valeur(nbFiche === undefined ? null : nbFiche === 0 ? "Aucune" : `${nbFiche} dans sa fiche`)} href={`/equipe?agent=${encodeURIComponent(id)}&mode=competences`} />
        <LigneListe debut={<TuileIcone icone="clock-backward" />} retrait="tuile" nom="Utilisation" fin={valeur(synthese ? (synthese.appels ? `${compact(synthese.jetons)} jetons · 30 j` : "Rien sur 30 j") : null)} href={`/equipe?agent=${encodeURIComponent(id)}&mode=utilisation`} />
        <LigneListe debut={<TuileIcone icone="clock-01" />} retrait="tuile" nom="Ses routines" fin={valeur(agent ? (agent.routines ? `${agent.routines} configurée${agent.routines > 1 ? "s" : ""}` : "Aucune") : null)} href={`/routines?vue=routines&agent=${encodeURIComponent(id)}`} />
      </GroupeListe>
    </SectionListe>
  );

  const desactiverTexte = [
    `${nom} ne pourra plus être appelé dans KLYRA : ni par toi, ni par ${liste?.assistant.nom ?? "ton assistant"}, ni par tes autres agents. Ses conversations et sa fiche sont gardées, et tu pourras le réactiver.`,
    agent?.enCours ? "Il travaille en ce moment : sa réponse en cours sera arrêtée." : "",
    agent && agent.routines > 0
      ? agent.routines > 1
        ? `${agent.routines} routines lui sont confiées : elles échoueront tant qu’il est désactivé.`
        : "1 routine lui est confiée : elle échouera tant qu’il est désactivé."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={nom} parent="/equipe" droite={<BoutonMenu libelle="Plus d’options" onClick={() => setMenu(true)} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <header className="flex flex-col gap-3 px-4 pt-1">
          <HeroAgent
            agentId={id}
            nom={nom}
            teinte={teinte}
            role={assistant ? "Ton assistant" : roleCourt}
            titre={role?.title}
            etiquettes={etiquettes}
            travaille={travaille}
            eclaire={eclaire}
            onFinEclairage={() => setEclaire(false)}
            pied={agent ? `Fiche modifiée le ${dateLongue.format(agent.modifiedAt)}` : null}
            etat={travaille ? <span className="shrink-0 font-semibold text-texte-accent">Travaille…</span> : null}
            actions={
              <>
                {statut === "actif" ? (
                  <BoutonPrincipal href={`/chat?id=${encodeURIComponent(direct(id))}`} className="flex-1">
                    Écrire
                  </BoutonPrincipal>
                ) : null}
                <Bouton variant="blanc" taille="md" className="flex-1" onClick={() => setConversationsOuvertes(true)}>
                  Conversations <span className="font-normal text-texte-secondaire">{siennes.length}</span>
                </Bouton>
              </>
            }
          />
          <ErreurGeste message={erreur?.message} />
        </header>

        {assistant ? (
          <div className="mt-4 flex flex-col gap-4 px-4">
            {reglages}
            <SectionsFiche role={{ ...PRINCIPAL, name: nom, sections: [] }} />
          </div>
        ) : (
          <div className="mt-3">
            <VueLecture lecture={fiche} verrou={false} ferme={(s) => `la fiche de ${nom} et ses réglages sont sur ${s}. Elle s’affiche quand KLYRA y est ouverte.`}>
              {() =>
                agent && role ? (
                  <div className="flex flex-col gap-3 px-4">
                    <EtatFiche
                      agent={agent}
                      nom={nom}
                      sur={sur}
                      ouvert={ouvert}
                      occupe={occupe}
                      onRemettre={() => void agir("agents.activer", { id, actif: true }, `${nom} est de retour dans tes agents.`).then(apres)}
                      onComparer={() => aller("maj")}
                    />
                    {reglages}
                    {ouvert ? null : <NotePoste className="px-1" />}
                    {/* C-2c : jamais le chemin du fichier de la fiche sur le téléphone. */}
                    {role.model ? <p className="px-1 text-ui-xs text-texte-secondaire">Modèle {role.model}</p> : null}
                    <SectionsFiche role={role} />
                  </div>
                ) : null
              }
            </VueLecture>
          </div>
        )}
      </div>

      {menu ? (
        <MenuFeuille
          titre={nom}
          objet={{ visuel: <RondApercu agentId={id} nom={nom} teinte={teinte} taille={40} />, sous: (assistant ? "Ton assistant" : role?.title || roleCourt) || undefined }}
          rapides={rapides}
          noteRapides={ouvert ? undefined : <NotePoste />}
          actions={actions}
          onFermer={() => setMenu(false)}
        />
      ) : null}
      {conversationsOuvertes ? (
        <Feuille
          titre={`Conversations avec ${nom}`}
          sousTitre={`${siennes.length} dans ton compte`}
          onFermer={() => setConversationsOuvertes(false)}
          pied={
            statut === "actif" ? (
              <>
                <Bouton variant="blanc" taille="md" className="w-full" iconeGauche={<Icon name="message-plus-01" size={20} />} onClick={nouveauFil}>
                  Nouveau fil avec {nom}
                </Bouton>
                <ErreurGeste message={echecFil} />
              </>
            ) : undefined
          }
        >
          {conversations === undefined ? (
            <Squelette lignes={3} />
          ) : siennes.length ? (
            <GroupeListe>
              {siennes.map((c) => (
                <LigneListe
                  key={c.origine}
                  href={`/chat?id=${encodeURIComponent(c.origine)}`}
                  debut={<TuileIcone icone="message-square" />}
                  retrait="tuile"
                  nom={c.titre}
                  etiquette={c.projetNom ? <Etiquette>{c.projetNom}</Etiquette> : null}
                  meta={heureCourte(c.misAJour)}
                  ligne2={c.extrait || (c.kind === "equipe" ? "Conversation d’équipe" : c.parent ? "Fil" : "Conversation directe")}
                />
              ))}
            </GroupeListe>
          ) : (
            <p className="text-ui text-texte-secondaire">{texteConversations(0)}</p>
          )}
        </Feuille>
      ) : null}
      {personnaliser ? (
        <FeuillePersonnaliser
          id={id}
          nom={nom}
          roleCourt={roleCourt}
          teinte={teinte}
          onFermer={() => setPersonnaliser(false)}
          onFait={(texte) => {
            setEclaire(true);
            montrer(texte);
            fiche.relancer();
          }}
        />
      ) : null}
      {desactiver ? (
        <ConfirmationFeuille
          titre={`Désactiver ${nom} ?`}
          texte={desactiverTexte}
          confirmer="Désactiver"
          danger
          onConfirmer={() => void agir("agents.activer", { id, actif: false }, `${nom} désactivé.`).then(apres)}
          onFermer={() => setDesactiver(false)}
        />
      ) : null}
      {partage && agent ? (
        <FeuillePartager
          id={id}
          nom={nom}
          role={roleCourt}
          mode={partage}
          empreinte={agent.empreinte}
          onFermer={() => setPartage(null)}
          onFait={(texte) => {
            montrer(texte);
            fiche.relancer();
          }}
        />
      ) : null}
      {retirer ? (
        <ConfirmationFeuille
          titre={`Retirer ${nom} de la bibliothèque ?`}
          texte="Ceux qui l’ont ajouté le gardent, en copie privée. Ta fiche ne change pas."
          confirmer="Retirer"
          onConfirmer={() => void agir("agents.retirerPartage", { id }, `${nom} retiré de la bibliothèque.`).then(apres)}
          onFermer={() => setRetirer(false)}
        />
      ) : null}
      {bandeau}
    </div>
  );
}

/** Ce qui attend un choix sur la fiche : désactivé, pas encore dans Mes agents, mise à jour du modèle. */
function EtatFiche({
  agent,
  nom,
  sur,
  ouvert,
  occupe,
  onRemettre,
  onComparer,
}: {
  agent: Extract<FicheLue, { type: "agent" }>;
  nom: string;
  sur: string;
  ouvert: boolean;
  occupe: boolean;
  onRemettre: () => void;
  onComparer: () => void;
}) {
  const bandeau = (texte: string, action?: { libelle: string; onClick: () => void }) => (
    <div role="status" className="flex items-start gap-2.5 rounded-xl bg-fond-teinte-bleue p-3">
      <Icon name="refresh-01" size={20} className="mt-px shrink-0 text-icone-accent" />
      <p className="min-w-0 flex-1 text-ui text-texte-principal">{texte}</p>
      {action ? (
        <Bouton variant="sombre" disabled={occupe} onClick={action.onClick} className="relative shrink-0 after:absolute after:-inset-x-1 after:-inset-y-1.5">
          {action.libelle}
        </Bouton>
      ) : null}
    </div>
  );
  /* Ce qui attend l'ordinateur : neutre, le geste sur toute la largeur et sa raison s'il est fermé (E5-27). */
  const attente = (texte: string, action: { libelle: string; onClick: () => void }) => (
    <div role="status" className="flex flex-col gap-2.5 rounded-xl bg-fond-surface-grise p-3">
      <p className="text-ui text-texte-principal">{texte}</p>
      <Bouton variant="sombre" taille="md" disabled={!ouvert || occupe} onClick={action.onClick}>
        {action.libelle}
      </Bouton>
      {ouvert ? null : <NotePoste />}
    </div>
  );
  const { lien } = agent;
  return (
    <>
      {agent.statut === "desactive"
        ? attente(`${nom} n’est plus dans Mes agents${agent.desactiveLe ? ` depuis le ${dateLongue.format(agent.desactiveLe)}` : ""}. Ni toi, ni tes agents ne peuvent l’appeler dans l’app.`, {
            libelle: "Réactiver",
            onClick: onRemettre,
          })
        : null}
      {agent.statut === "disponible" ? attente(`Cette fiche est sur ${sur}, mais pas dans Mes agents : KLYRA ne l’appelle pas.`, { libelle: "Ajouter à mes agents", onClick: onRemettre }) : null}
      {agent.statut === "actif" && ouvert && lien.type === "modele" && lien.miseAJour !== null
        ? bandeau(`Modèle KLYRA, version ${lien.miseAJour}. Rien ne change tant que tu ne choisis pas.`, { libelle: "Comparer", onClick: onComparer })
        : null}
      {agent.statut === "actif" && lien.type === "recu" && lien.proposition
        ? bandeau(`${lien.auteur} a publié la version ${lien.proposition.version} de ${nom} (tu as la ${lien.version}). Rien ne change tant que tu ne choisis pas sur ${sur}.`)
        : null}
      {agent.manquantes.length ? bandeau(`À configurer sur ${sur} : ${nom} attend le choix de ${agent.manquantes.length > 1 ? `${agent.manquantes.length} dossiers` : "1 dossier"}.`) : null}
    </>
  );
}

/** « Personnaliser » : le nom, le rôle court et la couleur, propres à l'app (la fiche ne change pas). */
export function FeuillePersonnaliser({
  id,
  nom: nomInitial,
  roleCourt,
  teinte: teinteInitiale,
  onFermer,
  onFait,
}: {
  id: string;
  nom: string;
  roleCourt: string;
  teinte: RoleTeinte;
  onFermer: () => void;
  onFait: (texte: string) => void;
}) {
  const assistant = id === ID_ASSISTANT;
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const [nom, setNom] = useState(nomInitial);
  const [tag, setTag] = useState(roleCourt);
  const [teinte, setTeinte] = useState<RoleTeinte>(teinteInitiale);
  const modifie = nom !== nomInitial || tag !== roleCourt || teinte !== teinteInitiale;

  const enregistrer = async () => {
    const ok = await agir("agents.personnaliser", assistant ? { id, nom, teinte } : { id, nom, tag, teinte });
    if (!ok) return;
    onFermer();
    onFait("Enregistré");
  };

  return (
    <Feuille
      titre={assistant ? "Ton assistant" : `Personnaliser ${nomInitial}`}
      onFermer={onFermer}
      pied={
        <>
          <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || !modifie || !nom.trim()} onClick={() => void enregistrer()}>
            {occupe ? "Enregistrement…" : "Enregistrer"}
          </Bouton>
          {ouvert ? null : <NotePoste />}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <RondApercu agentId={id} nom={nom || nomInitial} teinte={teinte} taille={48} />
          <p className="text-ui text-texte-secondaire">Son nom et sa couleur, partout dans l’app. Sa fiche ne change pas.</p>
        </div>
        <ChampTelephone label="Nom">
          <Input size="lg" value={nom} maxLength={assistant ? 24 : 60} onChange={(e) => setNom(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        {assistant ? null : (
          <ChampTelephone label="Rôle court" aide="Affiché à côté de son nom dans les chats (« Dev », « Ventes »).">
            <Input size="lg" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} className={CHAMP_TELEPHONE} />
          </ChampTelephone>
        )}
        <div className="flex flex-col gap-2">
          <span id={`couleur-${id}`} className="text-ui font-medium text-texte-principal">
            Couleur
          </span>
          <ChoixTeinte grand valeur={teinte} onChange={setTeinte} libelleId={`couleur-${id}`} />
        </div>
        <ErreurGeste message={erreur?.message} />
      </div>
    </Feuille>
  );
}

/** « Partager avec l'équipe » et « Publier une mise à jour » : l'aperçu exact de ce qui part, préparé par l'ordinateur. */
function FeuillePartager({
  id,
  nom,
  role,
  mode,
  empreinte,
  onFermer,
  onFait,
}: {
  id: string;
  nom: string;
  role: string;
  mode: "partager" | "mettre-a-jour";
  empreinte: string;
  onFermer: () => void;
  onFait: (texte: string) => void;
}) {
  const apercu = useLecturePoste<ApercuPartage>("agents.apercuPartage", { id, mode }, { garder: false });
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const pret = apercu.etat === "ok" && !apercu.data.blocage;
  const envoyer = async () => {
    const r = await agir<{ version: number }>("agents.partager", { id, mode, empreinte });
    if (!r) return;
    onFermer();
    onFait(mode === "partager" ? "Partagé avec l’équipe." : `Version ${r.version} publiée.`);
  };
  return (
    <Feuille
      haute
      titre={mode === "partager" ? "Partager avec l’équipe" : "Publier une mise à jour"}
      onFermer={onFermer}
      pied={
        <>
          <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || !pret} onClick={() => void envoyer()}>
            {occupe ? "Envoi…" : mode === "partager" ? "Partager" : "Publier"}
          </Bouton>
          {ouvert ? null : <NotePoste />}
        </>
      }
    >
      <div className="-mx-4">
        <VueLecture lecture={apercu} ferme={(sur) => `la fiche est sur ${sur}. Ce qui partirait s’affiche quand KLYRA y est ouverte.`}>
          {(a) => (
            <div className="flex flex-col gap-4 px-4">
              <p className="text-body-s font-medium text-texte-principal">{a.titre}</p>
              <p className="text-ui text-texte-secondaire">
                {mode === "partager"
                  ? "Sa définition rejoint la Bibliothèque KLYRA de ton équipe. Chacun choisit de l’ajouter ou non : personne ne la reçoit d’office."
                  : "Ceux qui l’ont ajouté la recevront sous forme de proposition : rien ne change chez eux tant qu’ils ne choisissent pas."}
              </p>
              {a.blocage ? (
                <p role="alert" className="text-ui text-texte-erreur">
                  {a.blocage}
                </p>
              ) : null}
              <SectionListe titre="Ce qui part">
                <GroupeListe>
                  <LigneListe debut={<TuileIcone icone="user-profile-01" />} retrait="tuile" nom="Son nom et son rôle" ligne2={[nom, role].filter(Boolean).join(" · ")} />
                  <LigneListe debut={<TuileIcone icone="file-01" />} retrait="tuile" nom="Sa fiche" ligne2="Quand l’appeler, ses consignes, son modèle" />
                </GroupeListe>
              </SectionListe>
              {a.dependances.length ? (
                <SectionListe titre="Dossiers que chacun choisira" compte={a.dependances.length}>
                  <GroupeListe>
                    {a.dependances.map((d) => (
                      <LigneListe key={d.cle} debut={<TuileIcone icone="folder" />} retrait="tuile" nom={d.libelle} />
                    ))}
                  </GroupeListe>
                </SectionListe>
              ) : null}
              <details className="group rounded-xl border border-bordure-subtile bg-fond-surface">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-body-s font-medium text-texte-principal">
                  <TuileIcone icone="align-left" />
                  <span className="min-w-0 flex-1">Le texte exact qui part</span>
                  <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire transition-transform duration-[220ms] group-open:rotate-90 motion-reduce:transition-none" />
                </summary>
                <pre className="mx-4 mb-4 rounded-md border border-bordure-subtile bg-fond-page p-3 font-[inherit] text-body-s break-words whitespace-pre-wrap text-texte-principal">{a.contenu}</pre>
              </details>
              <ErreurGeste message={erreur?.message} />
            </div>
          )}
        </VueLecture>
      </div>
    </Feuille>
  );
}

/** « Aujourd'hui, 14:26 », « Hier, 17:02 », « 2 nov., 09:12 ». */
function dateVersion(n: number): string {
  const d = new Date(n);
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return `Aujourd’hui, ${heure}`;
  if (d.toDateString() === hier.toDateString()) return `Hier, ${heure}`;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${heure}`;
}

/** Historique d'une fiche : chaque version remplacée par l'app ; on la compare à la fiche actuelle et on la restaure. */
export function HistoriqueFicheTelephone({ id }: { id: string }) {
  const router = useRouter();
  const { carte } = useCartesAgents();
  const nom = carte(id)?.nom ?? "Cet agent";
  const versions = useLecturePoste<{ id: string; savedAt: number }[]>("agents.historique", { id });
  const [choisie, setChoisie] = useState<string | null>(null);
  const version = useLecturePoste<{ contenu: string; actuel: string; empreinte: string }>("agents.version", choisie ? { id, versionId: choisie } : null);
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const fiche = `/equipe?agent=${encodeURIComponent(id)}`;
  const versFiche = useRetour(fiche);
  const dateChoisie = versions.etat === "ok" ? versions.data.find((v) => v.id === choisie)?.savedAt : undefined;

  const restaurer = async () => {
    if (!choisie || version.etat !== "ok") return;
    const ok = await agir("agents.restaurer", { id, versionId: choisie, empreinte: version.data.empreinte });
    if (ok) router.push(`${fiche}&enregistre=1`);
  };

  if (choisie) {
    return (
      <PagePleine
        pied={
          <>
            <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || version.etat !== "ok"} onClick={() => void restaurer()}>
              Restaurer cette version
            </Bouton>
            {ouvert ? <p className="mt-1 text-ui-xs text-texte-secondaire">La version actuelle passe à son tour dans l’historique.</p> : <NotePoste />}
          </>
        }
      >
        <EntetePagePleine titre={dateChoisie ? `Version du ${dateVersion(dateChoisie).toLocaleLowerCase("fr")}` : "Une version"} onFermer={() => setChoisie(null)} />
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <VueLecture lecture={version} ferme={(sur) => `l’historique de ${nom} est sur ${sur}. Il s’affiche quand KLYRA y est ouverte.`}>
            {(v) => (
              <div className="flex flex-col gap-4 px-4">
                <AvantApresFiche avant={v.contenu} apres={v.actuel} titreAvant="Cette version" titreApres="La fiche actuelle" />
                <ErreurGeste message={erreur?.message} />
              </div>
            )}
          </VueLecture>
        </div>
      </PagePleine>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={`Historique de ${nom}`} retour={versFiche} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <VueLecture lecture={versions} ferme={(sur) => `l’historique de ${nom} est sur ${sur}. Il s’affiche quand KLYRA y est ouverte.`}>
          {(liste) =>
            liste.length ? (
              <div className="flex flex-col gap-3 px-4 pt-1">
                <p className="px-1 text-ui text-texte-secondaire">Chaque modification faite dans l’app garde ici la version remplacée.</p>
                <GroupeListe>
                  {liste.map((v) => (
                    <LigneListe key={v.id} debut={<TuileIcone icone="clock-backward" />} retrait="tuile" nom={dateVersion(v.savedAt)} fin="chevron" onClick={() => setChoisie(v.id)} />
                  ))}
                </GroupeListe>
              </div>
            ) : (
              <p className="px-4 pt-6 text-ui text-texte-secondaire">Pas encore de version précédente. Chaque modification faite dans l’app gardera ici la version remplacée.</p>
            )
          }
        </VueLecture>
      </div>
    </div>
  );
}
