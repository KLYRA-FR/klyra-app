"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input, Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { getField, newAgentBody, parseAgentFile, parseBody } from "@/lib/agent-file";
import { teinteDuNom } from "@/lib/bibliotheque-ui";
import { cn } from "@/lib/cn";
import { identifiantDe, nomPropre } from "@/lib/noms-agents";
import { useLecturePoste } from "@/lib/poste/client";
import { oublierProposition, reprendreBrouillonTelephone } from "@/lib/proposition-agent";
import { ID_ASSISTANT, MEMOIRES_FICHE, MODELES_FICHE, teinteSure } from "@/lib/telephone/agents";
import type { FicheLue } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import type { RoleTeinte } from "@/types/domain";
import { CHAMP_TELEPHONE, ChampTelephone, ErreurGeste, PagePleine, useCartesAgents, EntetePagePleine } from "./CommunAgentsTelephone";
import { ConfirmationFeuille } from "./Feuille";
import { roleDeFiche } from "./FicheAgentTelephone";
import { NotePoste, VueLecture } from "./etats";
import { useSupport } from "./poste";
import { useRetour } from "./retour";

/**
 * L'éditeur de fiche du téléphone (spec T-09) : page pleine, un champ par bloc (« Rôle court »,
 * « Quand l'appeler », « Fiche », « Réglages avancés » replié), « Enregistrer » collé en bas.
 * La version ouverte est figée : si la fiche change sur l'ordinateur entre-temps, l'ordinateur
 * refuse l'écriture (empreinte), comme `useAgents().save` au bureau. Poste fermé : P-7.
 */

