"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { getBridge, type EtatDictee, type ModeleDictee } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import type { PontDictee } from "@/lib/dictee/moteur";
import { poste } from "@/lib/plateforme";
import { Erreur, Groupe, Ligne, SeulementBureau, Valeur } from "../ui";

/** Les micros branchés ; leur nom n'apparaît qu'une fois l'accès au micro donné. */
function useMicros(relecture: number) {
  const [micros, setMicros] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const lire = () => void navigator.mediaDevices?.enumerateDevices().then((d) => setMicros(d.filter((x) => x.kind === "audioinput")));
    lire();
    navigator.mediaDevices?.addEventListener("devicechange", lire);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", lire);
  }, [relecture]);
  return micros;
}

/** Le micro du système, écouté quelques secondes : une barre suit le niveau de la voix. */
function TestMicro({ onAutorise }: { onAutorise: () => void }) {
  const [niveau, setNiveau] = useState(0);
  const [ecoute, setEcoute] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const arreter = useRef<() => void>(() => {});

  useEffect(() => () => arreter.current(), []);

  const lancer = async () => {
    setErreur(null);
    try {
      if (getBridge()?.systeme.micro && !(await getBridge()!.systeme.micro!()).ok) throw new Error("Le système refuse l’accès au micro.");
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      onAutorise();
      const contexte = new AudioContext();
      const analyse = contexte.createAnalyser();
      analyse.fftSize = 512;
      contexte.createMediaStreamSource(flux).connect(analyse);
      const donnees = new Uint8Array(analyse.fftSize);
      let image = 0;
      const mesurer = () => {
        analyse.getByteTimeDomainData(donnees);
        let somme = 0;
        for (const v of donnees) somme += ((v - 128) / 128) ** 2;
        setNiveau(Math.min(1, Math.sqrt(somme / donnees.length) * 4));
        image = requestAnimationFrame(mesurer);
      };
      mesurer();
      setEcoute(true);
      const fin = window.setTimeout(() => arreter.current(), 8000);
      arreter.current = () => {
        window.clearTimeout(fin);
        cancelAnimationFrame(image);
        flux.getTracks().forEach((t) => t.stop());
        void contexte.close();
        setEcoute(false);
        setNiveau(0);
        arreter.current = () => {};
      };
    } catch (e) {
      setErreur(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "L’accès au micro est refusé : autorise KLYRA dans les réglages du système (Confidentialité, Micro)."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {/* Le niveau, en 12 pixels qui s'allument : l'esprit pixel du design system. */}
        <div role="meter" aria-label="Niveau du micro" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(niveau * 100)} className="flex h-4 items-end gap-0.5">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "w-1.5 rounded-[1px] transition-colors duration-[80ms]",
                niveau * 12 > i ? (i > 9 ? "bg-orange-k1-500" : "bg-bleu-k1-500") : "bg-fond-surface-grise",
              )}
              style={{ height: `${40 + i * 5}%` }}
            />
          ))}
        </div>
        <Bouton
          variant="blanc"
          taille="compact"
          iconeGauche={<Icon name={ecoute ? "stop-01" : "microphone-01"} size={16} />}
          onClick={() => (ecoute ? arreter.current() : void lancer())}
        >
          {ecoute ? "Arrêter" : "Tester"}
        </Bouton>
      </div>
      {ecoute && <span className="text-ui-2xs text-texte-tertiaire">Parle : la barre suit ta voix (8 s).</span>}
      {erreur && <Erreur>{erreur}</Erreur>}
    </div>
  );
}

const MO = 1_000_000;

/** Le résultat du dernier essai de la clé. */
type Essai = { etat: "en-cours" } | { etat: "ok" } | { etat: "erreur"; message: string };

/** La clé ElevenLabs : essayée auprès d'ElevenLabs, puis chiffrée sur ce poste. Elle ne revient jamais. */
function CleElevenLabs({ pont, etat, onEtat }: { pont: PontDictee; etat: EtatDictee; onEtat: (e: EtatDictee) => void }) {
  const [cle, setCle] = useState("");
  const [essai, setEssai] = useState<Essai | null>(null);

  const enregistrer = async () => {
    setEssai({ etat: "en-cours" });
    const r = await pont.enregistrerCle(cle);
    if (!r.ok) return setEssai({ etat: "erreur", message: r.message });
    setCle("");
    setEssai(null);
    onEtat(r.data);
  };
  const tester = async () => {
    setEssai({ etat: "en-cours" });
    const r = await pont.testerCle();
    setEssai(r.ok ? { etat: "ok" } : { etat: "erreur", message: r.message });
  };
  const retirer = async () => {
    const r = await pont.retirerCle();
    if (r.ok) onEtat(r.data);
    setEssai(null);
  };

  return (
    <>
      {etat.cleElevenLabs ? (
        <Ligne id="cle-elevenlabs" libelle="Clé ElevenLabs" description="Gardée dans le trousseau du système, elle ne revient jamais vers l’écran.">
          {essai?.etat === "ok" && <span className="text-ui-xs text-texte-secondaire">Clé valide</span>}
          <Bouton variant="blanc" taille="compact" disabled={essai?.etat === "en-cours"} onClick={() => void tester()}>
            {essai?.etat === "en-cours" ? "Test…" : "Tester"}
          </Bouton>
          <Bouton variant="discret" taille="compact" onClick={() => void retirer()}>
            Retirer la clé
          </Bouton>
        </Ligne>
      ) : (
        <Ligne
          id="cle-elevenlabs"
          libelle="Clé ElevenLabs"
          description="La dictée la plus rapide : le texte s’écrit pendant que tu parles. Clé à créer dans ton compte elevenlabs.io (Developers > API Keys) ; elle est essayée avant d’être gardée."
          pile
        >
          <form
            className="flex w-full flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void enregistrer();
            }}
          >
            <Input
              size="sm"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={cle}
              onChange={(e) => setCle(e.target.value)}
              className={cn(CHAMP, "klyra-mono min-w-0 flex-1")}
              aria-label="Clé ElevenLabs"
            />
            <Bouton type="submit" variant="sombre" taille="compact" disabled={!cle.trim() || essai?.etat === "en-cours"}>
              {essai?.etat === "en-cours" ? "Vérification…" : "Enregistrer"}
            </Bouton>
          </form>
        </Ligne>
      )}
      {essai?.etat === "erreur" && <Erreur>{essai.message}</Erreur>}
    </>
  );
}

