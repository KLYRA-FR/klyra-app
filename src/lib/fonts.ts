import localFont from "next/font/local";

/** Google Sans Flex, servie depuis klyra-ui (licence réservée à KLYRA). */
export const googleSansFlex = localFont({
  src: [
    { path: "../../node_modules/klyra-ui/public/fonts/GoogleSansFlex_24pt-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../node_modules/klyra-ui/public/fonts/GoogleSansFlex_24pt-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../node_modules/klyra-ui/public/fonts/GoogleSansFlex_24pt-SemiBold.ttf", weight: "600", style: "normal" },
  ],
  variable: "--font-google-sans-flex",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
