/** Chargeur : un import relatif sans extension retombe sur le fichier `.ts`. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await nextResolve(specifier, context);
    } catch (erreur) {
      if (erreur?.code !== "ERR_MODULE_NOT_FOUND") throw erreur;
      return nextResolve(`${specifier}.ts`, context);
    }
  }
  return nextResolve(specifier, context);
}
