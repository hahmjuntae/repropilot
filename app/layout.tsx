import type { Metadata } from "next";
import "./ds/ds.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReproPilot",
  description: "Turn a bug report into an execution-verified failing test and a patch. NVIDIA Nemotron on Nebius Token Factory.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
