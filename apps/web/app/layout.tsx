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
  "Free, open source database client for VS Code and Cursor. PostgreSQL, MySQL, ClickHouse, BigQuery, Snowflake, MongoDB, Redis, Elasticsearch, S3 and Docker. No account, no paywall, no telemetry.";
const title = "DBDeck — Free database client for VS Code and Cursor";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://dbdeck.dev/#website",
      url: "https://dbdeck.dev/",
      name: "DBDeck",
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://dbdeck.dev/#software",
      name: "DBDeck",
      url: "https://dbdeck.dev/",
      description,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Windows, macOS, Linux",
      softwareRequirements: "Visual Studio Code or Cursor",
      license: "https://github.com/jurasw/dbdeck/blob/main/LICENSE",
      downloadUrl: "https://marketplace.visualstudio.com/items?itemName=dbdeck.dbdeck",
      image: "https://dbdeck.dev/og.png",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      sameAs: [
        "https://github.com/jurasw/dbdeck",
        "https://marketplace.visualstudio.com/items?itemName=dbdeck.dbdeck",
        "https://open-vsx.org/extension/dbdeck/dbdeck",
      ],
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://dbdeck.dev"),
  title,
  description,
  alternates: { canonical: "https://dbdeck.dev/" },
  openGraph: {
    title,
    description,
    url: "https://dbdeck.dev",
    siteName: "DBDeck",
    images: [{ url: "/og.png", width: 2400, height: 1260, alt: "DBDeck — your databases, inside your editor" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#0d1220", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}
