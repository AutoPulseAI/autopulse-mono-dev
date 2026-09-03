"use client";

import { useState, useEffect } from "react";
import { formatTimestamp } from "@utils/dateUtils";

export default function CampaignReportModal({ campaignId, isOpen, onClose, dealerTimezone }) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (isOpen && campaignId) {
      fetchReport();
    }
  }, [isOpen, campaignId]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('dealertoken');
      const response = await fetch(`/api/campaigns/${campaignId}/report`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch report");
      }

      setReport(data.report);
    } catch (err) {
      console.error("Error fetching campaign report:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const timezone = dealerTimezone || report?.campaign?.dealer?.timezone || "America/New_York";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Campaign Report</h2>
            {report && (
              <p className="text-sm text-gray-600 mt-1">{report.campaign.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-gray-600">Loading report...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {report && (
            <>
              {/* Tabs */}
              <div className="flex border-b mb-6">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`px-6 py-3 font-medium ${
                    activeTab === "overview"
                      ? "border-b-2 border-blue-600 text-blue-600"
                      : "text-gray-600 hover:text-gray-800"
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab("engagement")}
                  className={`px-6 py-3 font-medium ${
                    activeTab === "engagement"
                      ? "border-b-2 border-blue-600 text-blue-600"
                      : "text-gray-600 hover:text-gray-800"
                  }`}
                >
                  Engagement
                </button>
                {report.campaign.message_type === "email" && (
                  <button
                    onClick={() => setActiveTab("links")}
                    className={`px-6 py-3 font-medium ${
                      activeTab === "links"
                        ? "border-b-2 border-blue-600 text-blue-600"
                        : "text-gray-600 hover:text-gray-800"
                    }`}
                  >
                    Top Links
                  </button>
                )}
              </div>

              {/* Overview Tab */}
              {activeTab === "overview" && (
                <div>
                  {/* Campaign Info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Status</p>
                      <p className="text-lg font-semibold capitalize">
                        {report.campaign.status}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Campaign ID</p>
                      <p className="text-sm font-mono text-gray-800">
                        {report.campaign.id.slice(-8)}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Type</p>
                      <p className="text-lg font-semibold uppercase">
                        {report.campaign.message_type}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Created By</p>
                      <p className="text-sm font-medium text-gray-800">
                        {report.campaign.created_by?.name || "Unknown"}
                      </p>
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <p className="text-sm text-blue-600 mb-1">Created At</p>
                      <p className="text-sm font-medium text-gray-800">
                        {formatTimestamp(report.campaign.created_at, timezone)}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <p className="text-sm text-blue-600 mb-1">Updated At</p>
                      <p className="text-sm font-medium text-gray-800">
                        {formatTimestamp(report.campaign.updated_at, timezone)}
                      </p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <p className="text-sm text-green-600 mb-1">Send Date & Time</p>
                      <p className="text-sm font-medium text-gray-800">
                        {report.campaign.actual_scheduled_date
                          ? formatTimestamp(report.campaign.actual_scheduled_date, timezone)
                          : "Not scheduled"}
                      </p>
                    </div>
                  </div>

                  {/* Key Metrics */}
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Key Metrics</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Processed</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {report.stats.processed}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        / {report.stats.total_leads} total
                      </p>
                    </div>
                    <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Delivered</p>
                      <p className="text-3xl font-bold text-green-600">
                        {report.stats.delivered}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {report.stats.delivery_rate}% delivery rate
                      </p>
                    </div>
                    {report.campaign.message_type === "email" && (
                      <>
                        <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg">
                          <p className="text-sm text-gray-600 mb-1">Unique Opens</p>
                          <p className="text-3xl font-bold text-purple-600">
                            {report.stats.unique_opens}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {report.stats.open_rate}% open rate
                          </p>
                        </div>
                        <div className="bg-orange-50 border border-orange-200 p-4 rounded-lg">
                          <p className="text-sm text-gray-600 mb-1">Unique Clicks</p>
                          <p className="text-3xl font-bold text-orange-600">
                            {report.stats.unique_clicks}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {report.stats.click_rate}% click rate
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Secondary Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-red-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Bounce Rate</p>
                      <p className="text-2xl font-bold text-red-600">
                        {report.stats.bounce_rate}%
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {report.stats.bounced} bounced
                      </p>
                    </div>
                    {report.campaign.message_type === "email" && (
                      <div className="bg-yellow-50 p-4 rounded-lg">
                        <p className="text-sm text-gray-600 mb-1">Unsubscribed</p>
                        <p className="text-2xl font-bold text-yellow-600">
                          {report.stats.unsubscribed}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {report.stats.unsubscribe_rate}% rate
                        </p>
                      </div>
                    )}
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Failed</p>
                      <p className="text-2xl font-bold text-gray-600">
                        {report.stats.failed}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">Pending</p>
                      <p className="text-2xl font-bold text-gray-600">
                        {report.stats.pending}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Engagement Tab */}
              {activeTab === "engagement" && report.campaign.message_type === "email" && (
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Engagement Metrics</h3>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-purple-50 border-2 border-purple-200 p-6 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-sm text-gray-600">Total Opens</p>
                        <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded">
                          Email
                        </span>
                      </div>
                      <p className="text-4xl font-bold text-purple-600 mb-1">
                        {report.stats.total_opens}
                      </p>
                      <p className="text-sm text-gray-600">
                        {report.stats.unique_opens} unique
                      </p>
                    </div>

                    <div className="bg-orange-50 border-2 border-orange-200 p-6 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-sm text-gray-600">Total Clicks</p>
                        <span className="bg-orange-600 text-white text-xs px-2 py-1 rounded">
                          Email
                        </span>
                      </div>
                      <p className="text-4xl font-bold text-orange-600 mb-1">
                        {report.stats.total_clicks}
                      </p>
                      <p className="text-sm text-gray-600">
                        {report.stats.unique_clicks} unique
                      </p>
                    </div>

                    <div className="bg-blue-50 border-2 border-blue-200 p-6 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-sm text-gray-600">Click-to-Open Rate</p>
                        <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded">
                          Rate
                        </span>
                      </div>
                      <p className="text-4xl font-bold text-blue-600 mb-1">
                        {report.stats.click_to_open_rate}%
                      </p>
                      <p className="text-sm text-gray-600">
                        of openers clicked
                      </p>
                    </div>
                  </div>

                  {/* Tracking Breakdown */}
                  {report.tracking_breakdown && report.tracking_breakdown.length > 0 && (
                    <div>
                      <h4 className="text-md font-bold text-gray-800 mb-3">Event Breakdown</h4>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 text-sm font-semibold text-gray-700">Event Type</th>
                              <th className="text-right py-2 text-sm font-semibold text-gray-700">Total Events</th>
                              <th className="text-right py-2 text-sm font-semibold text-gray-700">Unique Leads</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.tracking_breakdown.map((item, idx) => (
                              <tr key={idx} className="border-b last:border-0">
                                <td className="py-2 capitalize">{item.event_type}</td>
                                <td className="py-2 text-right font-medium">{item.total_events}</td>
                                <td className="py-2 text-right font-medium">{item.unique_leads}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Top Links Tab */}
              {activeTab === "links" && report.top_links && report.top_links.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Top Clicked Links</h3>
                  <div className="space-y-3">
                    {report.top_links.map((link, idx) => (
                      <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-sm font-medium text-gray-800 break-all flex-1 mr-4">
                            {link.url || "N/A"}
                          </p>
                          <div className="flex gap-4">
                            <div className="text-right">
                              <p className="text-2xl font-bold text-orange-600">
                                {link.total_clicks}
                              </p>
                              <p className="text-xs text-gray-600">Total Clicks</p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-purple-600">
                                {link.unique_clicks}
                              </p>
                              <p className="text-xs text-gray-600">Unique</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "links" && report.campaign.message_type !== "email" && (
                <div className="text-center py-8 text-gray-500">
                  <p>Link tracking is only available for email campaigns</p>
                </div>
              )}

              {activeTab === "links" && report.campaign.message_type === "email" && (!report.top_links || report.top_links.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  <p>No link clicks recorded yet</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
