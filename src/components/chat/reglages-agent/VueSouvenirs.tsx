"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone, boutonVariants } from "@/components/ui/Bouton";
import { Markdown } from "@/components/ui/Markdown";
import { annoncer } from "@/lib/annonces";
import { getBridge, type ContexteConnaissances, type MemoireAgent, type Souvenir } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { poste } from "@/lib/plateforme";
import type { Role } from "@/types/domain";
import type { Lecture } from "./donnees";
import { CHAMP_EN_LIGNE, EnteteVue, Groupe, LIGNE, LIGNE_ACTIVE, Note, TitreGroupe } from "./elements";

const PORTEES: Record<MemoireAgent["portee"], string> = {
  user: "Partagée entre tous ses projets",
  project: "Propre au dossier de cette conversation",
  local: "Propre à ce dossier, hors du dépôt",
  auto: "Sa mémoire dans le dossier de cette conversation",
};

/** Un dossier sur ce poste s'ouvre ; sur un VPS, il reste là-bas. */
const ouvrable = (contexte: ContexteConnaissances | null) => !!contexte && !contexte.lieu;

const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Le texte d'un souvenir sans son en-tête YAML. */
const sansEntete = (contenu: string) => contenu.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

const sansAccents = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function LigneSouvenir({ souvenir, onOuvrir }: { souvenir: Souvenir; onOuvrir: () => void }) {
  return (
    <button type="button" onClick={onOuvrir} className={cn(LIGNE, LIGNE_ACTIVE)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{souvenir.titre}</span>
        {souvenir.description && <span className="truncate text-ui-xs text-texte-tertiaire">{souvenir.description}</span>}
      </span>
      <Icon name="chevron-right" size={14} className="shrink-0 text-icone-secondaire" />
    </button>
  );
}

/**
 * Les souvenirs de l'agent : l'index, lu à chaque appel, puis ceux qu'il lit au besoin ; recherche,
 * nouveau souvenir, lecture et modification. Rien n'est supprimé d'ici.
 */
export function VueSouvenirs({
  role,
  contexte,
  lecture,
  actualiser,
  coupee,
  lienFiche,
  onRetour,
}: {
  role: Role;
  contexte: ContexteConnaissances | null;
  lecture: Lecture<MemoireAgent | null>;
  actualiser: () => void;
  /** La configuration KLYRA coupe la mémoire des agents. */
  coupee: boolean;
  lienFiche: string | null;
  onRetour: () => void;
}) {
  const [recherche, setRecherche] = useState("");
  const [ouvert, setOuvert] = useState<string | "nouveau" | null>(null);
  const memoire = lecture.etat === "pret" ? lecture.valeur : null;
  const bridge = getBridge()?.agents;

  const filtres = useMemo(() => {
    const q = sansAccents(recherche.trim());
    const tous = memoire?.souvenirs ?? [];
    return q ? tous.filter((s) => sansAccents(`${s.titre} ${s.description} ${s.id}`).includes(q)) : tous;
  }, [memoire, recherche]);

  if (ouvert === "nouveau" && contexte)
    return (
      <NouveauSouvenir
        role={role}
        contexte={contexte}
        onFini={(id) => {
          actualiser();
          setOuvert(id);
        }}
        onRetour={() => setOuvert(null)}
      />
    );
  if (ouvert && contexte) {
    const souvenir = memoire?.souvenirs.find((s) => s.id === ouvert);
    return <DetailSouvenir role={role} contexte={contexte} id={ouvert} titre={souvenir?.titre ?? ouvert} onModifie={actualiser} onRetour={() => setOuvert(null)} />;
  }

  const toujours = filtres.filter((s) => s.toujours);
  const auBesoin = filtres.filter((s) => !s.toujours);

  return (
    <div className="flex flex-col gap-4 p-4">
      <EnteteVue
        titre="Souvenirs"
        onRetour={onRetour}
        action={
          memoire && ouvrable(contexte) && bridge?.montrerSouvenir ? (
            <BoutonIcone
              variant="discret"
              taille="compact"
              libelle={`Ouvrir le dossier de sa mémoire ${poste.dansExplorateur}`}
              icone={<Icon name="folder-open-01" size={16} />}
              onClick={() => void bridge.montrerSouvenir!(role.id, contexte!, null).then((r) => !r.ok && annoncer(r.message))}
            />
          ) : undefined
        }
      />

      {coupee && (
        <div className="flex flex-col gap-1 rounded-md border border-bordure-subtile bg-fond-surface-grise px-3 py-2.5 text-ui-xs leading-[1.5] text-texte-secondaire">
          <span>La configuration KLYRA coupe la mémoire des agents : {role.name} ne lit ni n’écrit ses souvenirs pour l’instant. Ils restent là.</span>
          <Link href="/reglages?section=agents" className="self-start text-texte-principal underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
            Changer dans Réglages › Agents
          </Link>
        </div>
      )}

      {lecture.etat === "chargement" && <Note>Lecture de sa mémoire…</Note>}
      {lecture.etat === "erreur" && <Note erreur>{lecture.message}</Note>}
      {lecture.etat === "indisponible" && <Note>La mémoire d’un agent se lit dans l’app de bureau.</Note>}
      {lecture.etat === "pret" && !memoire && (
        <div className="flex flex-col gap-2">
          <Note>
            {role.name} n’a pas de mémoire : sa fiche n’en demande pas. Chaque appel lui coûte environ 4 000 jetons de moins ; il repart de sa fiche et de la conversation.
          </Note>
          {lienFiche && (
            <Link href={lienFiche} className={cn(boutonVariants({ variant: "blanc", taille: "compact" }), "self-start")}>
              Lui donner une mémoire dans sa fiche
            </Link>
          )}
        </div>
      )}

      {memoire && (
        <>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher des souvenirs"
            aria-label="Rechercher des souvenirs"
            className={cn(CHAMP_EN_LIGNE, "h-9")}
          />
          <Groupe>
            <button type="button" onClick={() => setOuvert("nouveau")} className={cn(LIGNE, LIGNE_ACTIVE)}>
              <Icon name="plus-01" size={16} className="shrink-0 text-icone-secondaire" />
              <span className="font-medium">Nouveau souvenir</span>
              <Icon name="chevron-right" size={14} className="ml-auto shrink-0 text-icone-secondaire" />
            </button>
          </Groupe>

          {toujours.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <TitreGroupe>Toujours lu</TitreGroupe>
              <div className="flex flex-col gap-px rounded-md border border-bordure-subtile bg-fond-surface p-1">
                {toujours.map((s) => (
                  <LigneSouvenir key={s.id} souvenir={s} onOuvrir={() => setOuvert(s.id)} />
                ))}
              </div>
              <Note>L’index entre dans chaque appel ({role.name} le relit avant de répondre) : une ligne courte par souvenir suffit.</Note>
            </section>
          )}

          {auBesoin.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <TitreGroupe>Lus au besoin</TitreGroupe>
              <div className="flex flex-col gap-px rounded-md border border-bordure-subtile bg-fond-surface p-1">
                {auBesoin.map((s) => (
                  <LigneSouvenir key={s.id} souvenir={s} onOuvrir={() => setOuvert(s.id)} />
                ))}
              </div>
            </section>
          )}

          {!memoire.souvenirs.length && <Note>Aucun souvenir pour l’instant : {role.name} en écrit quand il apprend quelque chose qui servira plus tard. Tu peux aussi en ajouter un.</Note>}
          {memoire.souvenirs.length > 0 && !filtres.length && <Note>Aucun souvenir ne correspond.</Note>}
          {memoire.coupee && <Note>Liste coupée aux 500 premiers fichiers.</Note>}
          <Note>
            {PORTEES[memoire.portee]}
            {contexte?.lieu ? ", sur le serveur" : ""}.
          </Note>
        </>
      )}
    </div>
  );
}

