// Runs once each time the CRM server starts - every deploy (Next.js instrumentation hook).
//
// The user, 3 Nov 2026 ("why is AI Studio behind - our AI must be in AI Studio"): AI Studio's built-in settings
// (app/lib/ai/aiStudioDefaults.json, the AI's own rules) used to reach the published copy only when someone opened the
// AI Studio page, so after a deploy the AI ran on the previous version until then. They are brought up to date here,
// at start, so the AI follows the new rules as soon as it is deployed. Edits made in AI Studio are kept
// (seedDefaults only adds, upgrades untouched built-ins and aligns, as when the page opens).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { default: dbConnect } = await import('./app/lib/mongodb');
    const { seedDefaults } = await import('./app/lib/ai/aiStudio');
    await dbConnect();
    await seedDefaults({ by: 'AutoPulse (deploy)' });
    console.log('[ai-studio] built-in settings brought up to date at start');
  } catch (error) {
    // Never stops the CRM from starting: the AI Studio page still brings them up to date when opened.
    console.error('[ai-studio] could not bring the built-in settings up to date at start', error?.message);
  }
}
