"use client";

import { useEffect, useRef } from "react";
import { contenuHomepage } from "./contenu";
import { initialiserHomepage } from "./initialiser";
import "./homepage.css";

/** Le contenu est exporté en HTML ; seul le moteur de la démo est client. */
export function Homepage() {
  const racine = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = racine.current;
    if (!element) return;
    const nettoyer = initialiserHomepage(element);
    return () => {
      nettoyer();
      element.innerHTML = contenuHomepage;
      element.classList.add("statique");
      delete element.dataset.pret;
    };
  }, []);

  return (
    <div
      ref={racine}
      className="klyra-homepage statique"
      dangerouslySetInnerHTML={{ __html: contenuHomepage }}
    />
  );
}
