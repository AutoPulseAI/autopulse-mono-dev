// RETIRED (P1 plan item 6, Nov 2026). This was an in-memory loop that sent every pending ReportSchedule row
// (app/utils/reportScheduler.js -> app/lib/reportGenerator.js) - with no retry, no duplicate protection and a wrong
// report window; starting it would have emailed every dealer's backlog at once.
//
// The daily dealer email now runs in the BullMQ worker (app/lib/reports/dailyReport.js), is off for every dealer
// until a super admin switches it on (Admin > Report Cron Service > Daily performance email), and keeps a delivery
// log. This object keeps its old methods so the admin page and /api/cron/report-service still answer, but none of
// them checks, sends or schedules anything. Weekly/monthly schedules saved by dealers are left as they are.

export const LEGACY_REPORTS_DISABLED_MESSAGE = 'The old report sender is retired and sends nothing. Daily dealer '
  + 'emails now run in the background worker: Admin > Report Cron Service > Daily performance email '
  + '(/api/admin/daily-report).';

class ReportCronService {
  constructor() {
    this.isRunning = false;
    this.disabled = true;
  }

  start() {
    console.log(`[report-cron] start ignored: ${LEGACY_REPORTS_DISABLED_MESSAGE}`);
    return { started: false, message: LEGACY_REPORTS_DISABLED_MESSAGE };
  }

  stop() {
    return { stopped: true, message: LEGACY_REPORTS_DISABLED_MESSAGE };
  }

  async checkAndProcessReports() {
    return { processed: 0, message: LEGACY_REPORTS_DISABLED_MESSAGE };
  }

  getStatus() {
    return { isRunning: false, disabled: true, checkInterval: null, lastCheck: null,
      message: LEGACY_REPORTS_DISABLED_MESSAGE };
  }

  async manualCheck() {
    return this.checkAndProcessReports();
  }

  async processOverdueReports() {
    return this.checkAndProcessReports();
  }
}

const reportCronService = new ReportCronService();

export default reportCronService;
