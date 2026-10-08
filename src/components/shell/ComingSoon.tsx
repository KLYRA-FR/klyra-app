import { EmptyState } from "klyra-ui";

/** Écran pas encore intégré : la navigation fonctionne déjà partout. */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <EmptyState title={title} description={description} className="max-w-[520px]" />
    </div>
  );
}
