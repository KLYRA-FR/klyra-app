import type { Reponse } from "@/lib/bridge";

type Marquer = (filId: string, status: string, controle: string | null) => Promise<Reponse<{ ok: boolean; motif?: string }>>;

/**
 * Rend la place d'un fil archivé ou supprimé depuis l'interface : son travail passe « annulé » dans le journal
 * super-agent, ce qui libère son occupation. Un refus (`operations_a_verifier`, travail déjà clos…) ne bloque
 * jamais la fermeture côté écran : la place reste alors tenue et le motif est rendu.
 */
export async function libererPlaceFil(marquer: Marquer | undefined, filId: string): Promise<{ libere: boolean; motif?: string }> {
  if (!marquer) return { libere: false, motif: "journal_absent" };
  try {
    const reponse = await marquer(filId, "cancelled", null);
    if (!reponse.ok) return { libere: false, motif: reponse.code };
    if (reponse.data.ok === false) return { libere: false, motif: reponse.data.motif ?? "refus" };
    return { libere: true };
  } catch {
    return { libere: false, motif: "ipc" };
  }
}
