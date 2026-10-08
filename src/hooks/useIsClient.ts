import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` pendant le pré-rendu du build, `true` une fois l'app ouverte.
 * Les données (et leurs dates) n'existent qu'à l'ouverture : on évite ainsi
 * tout écart entre le HTML du build et le premier rendu.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
