"use client";
// Settings: one page for everything that drives the dealership's automated messages (client, 8 Oct 2026 meeting:
// "put it all under one" - no separate AI Settings, Followup Setting and Reminder Setting pages). Dealers see it
// view-only; only an AutoPulse super admin edits it (signed in inside the dealer account), and the server refuses
// any other save (app/lib/apiAuth.js loadSettingsEditor).
//   /dealer/settings?tab=followups | reminders | ai

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Nav } from "react-bootstrap";
import FollowupSettings from "./components/FollowupSettings";
import ReminderSettings from "./components/ReminderSettings";
import AiSettings from "./components/AiSettings";
import { canEditDealerSettings } from "./settingsAccess";

const TABS = [
  ["followups", "Follow-ups", FollowupSettings],
  ["reminders", "Appointment reminders", ReminderSettings],
  ["ai", "AI", AiSettings],
];

function SettingsTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = TABS.some(([id]) => id === params.get("tab")) ? params.get("tab") : "followups";
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => setCanEdit(canEditDealerSettings()), []);
  const Current = TABS.find(([id]) => id === tab)[2];

  return (
    <div className="page_content">
      <div className="page_head">
        <h3 className="page_title mb-0">Settings</h3>
      </div>
      <div className="page_body">
        {!canEdit && (
          <Alert variant="info" className="small">
            <i className="fa-regular fa-lock me-2"></i>
            These settings are managed by AutoPulse. You can view them here (and turn the AI on or off in the AI
            tab); contact us to change anything else.
          </Alert>
        )}
        <Nav variant="tabs" activeKey={tab} className="mb-3"
          onSelect={(key) => router.replace(`/dealer/settings?tab=${key}`)}>
          {TABS.map(([id, label]) => (
            <Nav.Item key={id}><Nav.Link eventKey={id}>{label}</Nav.Link></Nav.Item>
          ))}
        </Nav>
        {/* A disabled fieldset greys out and blocks every input and button inside for a dealer. */}
        {/* The AI tab decides itself what a dealer may change (the On/Off switch, client 9 Oct 2026). */}
        <fieldset disabled={!canEdit && tab !== "ai"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Current />
        </fieldset>
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the production build.
export default function SettingsPage() {
  return <Suspense fallback={null}><SettingsTabs /></Suspense>;
}
