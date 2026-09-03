import { redirect } from "next/navigation";

/** Legacy creation alias. Studio creation is available from the Workspace shell. */
export default function StudioRedirect(): never {
  redirect("/workspace");
}
