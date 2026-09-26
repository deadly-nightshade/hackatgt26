import { redirect } from "next/navigation";

/** The island (/world) is home; it sends fish without an identity to onboarding. */
export default function Home() {
  redirect("/world");
}
