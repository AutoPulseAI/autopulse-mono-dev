// The reports are tabs on the Dashboard now (SOW 8B: enhance the existing dashboard). Old links and bookmarks land on
// the first report tab; anyone who can't see the report tabs gets the Dashboard as usual.
import { redirect } from "next/navigation";

export default function ReportsRedirect() {
  redirect("/dealer/dashboard?tab=executive");
}
