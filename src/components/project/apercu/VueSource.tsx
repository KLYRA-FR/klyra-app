/** Le texte brut avec ses numéros de ligne, comme l'aperçu de VS Code (vue « Source »). */
export function VueSource({ texte }: { texte: string }) {
  const lignes = texte.split("\n");
  return (
    <table data-vue="source" className="klyra-mono w-full border-collapse text-ui-xs leading-[1.6]">
      <tbody>
        {lignes.map((ligne, i) => (
          <tr key={i}>
            <td className="w-12 pr-3 pl-4 text-right align-top text-texte-tertiaire select-none">{i + 1}</td>
            <td className="pr-4 whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere]">{ligne || " "}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
