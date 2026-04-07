import { redirect } from "next/navigation";

export default function ConfigPage() {
  redirect("/?settings=1&settingsTab=devices");
}
