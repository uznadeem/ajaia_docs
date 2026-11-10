import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ajaia Docs", template: "%s | Ajaia Docs" },
  description: "A lightweight collaborative document workspace for writing and organizing ideas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
