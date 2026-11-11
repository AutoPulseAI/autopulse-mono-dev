// The reports are sections of the Dashboard now (11 Nov 2026; SOW 8B: enhance the existing dashboard). Old links and
// bookmarks land on the Dashboard; anyone who can't see the reports gets the Dashboard as usual.
import { redirect } from "next/navigation";

export default function ReportsRedirect() {
  redirect("/dealer/dashboard");
}
