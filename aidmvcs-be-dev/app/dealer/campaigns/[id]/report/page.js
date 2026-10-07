"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Badge, Spinner, Alert, Row, Col, Nav, Tab, Form, Table, InputGroup, ListGroup } from "react-bootstrap";
import { formatTimestamp } from "@utils/dateUtils";
import { useUser } from "../../../context/UserContext";
import CountCard from "./components/CountCard";

export default function CampaignReportPage() {
  const router = useRouter();
  const params = useParams();
  const { dealerParent, user } = useUser();
  const activeEntity = dealerParent || user;
  
  const campaignId = params.id;
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [dealerTimezone, setDealerTimezone] = useState("America/New_York");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (campaignId) {
      fetchReport();
      fetchDealerTimezone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const fetchDealerTimezone = async () => {
    if (activeEntity?.id) {
      try {
        const res = await fetch(`/api/test/timezone-reminders?dealerId=${activeEntity.id}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        });
        const data = await res.json();
        if (res.ok && data.dealer?.timezone) {
          setDealerTimezone(data.dealer.timezone);
        }
      } catch (err) {
        console.error("Error fetching dealer timezone:", err);
      }
    }
  };

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

  const timezone = dealerTimezone || report?.campaign?.dealer?.timezone || "America/New_York";

  const getStatusVariant = (status) => {
    const statusMap = {
      draft: "secondary",
      scheduled: "custom",
      active: "success",
      completed: "info",
      cancelled: "danger"
    };
    return statusMap[status] || "secondary";
  };

  const getLeadStatusVariant = (status) => {
    const statusMap = {
      pending: "secondary",
      held: "warning",
      blocked: "dark",
      sent: "info",
      delivered: "success",
      failed: "danger",
      bounced: "warning"
    };
    return statusMap[status] || "secondary";
  };

  const exportLeadsToCSV = () => {
    try {
      if (!filteredLeads || filteredLeads.length === 0) {
        alert("No leads to export");
        return;
      }

      // Prepare CSV data
      const csvData = filteredLeads.map(lead => {
        const row = {
          Name: lead.name || 'N/A',
          Email: lead.email || 'N/A',
          Phone: lead.phone || 'N/A',
          'Lead Type': lead.is_system_lead ? 'System Lead' : 'Outside Lead',
          'Lead ID': lead.lead_id || 'N/A',
          Status: lead.status || 'N/A',
          'Sent At': lead.sent_at ? formatTimestamp(lead.sent_at, timezone) : 'N/A',
        };

        // Add email-specific fields
        if (report.campaign.message_type === "email") {
          row['Opened'] = lead.opened ? 'Yes' : 'No';
          row['Opened At'] = lead.opened_at ? formatTimestamp(lead.opened_at, timezone) : 'N/A';
          row['Open Count'] = lead.open_count || 0;
          row['Clicked'] = lead.clicked ? 'Yes' : 'No';
          row['Clicked At'] = lead.clicked_at ? formatTimestamp(lead.clicked_at, timezone) : 'N/A';
          row['Click Count'] = lead.click_count || 0;
        }

        row['Unsubscribed'] = lead.unsubscribed ? 'Yes' : 'No';
        row['Unsubscribed At'] = lead.unsubscribed_at ? formatTimestamp(lead.unsubscribed_at, timezone) : 'N/A';
        
        if (lead.error_message) {
          row['Error Message'] = lead.error_message;
        }
        // The send check: when a held text goes out, and why a text was held or blocked
        row['Held Until'] = lead.status === 'held' && lead.held_until ? formatTimestamp(lead.held_until, timezone) : '';
        row['Held / Blocked Reason'] = ['held', 'blocked'].includes(lead.status) ? (lead.block_reason || '') : '';

        return row;
      });

      // Convert to CSV format
      const csvHeaders = Object.keys(csvData[0] || {}).join(',');
      const csvRows = csvData.map(row => 
        Object.values(row).map(field => 
          `"${String(field).replace(/"/g, '""')}"`
        ).join(',')
      ).join('\n');

      const csvContent = [csvHeaders, csvRows].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      
      // Generate filename with campaign name and date
      const campaignName = report.campaign.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const dateStr = new Date().toISOString().split('T')[0];
      link.download = `campaign_${campaignName}_leads_${dateStr}.csv`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export leads. Please try again.");
    }
  };

  // Filter and search leads
  const filteredLeads = useMemo(() => {
    if (!report?.leads) return [];
    
    let filtered = report.leads;
    
    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter(lead => lead.status === statusFilter);
    }
    
    // Search by name, email, or phone
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(lead => 
        lead.name?.toLowerCase().includes(query) ||
        lead.email?.toLowerCase().includes(query) ||
        lead.phone?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [report?.leads, statusFilter, searchQuery]);

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center w-100">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => router.back()}
                  className="me-2"
                >
                  <i className="fa-solid fa-arrow-left"></i>
                </Button>
                <h3 className="page_title mb-0">Campaign Report</h3>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">      

        {loading && (
          <div className="loader_in_main text-center flex-column">
          <div className="spinner-border text-dark" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mb-0 mt-3">Loading campaign report...</p>
        </div>
        )}

        {error && (
          <Alert variant="danger" className="mb-4">
            <Alert.Heading>Error Loading Report</Alert.Heading>
            <p>{error}</p>
            <Button variant="outline-danger" size="sm" onClick={fetchReport}>
              Retry
            </Button>
          </Alert>
        )}

        {report && (
          <>
          {/* Campaign Information */}
          <div className="w_card compaign_info">
            <div className="position-relative d-flex align-items-center mb-1">
              {report && (
                <h3 className="w_card_title text-custom mb-0">{report.campaign.name}</h3>
              )}
              {report && (
                <Badge bg={getStatusVariant(report.campaign.status)} className="ms-auto">
                  {report.campaign.status.toUpperCase()}
                </Badge>
              )}
            </div>

            <Row className="gx-3 mt-2">
              <Col xxl={2} md={3}>
                <p className="mb-xxl-0 border-md-end">
                  <small className='text-secondary-light d-md-block mb-md-1'><i className="fa-regular fa-hashtag me-1"></i>Campaign ID:</small>
                  {report.campaign.id}
                </p>
              </Col>
              <Col xxl={2} md={3}>
                <p className="mb-xxl-0 border-md-end">
                  <small className='text-secondary-light d-md-block mb-md-1'><i className="fa-regular fa-envelope me-1"></i>Message Type:</small>
                  {report.campaign.message_type}
                </p>
              </Col>
              <Col xxl={2} md={3}>
                <p className="mb-xxl-0 border-md-end">
                  <small className='text-secondary-light d-md-block mb-md-1'><i className="fa-regular fa-user me-1"></i>Created By:</small>
                  {report.campaign.created_by?.name || "Unknown"}
                </p>
              </Col>
              <Col xxl={2} md={3}>
                <p className="mb-xxl-0 border-md-end">
                  <small className='text-secondary-light d-md-block mb-md-1'><i className="fa-regular fa-calendar-plus me-1"></i>Created At:</small>
                  {formatTimestamp(report.campaign.created_at, timezone)}
                </p>
              </Col>
              <Col xxl={2} md={3}>
                <p className="mb-xxl-0 border-md-end">
                  <small className='text-secondary-light d-md-block mb-md-1'><i className="fa-regular fa-sync me-1"></i>Updated At:</small>
                  {formatTimestamp(report.campaign.updated_at, timezone)}
                </p>
              </Col>
              <Col xxl={2} md={3}>
                <p className="mb-md-0">
                  <small className='text-secondary-light d-md-block mb-md-1'><i className="fa-regular fa-paper-plane me-1"></i>Send Date & Time:</small>
                  {report.campaign.actual_scheduled_date
                  ? formatTimestamp(report.campaign.actual_scheduled_date, timezone)
                  : report.campaign.scheduled_date
                  ? formatTimestamp(report.campaign.scheduled_date, timezone)
                  : "Not scheduled"}
                </p>
              </Col>
            </Row>

          </div>

            <Tab.Container activeKey={activeTab} onSelect={(k) => setActiveTab(k)}>
              <Nav variant="pills" className="mb-2">
                <Nav.Item>
                  <Nav.Link eventKey="overview">
                    <i className="fa-solid fa-chart-bar me-2"></i>Overview
                  </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="engagement">
                    <i className="fa-solid fa-chart-line me-2"></i>Engagement
                  </Nav.Link>
                </Nav.Item>
                {report.campaign.message_type === "email" && (
                  <Nav.Item>
                    <Nav.Link eventKey="links">
                      <i className="fa-solid fa-link me-2"></i>Top Links
                    </Nav.Link>
                  </Nav.Item>
                )}
                <Nav.Item>
                  <Nav.Link eventKey="leads">
                    <i className="fa-solid fa-users me-2"></i>Reach
                    {report?.leads && (
                      <Badge className="ms-2">{report.leads.length}</Badge>
                    )}
                  </Nav.Link>
                </Nav.Item>
              </Nav>

              <div className="w_card">
                  <Tab.Content>
                    {/* Overview Tab */}
                    <Tab.Pane eventKey="overview">
                      <div>                       
                        <h3 className="w_card_title">Overview</h3>
                        <div className="position-relative">
                          <Row className="gx-xxl-3 gx-2">
                            <Col lg={3} md={6} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-check-circle"
                                count={report.stats.processed || 0}
                                label="Processed"
                                description={`${report.stats.processed || 0} of ${report.stats.total_leads} total`}
                                showProgress
                                progressValue={report.stats.processed || 0}
                                progressTotal={report.stats.total_leads}
                              />
                            </Col>
                            <Col lg={3} md={6} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-check-double"
                                count={report.stats.delivered || 0}
                                label="Delivered"
                                description={`${report.stats.delivered || 0} of ${report.stats.sent} sent`}
                                showProgress
                                progressValue={report.stats.delivered || 0}
                                progressTotal={report.stats.sent}
                              />
                            </Col>
                            <Col lg={3} md={6} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-clock"
                                count={report.stats.pending || 0}
                                label="Pending"
                                description={`${report.stats.pending || 0} of ${report.stats.total_leads} total`}
                                showProgress
                                progressValue={report.stats.pending || 0}
                                progressTotal={report.stats.total_leads}
                              />
                            </Col>
                            <Col lg={3} md={6} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-times-circle"
                                count={report.stats.failed || 0}
                                label="Failed"
                                description={`${report.stats.failed || 0} of ${report.stats.total_leads} total`}
                                showProgress
                                progressValue={report.stats.pending || 0}
                                progressTotal={report.stats.total_leads}
                              />
                            </Col>
                            <Col lg={3} md={6} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-hourglass-half"
                                count={report.stats.held || 0}
                                label="Held until…"
                                description={`${report.stats.held || 0} waiting for an allowed time`}
                                showProgress
                                progressValue={report.stats.held || 0}
                                progressTotal={report.stats.total_leads}
                              />
                            </Col>
                            <Col lg={3} md={6} xs={6}>
                              <CountCard
                                iconClass="fa-solid fa-ban"
                                count={report.stats.blocked || 0}
                                label="Blocked"
                                description={`${report.stats.blocked || 0} stopped by the send check`}
                                showProgress
                                progressValue={report.stats.blocked || 0}
                                progressTotal={report.stats.total_leads}
                              />
                            </Col>
                          </Row>
                        </div>

                        {/* Secondary Metrics */}
                        {report.campaign.message_type === "email" && (
                          <div>
                            <Row className="gx-xxl-3 gx-2">
                              <Col lg={20} md={4} xs={6}>
                                <CountCard
                                  iconClass="fa-regular fa-envelope-open"
                                  count={report.stats.total_opens || 0}
                                  label="Open"
                                  description={`of ${report.stats.delivered} delivered`}
                                />
                              </Col>
                              <Col lg={20} md={4} xs={6}>
                                <CountCard
                                  iconClass="fa-regular fa-envelope-open-text"
                                  count={report.stats.unique_opens || 0}
                                  label="Unique Opens"
                                  description={`${report.stats.open_rate} % open rate`}
                                />
                              </Col>
                              <Col lg={20} md={4} xs={6}>
                                <CountCard
                                  iconClass="fa-regular fa-mouse-pointer"
                                  count={report.stats.unique_clicks || 0}
                                  label="Unique Clicks"
                                  description={`${report.stats.click_through_rate} % click rate`}
                                />
                              </Col>
                              <Col lg={20} md={4} xs={6}>
                                <CountCard
                                  iconClass="fa-regular fa-exclamation-triangle"
                                  count={`${report.stats.bounce_rate || 0}%`}
                                  label="Bounce Rate"
                                  description={`${report.stats.bounced} bounced`}
                                />
                              </Col>
                              <Col lg={20} md={4} xs={6}>
                                <CountCard
                                  iconClass="fa-regular fa-ban"
                                  count={report.stats.unsubscribed}
                                  label="Unsubscribed"
                                  description={`${report.stats.unsubscribe_rate}% rate`}
                                />
                              </Col>
                            </Row>
                          </div>
                        )}
                      </div>
                    </Tab.Pane>

                    {/* Engagement Tab */}
                    <Tab.Pane eventKey="engagement">
                      {report.campaign.message_type === "email" ? (
                        <div>
                          <h3 className="w_card_title">Engagement</h3>
                          <Row className="gx-xxl-3 gx-2">
                            <Col xl={3} md={4} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-browser"
                                count={report.stats.total_opens || 0}
                                label="Total Opens"
                                description={`${report.stats.unique_opens} unique`}
                              />
                            </Col>
                            <Col xl={3} md={4} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-hand-pointer"
                                count={report.stats.total_clicks || 0}
                                label="Total Clicks"
                                description={`${report.stats.unique_clicks} unique`}
                              />
                            </Col>
                            <Col xl={3} md={4} xs={6}>
                              <CountCard
                                iconClass="fa-regular fa-percentage"
                                count={`${report.stats.click_to_open_rate || 0}%`}
                                label="Click-to-Open Rate"
                                description={`of openers clicked`}
                              />
                            </Col>
                          </Row>
                        </div>
                      ) : (
                        <Alert variant="info">
                          Engagement metrics are only available for email campaigns.
                        </Alert>
                      )}
                    </Tab.Pane>

                    {/* Top Links Tab */}
                    <Tab.Pane eventKey="links">
                      {report.campaign.message_type === "email" ? (
                        <div>
                          <h3 className="w_card_title">Top Clicked Links</h3>
                          {report.top_links && report.top_links.length > 0 ? (
                            <div>
                              {report.top_links.map((link, idx) => (
                                <div key={idx} className="p-2 bg-light rounded border mb-2">
                                  <Row className="gx-2">
                                    <Col xxl={10} md={8}>
                                      <div className="position-relative">
                                        <div className="d-flex align-items-center gap-2 mb-1">
                                          <Badge bg="custom">{idx + 1}</Badge>
                                          <small className="text-muted">URL</small>
                                        </div>
                                        <p className="mb-0 bg-white p-2 rounded border">
                                          {link.url || "N/A"}
                                        </p>
                                      </div>
                                    </Col>
                                    <Col xxl={1} md={2} xs={6} className="mt-1 mt-md-0">
                                      <div className="bg-custom rounded text-center h-100 d-flex align-items-center justify-content-center">
                                        <div className="position-relative">
                                          <h5 className="mb-0 text-white">{link.total_clicks}</h5>
                                          <small className="text-white">Total Clicks</small>
                                        </div>
                                      </div>
                                    </Col>
                                    <Col xxl={1} md={2} xs={6} className="mt-1 mt-md-0">
                                      <div className="bg-white border rounded text-center h-100 d-flex align-items-center justify-content-center">
                                        <div className="position-relative">
                                          <h5 className="mb-0 text-custom">{link.unique_clicks}</h5>
                                          <small className="text-dark">Unique Clicks</small>
                                        </div>
                                      </div>
                                    </Col>
                                  </Row>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Alert variant="info">
                              <i className="fa-solid fa-link me-2"></i>
                              No link clicks recorded yet.
                            </Alert>
                          )}
                        </div>
                      ) : (
                        <Alert variant="info">
                          Link tracking is only available for email campaigns.
                        </Alert>
                      )}
                    </Tab.Pane>

                    {/* Leads Tab */}
                    <Tab.Pane eventKey="leads">
                      <div>
                        <Row className="align-items-center mb-3">
                          <Col xxl={5} xl={3} md={3} >
                            <div className="d-flex align-items-center">
                              <h3 className="w_card_title mb-md-0">Campaign Reach</h3>
                            </div>
                          </Col>
                          <Col xxl={7} xl={9} md={9}>
                            {/* Filter Controls */}
                            <Row className="search_filters gx-1">
                              <Col xxl={6} xl={5} lg={5} md={5} xs={12}>
                                <InputGroup size="sm">
                                  <InputGroup.Text>
                                    <i className="fa-solid fa-search"></i>
                                  </InputGroup.Text>
                                  <Form.Control
                                    type="text"
                                    size="sm"
                                    placeholder="Search by name"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                  />
                                </InputGroup>
                              </Col>
                              <Col xxl={3} xl={4} lg={3} md={3} xs={6} className="mt-1 mt-md-0">
                                <Form.Select
                                  size="sm"
                                  value={statusFilter}
                                  onChange={(e) => setStatusFilter(e.target.value)}
                                >
                                  <option value="all">All Status</option>
                                  <option value="pending">Pending</option>
                                  <option value="held">Held</option>
                                  <option value="blocked">Blocked</option>
                                  <option value="sent">Sent</option>
                                  <option value="failed">Failed</option>
                                  <option value="bounced">Bounced</option>
                                </Form.Select>
                              </Col>
                              <Col xxl={3} xl={3} lg={4} md={4} xs={6} className="mt-1 mt-md-0">
                                <div className="d-flex gap-1">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={clearFilters}
                                    disabled={!searchQuery && statusFilter === "all"}
                                    className="px-3"
                                  >Clear
                                  </Button>
                                  <Button
                                    variant="custom"
                                    size="sm"
                                    onClick={() => exportLeadsToCSV()}
                                    disabled={!filteredLeads || filteredLeads.length === 0}
                                    className="w-100"
                                  >
                                    <i className="fa-solid fa-download me-1"></i>Export CSV
                                  </Button>
                                </div>
                              </Col>
                            </Row>                
                          </Col>
                        </Row>

                        {filteredLeads.length > 0 ? (
                          <>                            
                            <ListGroup as="ul" variant="flush">
                              <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
                                <Row className="align-items-center g-0">
                                  <Col xl={11} lg={11} sm={11} xs={9}>
                                    <Row className="align-items-center gx-2">
                                      <Col xl={2} lg={2} sm={2} xs={12}>
                                        <p className="p_bold"><small>Name</small></p>
                                      </Col>
                                      <Col xl={1} lg={1} sm={1} xs={12}>
                                        <p className="p_bold"><small>Lead Type</small></p>
                                      </Col>
                                      <Col xl={1} lg={1} sm={1} xs={12}>
                                        <p className="p_bold"><small>Status</small></p>
                                      </Col>
                                      <Col xl={2} lg={2} sm={2} xs={12}>
                                        <p className="p_bold"><small>Sent At</small></p>
                                      </Col>
                                      <Col xl={2} lg={2} sm={2} xs={12}>
                                        <p className="p_bold"><small>Opened</small></p>
                                      </Col>
                                      <Col xl={1} lg={1} sm={1} xs={12}>
                                        <p className="p_bold"><small>Opens</small></p>
                                      </Col>
                                      <Col xl={2} lg={2} sm={2} xs={12}>
                                        <p className="p_bold"><small>Clicked</small></p>
                                      </Col>
                                      <Col xl={1} lg={1} sm={1} xs={12}>
                                        <p className="p_bold"><small>Clicks</small></p>
                                      </Col>
                                    </Row>
                                  </Col>
                                  <Col xl={1} lg={1} sm={1} xs={3}>
                                    <p className="p_bold"><small>Unsubscribed</small></p>
                                  </Col>
                                </Row>
                              </ListGroup.Item>
                  
                              {filteredLeads.map((lead) => (
                                <ListGroup.Item as="li" key={lead.id} className="w_card_list_box">
                                  <Row className="align-items-md-center g-0">
                                    <Col xl={11} lg={11} sm={11} xs={12}>
                                      <Row className="align-items-center gx-2">
                                        <Col xl={2} lg={2} sm={2} xs={12}>
                                          <p className="p_bold">{lead.name || "N/A"}</p>
                                        </Col>
                                        <Col xl={1} lg={1} sm={1} xs={12}>
                                        <div className="w_card_list_box_label">
                                            <p className="label"><small>Lead Type:</small></p>
                                            {lead.is_system_lead ? (
                                              <p title={`System Lead ID: ${lead.lead_id}`}>
                                                System
                                              </p>
                                            ) : (
                                              <p title="External/Outside Lead">
                                                Outside
                                              </p>
                                            )}
                                          </div>
                                        </Col>
                                        <Col xl={1} lg={1} sm={1} xs={12}>
                                        <div className="w_card_list_box_label">
                                            <p className="label"><small>Status:</small></p>
                                            <Badge bg={getLeadStatusVariant(lead.status)} className="text-capitalize">
                                              {lead.status}
                                            </Badge>
                                          </div>
                                        </Col>
                                        <Col xl={2} lg={2} sm={2} xs={12}>
                                          <div className="w_card_list_box_label">
                                            <p className="label"><small>Sent At:</small></p>
                                            <p className="overflow-unset text-wrap">{lead.sent_at ? formatTimestamp(lead.sent_at, timezone) : "-"}</p>
                                          </div>
                                        </Col>
                                        {report.campaign.message_type === "email" && (
                                        <>
                                          <Col xl={2} lg={2} sm={2} xs={12}>
                                            <div className="w_card_list_box_label">
                                              <p className="label"><small>Opened:</small></p>
                                              {lead.opened ? (
                                                <Badge bg="custom"><i className="fa-solid fa-check"></i></Badge>
                                              ) : (
                                                <Badge bg="secondary"><i className="fa-solid fa-times"></i></Badge>
                                              )}
                                              {lead.opened_at && (
                                                <div className="small text-muted mt-md-1 ms-md-0 ms-1">
                                                  {formatTimestamp(lead.opened_at, timezone)}
                                                </div>
                                              )}
                                            </div>
                                          </Col>
                                          <Col xl={1} lg={1} sm={1} xs={12}>
                                          <div className="w_card_list_box_label">
                                              <p className="label"><small>Opens:</small></p>
                                            <p>{lead.open_count || 0}</p>
                                            </div>
                                          </Col>
                                          <Col xl={2} lg={2} sm={2} xs={12}>
                                          <div className="w_card_list_box_label">
                                              <p className="label"><small>Clicked:</small></p>
                                              {lead.clicked ? (
                                                <Badge bg="custom"><i className="fa-solid fa-check"></i></Badge>
                                              ) : (
                                                <Badge bg="secondary"><i className="fa-solid fa-times"></i></Badge>
                                              )}
                                              {lead.clicked_at && (
                                                <div className="small text-muted mt-md-1 ms-md-0 ms-1">
                                                  {formatTimestamp(lead.clicked_at, timezone)}
                                                </div>
                                              )}
                                            </div>
                                          </Col>
                                          <Col xl={1} lg={1} sm={1} xs={12}>
                                          <div className="w_card_list_box_label">
                                              <p className="label"><small>Clicks:</small></p>
                                              <p>{lead.click_count || 0}</p>
                                            </div>
                                          </Col>
                                        </>
                                        )}
                                      </Row>
                                    </Col>
                
                                    <Col xl={1} lg={1} sm={1} xs={12}>
                                      <div className="w_card_list_box_label">
                                        <p className="label"><small>Unsubscribed:</small></p>
                                        {lead.unsubscribed ? (
                                          <Badge bg="custom" className="text-center"><i className="fa-solid fa-ban"></i></Badge>
                                        ) : (
                                          <Badge bg="secondary" className="text-center"><i className="fa-solid fa-times"></i></Badge>
                                        )}
                                        {lead.unsubscribed_at && (
                                          <div className="small text-muted mt-1">
                                            {formatTimestamp(lead.unsubscribed_at, timezone)}
                                          </div>
                                        )}
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      {statusFilter === "failed" && (
                                        <p>
                                          <small className="text-danger">
                                            <b>Error: </b>{lead.error_message || "-"}
                                          </small>
                                        </p>
                                      )}
                                      {lead.status === "held" && (
                                        <p className="mb-0">
                                          <small className="text-warning">
                                            <b>Held until {lead.held_until ? formatTimestamp(lead.held_until, timezone) : "—"}: </b>
                                            {lead.block_reason || "waiting for an allowed time"}
                                          </small>
                                        </p>
                                      )}
                                      {lead.status === "blocked" && (
                                        <p className="mb-0">
                                          <small className="text-danger">
                                            <b>Blocked: </b>{lead.block_reason || "stopped by the send check"}
                                          </small>
                                        </p>
                                      )}
                                    </Col>
                                  </Row>
                                </ListGroup.Item>
                              ))}
                            </ListGroup>

                            {/* <div className="table-responsive mt-3">
                              <Table bordered>
                                <thead className="table-light">
                                  <tr>
                                    <th>Name</th>
                                    <th>{report.campaign.message_type === "email" ? "Email" : "Phone"}</th>
                                    <th>Lead Type</th>
                                    <th>Status</th>
                                    <th>Sent At</th>
                                    {report.campaign.message_type === "email" && (
                                      <>
                                        <th>Opened</th>
                                        <th>Opens</th>
                                        <th>Clicked</th>
                                        <th>Clicks</th>
                                      </>
                                    )}
                                    <th>Unsubscribed</th>
                                    {statusFilter === "failed" && <th>Error</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredLeads.map((lead) => (
                                    <tr key={lead.id}>
                                      <td>
                                        <strong>{lead.name || "N/A"}</strong>
                                      </td>
                                      <td>
                                        {report.campaign.message_type === "email" ? (
                                          <a href={`mailto:${lead.email}`}>{lead.email || "N/A"}</a>
                                        ) : (
                                          <a href={`tel:${lead.phone}`}>{lead.phone || "N/A"}</a>
                                        )}
                                      </td>
                                      <td>
                                        {lead.is_system_lead ? (
                                          <Badge bg="custom" title={`System Lead ID: ${lead.lead_id}`}>
                                            System
                                          </Badge>
                                        ) : (
                                          <Badge bg="secondary" title="External/Outside Lead">
                                            Outside
                                          </Badge>
                                        )}
                                      </td>
                                      <td>
                                        <Badge bg={getLeadStatusVariant(lead.status)}>
                                          {lead.status.toUpperCase()}
                                        </Badge>
                                      </td>
                                      <td>
                                        {lead.sent_at
                                          ? formatTimestamp(lead.sent_at, timezone)
                                          : "—"}
                                      </td>
                                      {report.campaign.message_type === "email" && (
                                        <>
                                          <td className="text-center">
                                            {lead.opened ? (
                                              <Badge bg="success">
                                                <i className="fa-solid fa-check me-1"></i>Yes
                                              </Badge>
                                            ) : (
                                              <Badge bg="secondary"><i className="fa-solid fa-times me-1"></i>No</Badge>
                                            )}
                                            {lead.opened_at && (
                                              <div className="small text-muted mt-1">
                                                {formatTimestamp(lead.opened_at, timezone)}
                                              </div>
                                            )}
                                          </td>
                                          <td className="text-center">{lead.open_count || 0}</td>
                                          <td className="text-center">
                                            {lead.clicked ? (
                                              <Badge bg="warning">
                                                <i className="fa-solid fa-check me-1"></i>Yes
                                              </Badge>
                                            ) : (
                                              <Badge bg="secondary"><i className="fa-solid fa-times me-1"></i>No</Badge>
                                            )}
                                            {lead.clicked_at && (
                                              <div className="small text-muted mt-1">
                                                {formatTimestamp(lead.clicked_at, timezone)}
                                              </div>
                                            )}
                                          </td>
                                          <td className="text-center">{lead.click_count || 0}</td>
                                        </>
                                      )}
                                      <td className="text-center">
                                        {lead.unsubscribed ? (
                                          <Badge bg="danger">
                                            <i className="fa-solid fa-ban me-1"></i>Yes
                                          </Badge>
                                        ) : (
                                          <Badge bg="secondary"><i className="fa-solid fa-times me-1"></i>No</Badge>
                                        )}
                                        {lead.unsubscribed_at && (
                                          <div className="small text-muted mt-1">
                                            {formatTimestamp(lead.unsubscribed_at, timezone)}
                                          </div>
                                        )}
                                      </td>
                                      {statusFilter === "failed" && (
                                        <td>
                                          <small className="text-danger">
                                            {lead.error_message || "—"}
                                          </small>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </Table>
                            </div> */}
                            <p className="mb-0">
                              <small className="text-muted">
                                Showing {filteredLeads.length} of {report.leads.length} leads
                              </small>
                            </p>
                          </>
                        ) : (
                          <div className="text-center py-4">
                            {searchQuery || statusFilter !== "all"
                              ? "No leads match your search criteria."
                              : "No leads found for this campaign."}
                          </div>
                        )}
                      </div>
                    </Tab.Pane>
                  </Tab.Content>
              </div>
            </Tab.Container>
          </>
        )}
      </div>
    </div>
  );
}
