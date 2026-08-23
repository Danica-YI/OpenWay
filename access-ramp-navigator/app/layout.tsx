import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

/** Replace with the real origin when this is deployed somewhere. */
const SITE_URL = "https://openway.example.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "OpenWay",
  description: "Detailed building accessibility profiles covering entrances, ramps, toilets, lifts, parking, routes and community reports.",
  other: { "codex-preview": "development" },
  openGraph: {
    title: "OpenWay",
    description: "Know the entrance, ramp, toilet, lift and route before you arrive.",
    url: SITE_URL,
    siteName: "OpenWay",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "OpenWay — find the accessible way in" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenWay",
    description: "Know the entrance, ramp, toilet, lift and route before you arrive.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
