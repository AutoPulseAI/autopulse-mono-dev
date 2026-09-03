"use client";
import ReportCronServiceControl from "./components/ReportCronServiceControl";

export default function CronPage() {

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">Report Cron Service</h3>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {/* Report Cron Service Control */}
        <div className="w_card">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <div className="col col-12">
              <ReportCronServiceControl />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}