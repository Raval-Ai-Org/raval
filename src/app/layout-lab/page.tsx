import { notFound } from "next/navigation";
import { LayoutLab } from "./LayoutLab";

export const metadata = {
  title: "Popup layout lab",
  robots: { index: false, follow: false },
};

/** Real popup components for deterministic layout fixtures; never served in production. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LayoutLab />;
}
