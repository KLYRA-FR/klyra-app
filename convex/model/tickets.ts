/** La révision d'un ticket copié (JSON) ; 0 s'il n'en a pas encore. */
export function revisionTicket(ticket: string | null | undefined): number {
  if (!ticket) return 0;
  try {
    const r = (JSON.parse(ticket) as { revision?: unknown }).revision;
    return typeof r === "number" ? r : 0;
  } catch {
    return 0;
  }
}
