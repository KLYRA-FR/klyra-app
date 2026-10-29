"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { Erreur, Groupe, Ligne, Valeur } from "../ui";

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

/**
 * Les réglages de la dictée elle-même. Place réservée à la dictée en direct de
 * Hugo (moteur ElevenLabs ou local, clé, langue, choix du micro, modèle local,
 * via `window.klyra.dictee`) : ses champs remplacent ces deux lignes, qui
 * décrivent la dictée d'aujourd'hui. Garder les ancres `moteur` et
 * `langue-dictee` (catalogue.ts) ; le choix du micro reprend l'id `micro`.
 */
function ReglagesVoix() {
  return (
    <Groupe titre="Dictée">
      <Ligne id="moteur" libelle="Moteur de dictée" description="Whisper, sur cet ordinateur : ta voix ne sort pas du poste.">
        <Valeur>Whisper · local</Valeur>
      </Ligne>
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
