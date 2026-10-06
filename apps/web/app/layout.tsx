import type { Metadata, Viewport } from "next";
import { Funnel_Display, Geist_Mono } from "next/font/google";
import "./globals.css";

const display = Funnel_Display({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "Free, open source database client for VS Code and Cursor. PostgreSQL, MySQL, ClickHouse, MongoDB, Redis, Elasticsearch, S3 and Docker. No account, no paywall, no telemetry.";

export const metadata: Metadata = {
  metadataBase: new URL("https://dbdeck.dev"),
  title: "DBDeck — your databases, inside your editor",
  description,
  openGraph: {
    title: "DBDeck — your databases, inside your editor",
    description,
    url: "https://dbdeck.dev",
    siteName: "DBDeck",
    images: [{ url: "/og.png", width: 2400, height: 1260, alt: "DBDeck — your databases, inside your editor" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#0d1220", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