const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Le bloc « Parler en équipe », repris d'une fiche de l'équipe (comme l'éditeur du bureau). */
const BLOC_COMMUN = (() => {
  const section = parseBody(parseAgentFile(AGENT_TEMPLATES[0]?.content ?? "").body).sections.find((s) => /^Parler en équipe/.test(s.title));
  return section ? `## ${section.title}\n\n${section.body}` : "";
})();

const CHAMP_LONG = cn(CHAMP_TELEPHONE, "leading-[1.5]");
const LISTE = "min-h-11 text-body-s";

export function EditeurFicheTelephone({ id }: { id: string | null }) {
  if (id === null || id === ID_ASSISTANT) return <CreationFiche />;
  return <ModificationFiche id={id} />;
}

/** La barre collée en bas : le bouton, et ce qui l'empêche (P-7). */
function Barre({ libelle, disabled, onClick, ouvert, detail }: { libelle: string; disabled: boolean; onClick: () => void; ouvert: boolean; detail?: string }) {
  return (
    <div className="shrink-0 border-t border-bordure-subtile bg-fond-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      <Bouton variant="sombre" taille="md" className="w-full" disabled={disabled} onClick={onClick}>
        {libelle}
      </Bouton>
      {!ouvert ? <NotePoste /> : detail ? <p className="mt-1 text-ui-xs text-texte-secondaire">{detail}</p> : null}
    </div>
  );
}

function ChampsAvances({
  ouvert,
  onToggle,
  identifiant,
  children,
}: {
  ouvert: boolean;
  onToggle: (ouvert: boolean) => void;
  identifiant: string;
  children: ReactNode;
}) {
  return (
    <details open={ouvert} onToggle={(e) => onToggle(e.currentTarget.open)} className="group rounded-xl border border-bordure-subtile bg-fond-surface px-4">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-body-s font-medium text-texte-principal">
        <Icon name="chevron-right" size={20} className="text-icone-secondaire transition-transform duration-[220ms] ease-sortie group-open:rotate-90 motion-reduce:transition-none" />
        Réglages avancés
        <span className="truncate text-ui font-normal text-texte-secondaire">· « {identifiant || "…"} »</span>
      </summary>
      <div className="flex flex-col gap-4 pb-4">{children}</div>
    </details>
  );
}

function ModificationFiche({ id }: { id: string }) {
  /* Une fiche se modifie en direct : pas de vue gardée dans l'éditeur. */
  const lecture = useLecturePoste<FicheLue>("agents.fiche", { id }, { garder: false });
  const [gardee, setGardee] = useState<Extract<FicheLue, { type: "agent" }> | null>(null);
  const [cle, setCle] = useState(0);
  const { carte } = useCartesAgents();
  const nom = carte(id)?.nom ?? "cet agent";
  const versFiche = useRetour(`/equipe?agent=${encodeURIComponent(id)}`);
  /* La version ouverte est figée dès sa première lecture : un poste qui se ferme ou se rouvre ne la remplace pas. */
  if (!gardee && lecture.etat === "ok" && lecture.data.type === "agent") setGardee(lecture.data);

  if (!gardee) {
    return (
      <PagePleine>
        <EntetePagePleine titre={`Modifier ${nom}`} onFermer={versFiche} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <VueLecture lecture={lecture} ferme={(sur) => `la fiche de ${nom} est sur ${sur}. Elle s’affiche quand KLYRA y est ouverte.`}>
            {() => null}
          </VueLecture>
        </div>
      </PagePleine>
    );
  }
  return (
    <FormulaireFiche
      key={cle}
      fiche={gardee}
      onReprendre={() => {
        setGardee(null);
        setCle((k) => k + 1);
        lecture.relancer();
      }}
    />
  );
}

function FormulaireFiche({ fiche, onReprendre }: { fiche: Extract<FicheLue, { type: "agent" }>; onReprendre: () => void }) {
  const [copieFaite, setCopieFaite] = useState<string | null>(null);
  const router = useRouter();
  const sur = useSupport();
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const [initial] = useState(() => {
    const role = roleDeFiche(fiche);
    const { frontmatter, body } = parseAgentFile(fiche.contenu);
    return {
      nom: role.name,
      tag: fiche.reglage.tag ?? role.tag,
      teinte: teinteSure(fiche.reglage.teinte, role.teinte),
      description: getField(frontmatter, "description") ?? "",
      corps: body.trim(),
      modele: getField(frontmatter, "model") ?? "",
      memoire: getField(frontmatter, "memory") ?? "",
    };
  });
  const [tag, setTag] = useState(initial.tag);
  const [description, setDescription] = useState(initial.description);
  const [corps, setCorps] = useState(initial.corps);
  const [modele, setModele] = useState(initial.modele);
  const [memoire, setMemoire] = useState(initial.memoire);
  const [avance, setAvance] = useState(false);
  const [essai, setEssai] = useState(false);
  const [copie, setCopie] = useState(false);
  const [abandon, setAbandon] = useState(false);
  const retour = `/equipe?agent=${encodeURIComponent(fiche.id)}`;
  const retourner = useRetour(retour);
  const auteur = fiche.lien.type === "recu" ? fiche.lien.auteur : null;

  const erreurs = {
    tag: tag.trim() ? null : "Donne-lui un rôle court, affiché à côté de son nom.",
    description: description.trim() ? null : "Écris quand l’appeler : c’est ce que Claude lit pour choisir l’agent.",
    corps: corps.trim() ? null : "La fiche ne peut pas être vide.",
  };
  const valide = Object.values(erreurs).every((e) => !e);
  const consigneChangee = description !== initial.description || corps !== initial.corps;
  const modifie = consigneChangee || tag !== initial.tag || modele !== initial.modele || memoire !== initial.memoire;
  const modeles = MODELES_FICHE.some((m) => m.value === modele) ? MODELES_FICHE : [...MODELES_FICHE, { value: modele, label: modele || "Aucun" }];
  const memoires = MEMOIRES_FICHE.some((m) => m.value === memoire) ? MEMOIRES_FICHE : [...MEMOIRES_FICHE, { value: memoire, label: memoire }];

  const ecrire = async () => {
    const ok = await agir("agents.enregistrer", { id: fiche.id, empreinte: fiche.empreinte, description, corps, modele, memoire, tag, teinte: initial.teinte });
    if (ok) router.push(`${retour}&enregistre=1`);
  };
  const enregistrer = () => {
    setEssai(true);
    if (!valide) return;
    if (fiche.lie && consigneChangee) setCopie(true);
    else void ecrire();
  };

  return (
    <PagePleine>
      <EntetePagePleine titre={`Modifier ${initial.nom}`} onFermer={() => (modifie ? setAbandon(true) : retourner())} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {erreur?.code === "conflit" ? (
          <div role="alert" className="mt-3 flex flex-col gap-2 rounded-md border border-bordure-erreur bg-fond-surface p-3">
            <p className="text-ui text-texte-principal">
              <span className="font-medium">{erreur.message}.</span> Rien n’a été écrit. Quelqu’un (ou un agent) l’a modifiée entre-temps.
            </p>
            <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="refresh-01" size={20} />} disabled={!ouvert} onClick={onReprendre}>
              Reprendre la version de {sur}
            </Bouton>
            <Bouton
              variant="discret"
              taille="md"
              iconeGauche={<Icon name="copy-left" size={20} />}
              onClick={() =>
                void navigator.clipboard?.writeText(corps).then(
                  () => setCopieFaite("Tes changements sont copiés."),
                  () => setCopieFaite("Tes changements n’ont pas été copiés."),
                )
              }
            >
              Copier mes changements
            </Bouton>
            {copieFaite ? <p role="status" className="text-ui-xs text-texte-secondaire">{copieFaite}</p> : null}
          </div>
        ) : null}

        {fiche.lie ? (
          <p role="status" className="mt-3 rounded-md border border-bordure-subtile bg-fond-surface p-3 text-ui text-texte-principal">
            Cet agent suit {auteur ? `la version de ${auteur}` : "une version de la bibliothèque"}. Changer son rôle court ou son modèle ne casse rien. Changer « Quand
            l’appeler » ou sa fiche en fait ta copie privée.
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-3">
          <p className="min-w-0 flex-1 text-ui text-texte-secondaire">Tu préfères ne pas toucher au texte ? Dis à Lou ce qui doit changer.</p>
          <Bouton variant="blanc" iconeGauche={<Icon name="stars" size={16} />} className="relative shrink-0 after:absolute after:-inset-x-1 after:-inset-y-1.5" onClick={() => router.push(`${retour}&mode=lou`)}>
            Avec Lou
          </Bouton>
        </div>

        <div className="mt-4 flex flex-col gap-5">
          <ChampTelephone label="Rôle court" erreur={essai ? erreurs.tag : null} aide="Affiché à côté de son nom dans les chats (« Dev », « Ventes »).">
            <Input size="lg" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} className={CHAMP_TELEPHONE} />
          </ChampTelephone>
          <ChampTelephone label="Quand l’appeler" erreur={essai ? erreurs.description : null} aide="La description lue par Claude pour choisir l’agent.">
            <Textarea size="lg" autoGrow rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={CHAMP_LONG} />
          </ChampTelephone>
          <ChampTelephone label="Fiche" erreur={essai ? erreurs.corps : null} aide="En Markdown : un titre « # Nom — Rôle », une présentation, puis des sections « ## ».">
            <Textarea size="lg" autoGrow rows={12} spellCheck={false} value={corps} onChange={(e) => setCorps(e.target.value)} className={CHAMP_LONG} />
          </ChampTelephone>
          <ChampsAvances ouvert={avance} onToggle={setAvance} identifiant={fiche.id}>
            <ChampTelephone label="Identifiant" aide="Ne change pas : Claude Code et les autres fiches l’utilisent.">
              <span className="klyra-mono text-body-s text-texte-principal">{fiche.id}</span>
            </ChampTelephone>
            <ChampTelephone label="Modèle">
              <ListeDeroulante options={modeles} value={modele} onChange={setModele} className={LISTE} />
            </ChampTelephone>
            <ChampTelephone label="Mémoire" aide={fiche.lie ? "Réglée par la version suivie." : undefined}>
              <ListeDeroulante options={memoires} value={memoire} onChange={setMemoire} disabled={fiche.lie} className={LISTE} />
            </ChampTelephone>
          </ChampsAvances>
          {erreur && erreur.code !== "conflit" ? <ErreurGeste message={`L’enregistrement a échoué : ${erreur.message}`} /> : null}
        </div>
      </div>
      <Barre
        libelle={occupe ? "Enregistrement…" : "Enregistrer"}
        disabled={!ouvert || occupe || !modifie || erreur?.code === "conflit"}
        onClick={enregistrer}
        ouvert={ouvert}
        detail={erreur?.code === "conflit" ? `Reprends d’abord la version de ${sur}.` : modifie ? "L’ancienne version reste dans l’historique." : "Aucune modification."}
      />
      {copie ? (
        <ConfirmationFeuille
          titre="Créer ta copie privée ?"
          texte={`Tu as modifié la consigne de ${initial.nom}. Ta version ne suivra plus ${auteur ? `celle de ${auteur}` : "celle de la bibliothèque"}. Tu pourras y revenir depuis sa fiche.`}
          confirmer="Créer ma copie privée"
          onConfirmer={() => void ecrire()}
          onFermer={() => setCopie(false)}
        />
      ) : null}
      {abandon ? (
        <ConfirmationFeuille
          titre="Abandonner les modifications ?"
          texte="Ce que tu as changé dans cette fiche ne sera pas enregistré."
          confirmer="Abandonner"
          onConfirmer={retourner}
          onFermer={() => setAbandon(false)}
        />
      ) : null}
    </PagePleine>
  );
}

/** Créer un agent (« Remplir la fiche moi-même », ou la proposition de l'assistant : `&proposition=1`). */
function CreationFiche() {
  const router = useRouter();
  const params = useSearchParams();
  const sur = useSupport();
  const { cartes, liste } = useCartesAgents();
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const propositionDemandee = !!params.get("proposition");
  const [proposition] = useState(() => (propositionDemandee ? reprendreBrouillonTelephone() : null));
  const [nom, setNom] = useState(proposition?.nom ?? "");
  const [tag, setTag] = useState(proposition?.role ?? "");
  const [teinte, setTeinte] = useState<RoleTeinte>(() => (proposition ? teinteDuNom(proposition.id || identifiantDe(proposition.nom)) : "bleu-k2"));
  const [description, setDescription] = useState(proposition?.description ?? "");
  const [corpsSaisi, setCorpsSaisi] = useState<string | null>(proposition?.consignes || null);
  const [idSaisi, setIdSaisi] = useState<string | null>(proposition?.id || null);
  const [modele, setModele] = useState("opus");
  const [memoire, setMemoire] = useState("project");
  const [avance, setAvance] = useState(false);
  const [essai, setEssai] = useState(false);
  const [abandon, setAbandon] = useState(false);

  /* Les identifiants déjà vus dans le compte ; l'ordinateur vérifie de nouveau, rien n'est écrasé. */
  const pris = (x: string) => x === ID_ASSISTANT || !!cartes?.some((c) => c.origine === x);
  const base = idSaisi ?? (identifiantDe(nom) || "agent");
  const id = idSaisi === null && pris(base) ? (Array.from({ length: 98 }, (_, i) => `${base}-${i + 2}`).find((x) => !pris(x)) ?? base) : base;
  const corps = corpsSaisi ?? newAgentBody(nomPropre(nom), tag.trim(), BLOC_COMMUN);
  const nomPris = [liste?.assistant, ...(liste?.actifs ?? [])].find((a) => a && nomPropre(a.nom).toLowerCase() === nomPropre(nom).toLowerCase());

  const erreurs = {
    nom: !nomPropre(nom) ? "Donne-lui un nom." : nomPris ? `Tu as déjà un agent qui s’appelle ${nomPris.nom}. Choisis un autre nom pour les distinguer dans les chats.` : null,
    tag: tag.trim() ? null : "Donne-lui un rôle court, affiché à côté de son nom.",
    description: description.trim() ? null : "Écris quand l’appeler : c’est ce que Claude lit pour choisir l’agent.",
    corps: corps.trim() ? null : "La fiche ne peut pas être vide.",
    id: !NOM_VALIDE.test(id) ? "Minuscules, chiffres et tirets seulement, sans espace ni accent." : idSaisi !== null && pris(id) ? `« ${id} » existe déjà sur ${sur} : choisis-en un autre, rien ne sera écrasé.` : null,
  };
  const valide = Object.values(erreurs).every((e) => !e);
  const modifie = !!(nom || tag || description || corpsSaisi !== null);

  const creer = async () => {
    setEssai(true);
    if (!valide) {
      if (erreurs.id) setAvance(true);
      return;
    }
    const r = await agir<{ id: string }>("agents.creer", { nom, id, tag, teinte, description, corps, modele, memoire });
    if (!r) return;
    oublierProposition();
    router.push(`/equipe?agent=${encodeURIComponent(r.id)}&enregistre=1`);
  };
  const quitter = () => {
    if (proposition) oublierProposition();
    router.push("/equipe");
  };

  return (
    <PagePleine>
      <EntetePagePleine titre="Nouvel agent" onFermer={() => (modifie ? setAbandon(true) : quitter())} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {proposition ? (
          <p className="rounded-md border border-bordure-subtile bg-fond-surface p-3 text-ui text-texte-secondaire">
            <span className="font-medium text-texte-principal">Préparé par {liste?.assistant.nom ?? "ton assistant"} à partir de ta demande.</span> Relis, ajuste ce qui doit
            l’être, puis crée l’agent.
          </p>
        ) : propositionDemandee ? (
          <p className="rounded-md border border-bordure-subtile bg-fond-surface p-3 text-ui text-texte-secondaire">
            Cette proposition n’est plus disponible. La fiche reste vide : tu peux la remplir.
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <RondApercu agentId={id || "nouveau"} nom={nom || "Nouvel agent"} teinte={teinte} taille={48} />
          <p className="min-w-0 truncate text-body-s text-texte-principal">
            {nom || "Nom"} <span className="text-texte-secondaire">· {tag || "Rôle"}</span>
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-5">
          <ChampTelephone label="Nom" erreur={essai ? erreurs.nom : null}>
            <Input size="lg" value={nom} maxLength={60} onChange={(e) => setNom(e.target.value)} className={CHAMP_TELEPHONE} />
          </ChampTelephone>
          <ChampTelephone label="Rôle court" erreur={essai ? erreurs.tag : null} aide="Affiché à côté de son nom dans les chats (« Dev », « Ventes »).">
            <Input size="lg" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} className={CHAMP_TELEPHONE} />
          </ChampTelephone>
          <div className="flex flex-col gap-2">
            <span id="couleur-nouvel-agent" className="text-ui font-medium text-texte-principal">
              Couleur de son visuel
            </span>
            <ChoixTeinte grand valeur={teinte} onChange={setTeinte} libelleId="couleur-nouvel-agent" />
          </div>
          <ChampTelephone label="Quand l’appeler" erreur={essai ? erreurs.description : null} aide="Le motif : « Rôle — ce qu’il couvre. Appelle X dès que… ».">
            <Textarea size="lg" autoGrow rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={CHAMP_LONG} />
          </ChampTelephone>
          <ChampTelephone label="Fiche" erreur={essai ? erreurs.corps : null} aide="C’est la consigne complète de l’agent, en Markdown.">
            <Textarea size="lg" autoGrow rows={12} spellCheck={false} value={corps} onChange={(e) => setCorpsSaisi(e.target.value)} className={CHAMP_LONG} />
          </ChampTelephone>
          <ChampsAvances ouvert={avance} onToggle={setAvance} identifiant={id}>
            <ChampTelephone label="Identifiant" erreur={essai ? erreurs.id : null} aide="Le nom du fichier et du sous-agent. Il ne pourra plus changer.">
              <Input size="lg" value={id} autoCapitalize="none" autoCorrect="off" onChange={(e) => setIdSaisi(e.target.value.toLowerCase())} className={cn(CHAMP_TELEPHONE, "klyra-mono")} />
            </ChampTelephone>
            <ChampTelephone label="Modèle">
              <ListeDeroulante options={MODELES_FICHE} value={modele} onChange={setModele} className={LISTE} />
            </ChampTelephone>
            <ChampTelephone label="Mémoire">
              <ListeDeroulante options={MEMOIRES_FICHE} value={memoire} onChange={setMemoire} className={LISTE} />
            </ChampTelephone>
          </ChampsAvances>
          <ErreurGeste message={erreur ? `La création a échoué : ${erreur.message}` : null} />
        </div>
      </div>
      <Barre libelle={occupe ? "Création…" : "Créer l’agent"} disabled={!ouvert || occupe} onClick={() => void creer()} ouvert={ouvert} detail={`Crée sa fiche dans l’app, sur ${sur}.`} />
      {abandon ? (
        <ConfirmationFeuille
          titre="Abandonner les modifications ?"
          texte="Ce que tu as écrit pour cet agent ne sera pas enregistré."
          confirmer="Abandonner"
          onConfirmer={quitter}
          onFermer={() => setAbandon(false)}
        />
      ) : null}
    </PagePleine>
  );
}
