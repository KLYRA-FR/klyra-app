/* Sans ce fichier, `ctx.auth.getUserIdentity()` renvoie toujours null. */
const configuration = {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};

export default configuration;
