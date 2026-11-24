import { ogImage } from "@/marketing/lib/og";

export const alt = "Data deletion | Mellox AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return ogImage({
    title: "Data deletion",
    subtitle: "Remove Mellox's access and delete your data.",
    eyebrow: "Legal",
  });
}
