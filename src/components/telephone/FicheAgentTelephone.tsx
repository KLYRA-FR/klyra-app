"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Markdown } from "@/components/ui/Markdown";
import { PRINCIPAL } from "@/data/agents";
import { roleFromContent } from "@/lib/agents";
import type { Lien } from "@/lib/lien-bibliotheque";
import { useLecturePoste } from "@/lib/poste/client";
import { idDirect } from "@/lib/workspace";
import { ID_ASSISTANT, libelleRetour, teinteSure, texteConversations } from "@/lib/telephone/agents";
import type { ApercuPartage, FicheLue } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import type { Role, RoleSection, RoleTeinte } from "@/types/domain";
import { AvantApresFiche } from "./AvantApresFiche";
import { BoutonMenu, CHAMP_TELEPHONE, ChampTelephone, ErreurGeste, useCartesAgents } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, type ActionMenu } from "./Feuille";
import { NotePoste, VueLecture } from "./etats";
import { useSupport } from "./poste";

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

/** Ce que la fiche dit de l'origine de l'agent, comme au bureau, avec le nom du poste. */
function texteOrigine(lien: Lien, nom: string, sur: string): string | null {
  switch (lien.type) {
    case "modele":
      return lien.aJour ? "Modèle KLYRA" : lien.miseAJour !== null ? `Modèle KLYRA · version ${lien.miseAJour} disponible` : "Modèle KLYRA · ta version diffère du modèle";
    case "recu":
      if (lien.retiree) return `Copie privée de « ${nom} » (${lien.auteur}), plus partagé`;
      return `De ${lien.auteur} · v${lien.version}${lien.modifie ? ` · modifié sur ${sur}` : ""}`;
    case "suspendu":
      return "Reçu de la bibliothèque · lien suspendu";
    case "copie":
      return lien.auteur ? `Copie privée de « ${nom} » (${lien.auteur})${lien.retiree ? ", plus partagé" : ""}` : "Copie privée";
    case "publie":
      return `Partagé avec l’équipe · v${lien.version}`;
    default:
      return null;
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

  const lue = fiche.etat === "ok" ? fiche.data : null;
  const agent = lue?.type === "agent" ? lue : null;
  const role = useMemo(() => (agent ? roleDeFiche(agent) : null), [agent]);
  const identite = carte(id);
  const nom = identite?.nom ?? role?.name ?? id;
  const teinte: RoleTeinte = identite?.teinte ?? role?.teinte ?? teinteSure(null);
  const roleCourt = identite?.roleCourt ?? role?.tag ?? "";
  const statut = agent?.statut ?? (assistant || identite?.actif ? "actif" : "desactive");
  const siennes = (conversations ?? []).filter((c) => c.roleIds.includes(id));

  /* De retour de l'éditeur, de Lou ou de l'historique : « Enregistré » (spec § 5). */
  const enregistre = params.get("enregistre");
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

  const actions: ActionMenu[] = assistant
    ? [{ libelle: "Personnaliser", onChoisir: () => setPersonnaliser(true), ...poste }]
    : [
        { libelle: "Modifier la fiche", onChoisir: () => aller("modifier"), ...poste },
        { libelle: "Demander à Lou", onChoisir: () => aller("lou"), ...poste },
        { libelle: "Historique", onChoisir: () => aller("historique"), ...poste },
        { libelle: "Personnaliser", onChoisir: () => setPersonnaliser(true), ...poste },
        statut === "actif"
          ? { libelle: "Désactiver", onChoisir: () => setDesactiver(true), danger: true, ...poste }
          : {
              libelle: agent ? libelleRetour({ id, statut: agent.statut, desactiveLe: null, definitionId: null, modele: null }) : "Ajouter à mes agents",
              onChoisir: () => void agir("agents.activer", { id, actif: true }, `${nom} est de retour dans tes agents.`).then(apres),
              ...poste,
            },
      ];
  if (agent?.partage) {
    actions.push({
      libelle: "Partager avec l’équipe",
      onChoisir: () => setPartage("partager"),
      desactivee: poste.desactivee || agent.partage.raison !== null,
      note: agent.partage.raison ? <p className="text-ui-xs text-texte-secondaire">{agent.partage.raison}</p> : poste.note,
    });
  }
  if (agent?.lien.type === "publie") {
    actions.push({ libelle: "Publier une mise à jour", onChoisir: () => setPartage("mettre-a-jour"), ...poste });
    actions.push({ libelle: "Retirer de la bibliothèque", onChoisir: () => setRetirer(true), ...poste });
  }
  if (agent?.modeleKlyra) actions.push({ libelle: "Comparer au modèle KLYRA", onChoisir: () => aller("maj"), ...poste });

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
      <EnteteTelephone titre={nom} retour={() => router.push("/equipe")} droite={<BoutonMenu libelle="Plus d’options" onClick={() => setMenu(true)} />} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <header className="flex flex-col gap-3 px-4 pt-2">
          <div className="flex items-center gap-3">
            <RondApercu agentId={id} nom={nom} teinte={teinte} taille={64} />
            <div className="min-w-0">
              <h2 className="truncate text-h4 font-semibold text-texte-principal">{nom}</h2>
              <p className="truncate text-ui text-texte-secondaire">{assistant ? "Ton assistant" : roleCourt}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {statut === "actif" ? (
              <BoutonPrincipal href={`/chat?id=${encodeURIComponent(idDirect(id))}`} className="flex-1">
                Écrire
              </BoutonPrincipal>
            ) : null}
            <Bouton variant="blanc" taille="md" className="flex-1" onClick={() => setConversationsOuvertes(true)}>
              Voir ses conversations
            </Bouton>
          </div>
          <ErreurGeste message={erreur?.message} />
        </header>

        {assistant ? (
          <div className="mt-4 px-4">
            <SectionsFiche role={{ ...PRINCIPAL, name: nom, sections: [] }} />
          </div>
        ) : (
          <div className="mt-4">
            <VueLecture lecture={fiche} ferme={(s) => `la fiche de ${nom} est sur ${s}. Elle s’affiche quand KLYRA y est ouverte.`}>
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
                    <p className="text-ui-xs text-texte-secondaire">
                      {[texteOrigine(agent.lien, nom, sur), role.model ? `Modèle ${role.model}` : null, `${agent.chemin} · modifiée le ${dateLongue.format(agent.modifiedAt)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <SectionsFiche role={role} />
                  </div>
                ) : null
              }
            </VueLecture>
          </div>
        )}
      </div>

      {menu ? <MenuFeuille titre={nom} actions={actions} onFermer={() => setMenu(false)} /> : null}
      {conversationsOuvertes ? (
        <Feuille titre={`Conversations avec ${nom}`} onFermer={() => setConversationsOuvertes(false)}>
          {siennes.length ? (
            <ul>
              {siennes.map((c) => (
                <li key={c.origine} className="border-b border-bordure-subtile last:border-b-0">
                  <Link href={`/chat?id=${encodeURIComponent(c.origine)}`} className="flex min-h-14 flex-col justify-center py-2 active:bg-fond-survol">
                    <span className="truncate text-body-s text-texte-principal">{c.titre}</span>
                    {c.extrait ? <span className="truncate text-ui-xs text-texte-secondaire">{c.extrait}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
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
    <div role="status" className="flex flex-col gap-2 rounded-md border border-bordure-subtile bg-fond-surface p-3">
      <p className="text-ui text-texte-principal">{texte}</p>
      {action ? (
        <>
          <Bouton variant="blanc" taille="md" disabled={!ouvert || occupe} onClick={action.onClick}>
            {action.libelle}
          </Bouton>
          {ouvert ? null : <NotePoste />}
        </>
      ) : null}
    </div>
  );
  const { lien } = agent;
  return (
    <>
      {agent.statut === "desactive"
        ? bandeau(`${nom} n’est plus dans Mes agents${agent.desactiveLe ? ` depuis le ${dateLongue.format(agent.desactiveLe)}` : ""}. Ni toi, ni tes agents ne peuvent l’appeler dans l’app.`, {
            libelle: "Réactiver",
            onClick: onRemettre,
          })
        : null}
      {agent.statut === "disponible" ? bandeau(`Cette fiche est sur ${sur}, mais pas dans Mes agents : KLYRA ne l’appelle pas.`, { libelle: "Ajouter à mes agents", onClick: onRemettre }) : null}
      {agent.statut === "actif" && lien.type === "modele" && lien.miseAJour !== null
        ? bandeau(`Le modèle KLYRA de ${nom} a une nouvelle version (version ${lien.miseAJour}). Rien ne change tant que tu ne choisis pas.`, { libelle: "Voir les changements", onClick: onComparer })
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
          <ChoixTeinte valeur={teinte} onChange={setTeinte} libelleId={`couleur-${id}`} />
        </div>
        <ErreurGeste message={erreur?.message} />
      </div>
    </Feuille>
  );
}

/** « Partager avec l'équipe » et « Publier une mise à jour » : l'aperçu exact de ce qui part, préparé par l'ordinateur. */
function FeuillePartager({
  id,
  mode,
  empreinte,
  onFermer,
  onFait,
}: {
  id: string;
  mode: "partager" | "mettre-a-jour";
  empreinte: string;
  onFermer: () => void;
  onFait: (texte: string) => void;
}) {
  const apercu = useLecturePoste<ApercuPartage>("agents.apercuPartage", { id, mode });
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
              {a.dependances.length ? (
                <section>
                  <h3 className="text-ui font-medium text-texte-principal">Dossiers que chacun choisira</h3>
                  <ul className="mt-1 list-disc pl-5 text-ui text-texte-secondaire">
                    {a.dependances.map((d) => (
                      <li key={d.cle}>{d.libelle}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-ui font-medium text-texte-principal">
                  <Icon name="chevron-right" size={20} className="text-icone-secondaire transition-transform duration-[220ms] group-open:rotate-90 motion-reduce:transition-none" />
                  Le texte exact qui part
                </summary>
                <pre className="mt-2 rounded-md border border-bordure-subtile bg-fond-page p-3 font-[inherit] text-body-s break-words whitespace-pre-wrap text-texte-principal">{a.contenu}</pre>
              </details>
              <ErreurGeste message={erreur?.message} />
            </div>
          )}
        </VueLecture>
      </div>
    </Feuille>
  );
}

const dateVersion = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/** Historique d'une fiche : chaque version remplacée par l'app ; on la compare à la fiche actuelle et on la restaure. */
export function HistoriqueFicheTelephone({ id }: { id: string }) {
  const router = useRouter();
  const { carte } = useCartesAgents();
  const nom = carte(id)?.nom ?? id;
  const versions = useLecturePoste<{ id: string; savedAt: number }[]>("agents.historique", { id });
  const [choisie, setChoisie] = useState<string | null>(null);
  const version = useLecturePoste<{ contenu: string; actuel: string; empreinte: string }>("agents.version", choisie ? { id, versionId: choisie } : null);
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const fiche = `/equipe?agent=${encodeURIComponent(id)}`;

  const restaurer = async () => {
    if (!choisie || version.etat !== "ok") return;
    const ok = await agir("agents.restaurer", { id, versionId: choisie, empreinte: version.data.empreinte });
    if (ok) router.push(`${fiche}&enregistre=1`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={choisie ? "Une version" : `Historique de ${nom}`} retour={() => (choisie ? setChoisie(null) : router.push(fiche))} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {choisie ? (
          <VueLecture lecture={version} ferme={(sur) => `l’historique de ${nom} est sur ${sur}. Il s’affiche quand KLYRA y est ouverte.`}>
            {(v) => (
              <div className="flex flex-col gap-4 px-4">
                <AvantApresFiche avant={v.contenu} apres={v.actuel} titreAvant="Cette version" titreApres="La fiche actuelle" />
                <BoutonPrincipal className="w-full" disabled={!ouvert || occupe} onClick={() => void restaurer()}>
                  Restaurer cette version
                </BoutonPrincipal>
                {ouvert ? <p className="text-ui-xs text-texte-secondaire">La version actuelle passe à son tour dans l’historique.</p> : <NotePoste />}
                <ErreurGeste message={erreur?.message} />
              </div>
            )}
          </VueLecture>
        ) : (
          <VueLecture lecture={versions} ferme={(sur) => `l’historique de ${nom} est sur ${sur}. Il s’affiche quand KLYRA y est ouverte.`}>
            {(liste) =>
              liste.length ? (
                <ul className="px-4">
                  {liste.map((v) => (
                    <li key={v.id} className="border-b border-bordure-subtile">
                      <button type="button" onClick={() => setChoisie(v.id)} className="flex min-h-12 w-full items-center justify-between text-left text-body-s text-texte-principal active:bg-fond-survol">
                        {dateVersion.format(v.savedAt)}
                        <Icon name="chevron-right" size={20} className="text-icone-secondaire" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 pt-6 text-ui text-texte-secondaire">Pas encore de version précédente. Chaque modification faite dans l’app gardera ici la version remplacée.</p>
              )
            }
          </VueLecture>
        )}
      </div>
    </div>
  );
}
