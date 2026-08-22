import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://access-ramp-navigator.awakenedaphid.chatgpt.site"),
  title: "AccessRamp Navigator",
  description: "Detailed building accessibility profiles covering entrances, ramps, toilets, lifts, parking, routes and community reports.",
  openGraph: {
    title: "AccessRamp Navigator",
    description: "Know the entrance, ramp, toilet, lift and route before you arrive.",
    url: "https://access-ramp-navigator.awakenedaphid.chatgpt.site",
    siteName: "AccessRamp Navigator",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AccessRamp Navigator accessible navigation map" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AccessRamp Navigator",
    description: "Know the entrance, ramp, toilet, lift and route before you arrive.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
