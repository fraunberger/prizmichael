import type { Metadata } from "next";
import { Belleza, Courier_Prime } from "next/font/google";
import "./globals.css";

// Optima is the display face (installed on macOS); Belleza is its stand-in elsewhere
const belleza = Belleza({
  variable: "--font-belleza",
  weight: "400",
  subsets: ["latin"],
});

const courier = Courier_Prime({
  variable: "--font-courier",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prizmichael — Vocal Harmony Engine",
  description: "Sing one voice, hear a choir. Pitch correction, Messina-style harmonies, and a creamy mix.",
};

// Set the saved theme before first paint so there's no flash
const themeScript = `try{var t=localStorage.getItem('prizmichael-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${belleza.variable} ${courier.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full overflow-y-hidden overflow-x-auto">{children}</body>
    </html>
  );
}
