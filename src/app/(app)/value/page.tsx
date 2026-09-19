import { redirect } from "next/navigation";

export default function ValueRedirect() {
  redirect("/picks?tab=value");
}