/** Le modèle de Whisper sur l'ordinateur : sans clé, sans connexion, ou en secours. */
function ModeleLocal({ pont, etat, onEtat }: { pont: PontDictee; etat: EtatDictee; onEtat: (e: EtatDictee) => void }) {
  const [pourcent, setPourcent] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(
    () => pont.onProgression((p) => p.etape === "telechargement" && setPourcent(Math.floor((p.recu / Math.max(1, p.total)) * 100))),
    [pont],
  );

  const choisi = etat.modeles.find((m) => m.id === etat.modele);
  const choisir = async (modele: ModeleDictee) => {
    const r = await pont.choisirModele(modele);
    if (r.ok) onEtat(r.data);
  };
  const telecharger = async () => {
    setErreur(null);
    setPourcent(0);
    const r = await pont.telecharger();
    setPourcent(null);
    if (r.ok) onEtat(r.data);
    else setErreur(r.message);
  };
  const statut = choisi?.present
    ? "Téléchargé."
    : pourcent !== null
      ? `Téléchargement · ${pourcent} %`
      : "Se télécharge à la première dictée, une seule fois.";

  return (
    <>
      <Ligne
        id="modele-local"
        libelle={`Modèle sur ${poste.ce}`}
        description={`Rapide : pour un ordinateur sans carte graphique. Précis : plus juste, il lui faut une puce graphique. ${statut}`}
      >
        {!choisi?.present && pourcent === null && (
          <Bouton variant="blanc" taille="compact" onClick={() => void telecharger()}>
            Télécharger
          </Bouton>
        )}
        <ListeDeroulante
          variante="compact"
          libelle="Modèle de la dictée locale"
          value={etat.modele}
          options={etat.modeles.map((m) => ({ value: m.id, label: `${m.nom} · ${Math.round(m.taille / MO)} Mo` }))}
          onChange={(m) => void choisir(m)}
          className="min-w-[150px]"
        />
      </Ligne>
      {erreur && <Erreur>{erreur}</Erreur>}
    </>
  );
}

/**
 * La dictée en direct (`window.klyra.dictee`, electron/dictee.ts) : ElevenLabs
 * avec une clé, le plus rapide ; sinon Whisper sur l'ordinateur, qui sert
 * aussi de secours sans connexion.
 */
function ReglagesVoix() {
  const pont = getBridge()?.dictee;
  const [etat, setEtat] = useState<EtatDictee | null>(null);

  useEffect(() => {
    void pont?.etat().then((r) => r.ok && setEtat(r.data));
  }, [pont]);

  return (
    <Groupe titre="Dictée">
      <Ligne
        id="moteur"
        libelle="Moteur de dictée"
        description={
          etat?.cleElevenLabs
            ? `ElevenLabs Scribe : le texte s’écrit pendant que tu parles. Sans connexion, la dictée passe sur ${poste.ce}.`
            : `Whisper, sur ${poste.ce} : ta voix ne sort pas du poste. Une clé ElevenLabs rend la dictée plus rapide.`
        }
      >
        {pont ? <Valeur>{etat?.cleElevenLabs ? "ElevenLabs · en ligne" : "Whisper · local"}</Valeur> : <SeulementBureau />}
      </Ligne>
      {pont && etat && (
        <>
          <CleElevenLabs pont={pont} etat={etat} onEtat={setEtat} />
          <ModeleLocal pont={pont} etat={etat} onEtat={setEtat} />
        </>
      )}
      <Ligne id="langue-dictee" libelle="Langue" description="La dictée transcrit en français.">
        <Valeur>Français</Valeur>
      </Ligne>
    </Groupe>
  );
}

export function Voix() {
  /* Une fois le micro autorisé, la liste se relit : les noms des micros apparaissent. */
  const [autorise, setAutorise] = useState(0);
  const micros = useMicros(autorise);
  const parDefaut = micros.find((m) => m.deviceId === "default") ?? micros[0];
  const nom = parDefaut?.label.replace(/^Default - |^Par défaut - /, "");

  return (
    <>
      <ReglagesVoix />

      <Groupe titre="Micro">
        <Ligne
          id="micro"
          libelle="Micro utilisé"
          description={
            micros.length > 1
              ? `${micros.length - (micros.some((m) => m.deviceId === "default") ? 1 : 0)} micros branchés. La dictée prend celui choisi dans les réglages Son du système.`
              : "La dictée prend le micro choisi dans les réglages Son du système."
          }
        >
          <Valeur>{nom || (micros.length ? "Micro du système" : "Aucun micro détecté")}</Valeur>
        </Ligne>
        <Ligne id="test-micro" libelle="Tester le micro" description="Vérifie que l’app t’entend avant de dicter. Rien n’est enregistré.">
          <TestMicro onAutorise={() => setAutorise((n) => n + 1)} />
        </Ligne>
      </Groupe>
    </>
  );
}
