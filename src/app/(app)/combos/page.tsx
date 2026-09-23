import { redirect } from "next/navigation";

export default function CombosRedirect() {
  redirect("/picks?tab=combos");
}
