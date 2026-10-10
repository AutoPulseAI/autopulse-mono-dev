// Reminder Setting now lives in the one Settings page (client, 8 Oct 2026 meeting).
import { redirect } from "next/navigation";

export default function ReminderSettingsRedirect() {
  redirect("/dealer/settings?tab=reminders");
}