/** Un souvenir : son texte mis en forme, modifiable ; refusé s'il a changé entre-temps (l'agent a pu l'écrire). */
function DetailSouvenir({
  role,
  contexte,
  id,
  titre,
  onModifie,
  onRetour,
}: {
  role: Role;
  contexte: ContexteConnaissances;
  id: string;
  titre: string;
  onModifie: () => void;
  onRetour: () => void;
}) {
  const bridge = getBridge()?.agents;
  const [fichier, setFichier] = useState<{ contenu: string; modifieLe: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [edition, setEdition] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [tour, setTour] = useState(0);
  const { dossier, sessionId, lieu } = contexte;

  useEffect(() => {
    let actif = true;
    void bridge?.souvenir?.(role.id, lieu ? { dossier, sessionId, lieu } : { dossier, sessionId }, id).then((r) => {
      if (!actif) return;
      if (r.ok) {
        setFichier(r.data);
        setErreur(null);
      } else setErreur(r.message);
    });
    return () => {
      actif = false;
    };
  }, [bridge, role.id, dossier, sessionId, lieu, id, tour]);

  const enregistrer = async () => {
    if (edition === null || !fichier || !bridge?.ecrireSouvenir) return;
    setEnCours(true);
    const r = await bridge.ecrireSouvenir(role.id, contexte, id, edition, fichier.modifieLe);
    setEnCours(false);
    // Un souvenir changé entre-temps (l'agent l'a mis à jour) : refusé, le message le dit.
    if (!r.ok) return setErreur(r.message);
    setEdition(null);
    setErreur(null);
    annoncer("Souvenir enregistré.");
    setTour((t) => t + 1);
    onModifie();
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <EnteteVue
        titre={titre}
        onRetour={onRetour}
        action={
          ouvrable(contexte) && bridge?.montrerSouvenir ? (
            <BoutonIcone
              variant="discret"
              taille="compact"
              libelle={`Montrer ${poste.dansExplorateur}`}
              icone={<Icon name="folder-open-01" size={16} />}
              onClick={() => void bridge.montrerSouvenir!(role.id, contexte, id).then((r) => !r.ok && setErreur(r.message))}
            />
          ) : undefined
        }
      />
      {erreur && <Note erreur>{erreur}</Note>}
      {!fichier && !erreur && <Note>Lecture…</Note>}
      {fichier && edition === null && (
        <>
          <div className="rounded-md border border-bordure-subtile bg-fond-surface p-3">
            {sansEntete(fichier.contenu) ? (
              <Markdown source={sansEntete(fichier.contenu)} className="text-ui-s" />
            ) : (
              <Note>Ce souvenir est vide.</Note>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ui-2xs text-texte-tertiaire">Modifié le {date.format(fichier.modifieLe)}</span>
            <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="pencil-01" size={16} />} onClick={() => setEdition(fichier.contenu)}>
              Modifier
            </Bouton>
          </div>
        </>
      )}
      {fichier && edition !== null && (
        <>
          <textarea
            value={edition}
            onChange={(e) => setEdition(e.target.value)}
            aria-label={`Texte du souvenir « ${titre} »`}
            spellCheck={false}
            autoFocus
            className={cn(CHAMP_EN_LIGNE, "min-h-[280px] resize-y py-2 font-[inherit] leading-[1.5]")}
          />
          <div className="flex gap-2">
            <Bouton variant="sombre" taille="compact" disabled={enCours} onClick={() => void enregistrer()}>
              {enCours ? "Enregistrement…" : "Enregistrer"}
            </Bouton>
            <Bouton
              variant="blanc"
              taille="compact"
              onClick={() => {
                setEdition(null);
                setErreur(null);
              }}
            >
              Annuler
            </Bouton>
          </div>
        </>
      )}
    </div>
  );
}

/** Un nouveau souvenir : un titre et son texte, rangés comme {agent} range les siens (fichier et ligne dans l'index). */
function NouveauSouvenir({ role, contexte, onFini, onRetour }: { role: Role; contexte: ContexteConnaissances; onFini: (id: string) => void; onRetour: () => void }) {
  const bridge = getBridge()?.agents;
  const [titre, setTitre] = useState("");
  const [contenu, setContenu] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valide = !!titre.trim() && !!contenu.trim();

  const creer = async () => {
    if (!valide || !bridge?.creerSouvenir) return;
    setEnCours(true);
    const r = await bridge.creerSouvenir(role.id, contexte, titre, contenu);
    setEnCours(false);
    if (!r.ok) return setErreur(r.message);
    annoncer(`Souvenir ajouté : ${r.data.titre}.`);
    onFini(r.data.id);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <EnteteVue titre="Nouveau souvenir" onRetour={onRetour} />
      <label className="flex flex-col gap-1.5">
        <span className="px-0.5 text-ui-xs font-medium text-texte-tertiaire">Titre</span>
        <input value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={80} autoFocus className={cn(CHAMP_EN_LIGNE, "h-10")} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="px-0.5 text-ui-xs font-medium text-texte-tertiaire">Ce qu’il doit retenir</span>
        <textarea value={contenu} onChange={(e) => setContenu(e.target.value)} spellCheck={false} className={cn(CHAMP_EN_LIGNE, "min-h-[180px] resize-y py-2 leading-[1.5]")} />
      </label>
      <Note>La première ligne devient son résumé dans l’index, lu à chaque appel : {role.name} ouvre le reste quand il en a besoin.</Note>
      {erreur && <Note erreur>{erreur}</Note>}
      <div className="flex gap-2">
        <Bouton variant="sombre" taille="compact" disabled={!valide || enCours} onClick={() => void creer()}>
          {enCours ? "Ajout…" : "Ajouter le souvenir"}
        </Bouton>
        <Bouton variant="blanc" taille="compact" onClick={onRetour}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
}
