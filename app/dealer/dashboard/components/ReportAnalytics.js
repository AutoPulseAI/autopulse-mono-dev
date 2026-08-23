'use client';

import { Badge, Table, Button } from 'react-bootstrap';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useUser } from '../../context/UserContext';

const COLORS = ['var(--primary)', 'var(--secondary)', 'var(--primary2)', 'var(--secondary2)', 'var(--primary3)', 'var(--secondary3)'];

export default function ReportAnalytics({ data, totalSMS, totalEmail, dateRange, buildUrlWithDateRange }) {
  const { dealerParent } = useUser();
  const dealerTimezone = dealerParent?.dealer_account_information?.time_zone || 'America/New_York';
  
  if (!data) return null;

  const { 
    emailMetrics, 
    leadMetrics, 
    recentReports,
    period 
  } = data;

  // Use the same calculation as top dashboard for consistency
  // totalSMS and totalEmail come from /api/admin/message-stats which counts ALL messages
  // This ensures Communication Overview matches the top dashboard counts
  const emailsSent = totalEmail !== undefined && totalEmail !== null ? totalEmail : (emailMetrics?.email?.sent || 0);
  const smsSent = totalSMS !== undefined && totalSMS !== null ? totalSMS : (emailMetrics?.sms?.sent || 0);

  // Prepare data for charts - align with top dashboard counts
  const communicationData = [
    { name: 'Emails Sent', value: emailsSent, color: 'var(--primary)' },
    { name: 'Emails Received', value: emailMetrics?.email?.received || 0, color: 'var(--secondary)' },
    { name: 'SMS Sent', value: smsSent, color: 'var(--primary2)' },
    { name: 'SMS Received', value: emailMetrics?.sms?.received || 0, color: 'var(--secondary2)' }
  ];

  const leadStatusData = leadMetrics?.statuses?.map(status => ({
    name: status._id,
    value: status.count
  })) || [];

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: dealerTimezone
    });
  };

  const formatScheduledTime = (report) => {
    // If we have formatted display time from API, use it
    if (report.scheduledAtDisplay) {
      return report.scheduledAtDisplay;
    }
    // Fallback to formatting the date
    if (report.scheduledAt) {
      return formatDate(report.scheduledAt);
    }
    return 'N/A';
  };

  const getTimezoneAbbr = (timezone) => {
    if (!timezone) return '';
    // Get timezone abbreviation (e.g., EST, PST)
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short'
      });
      const parts = formatter.formatToParts(now);
      const tzName = parts.find(part => part.type === 'timeZoneName');
      if (tzName && tzName.value) {
        return tzName.value;
      }
      // Fallback: extract last part of timezone string (e.g., "New_York" from "America/New_York")
      const partsArray = timezone.split('/');
      return partsArray[partsArray.length - 1].replace(/_/g, ' ');
    } catch (e) {
      // Fallback: extract last part of timezone string
      const partsArray = timezone.split('/');
      return partsArray[partsArray.length - 1].replace(/_/g, ' ');
    }
  };

  const getStatusBadgeVariant = (status) => {
    switch (status?.toLowerCase()) {
      case 'sent': return 'success';
      case 'pending': return 'warning';
      case 'failed': return 'danger';
      default: return 'secondary';
    }
  };

  // Click handlers for charts and data
  const handleCommunicationBarClick = (data) => {
    if (!data || !data.name) return;
    
    let url = '/dealer/leads';
    
    // Apply date range if available
    if (buildUrlWithDateRange) {
      url = buildUrlWithDateRange(url);
    } else if (dateRange?.startDate && dateRange?.endDate) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}startDate=${encodeURIComponent(dateRange.startDate.toISOString())}&endDate=${encodeURIComponent(dateRange.endDate.toISOString())}`;
    }
    
    // Add response mode filter based on communication type
    const separator = url.includes('?') ? '&' : '?';
    if (data.name.includes('Email')) {
      url += `${separator}response_mode=email`;
    } else if (data.name.includes('SMS')) {
      url += `${separator}response_mode=sms`;
    }
    
    window.location.href = url;
  };

  const handleStatusPieClick = (data) => {
    if (!data || !data.name) return;
    
    let url = `/dealer/leads?status=${encodeURIComponent(data.name)}`;
    
    // Apply date range if available
    if (buildUrlWithDateRange) {
      url = buildUrlWithDateRange(url);
    } else if (dateRange?.startDate && dateRange?.endDate) {
      url += `&startDate=${encodeURIComponent(dateRange.startDate.toISOString())}&endDate=${encodeURIComponent(dateRange.endDate.toISOString())}`;
    }
    
    window.location.href = url;
  };

  const handleDataClick = (type, value) => {
    if (!value || value === 0) return;
    
    let url = '/dealer/leads';
    
    // Special handling for managerial review - no date filter
    if (type === 'managerial') {
      url = `/dealer/leads?status=Managerial Review`;
      window.location.href = url;
      return;
    }
    
    // Apply date range if available (for all other types)
    if (buildUrlWithDateRange) {
      url = buildUrlWithDateRange(url);
    } else if (dateRange?.startDate && dateRange?.endDate) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}startDate=${encodeURIComponent(dateRange.startDate.toISOString())}&endDate=${encodeURIComponent(dateRange.endDate.toISOString())}`;
    }
    
    // Add appropriate filter based on type
    const separator = url.includes('?') ? '&' : '?';
    switch (type) {
      case 'emailsSent':
        url += `${separator}response_mode=email`;
        break;
      case 'emailsReceived':
        url += `${separator}response_mode=email&direction=received`;
        break;
      case 'smsSent':
        url += `${separator}response_mode=sms`;
        break;
      case 'smsReceived':
        url += `${separator}response_mode=sms&direction=received`;
        break;
      case 'totalLeads':
        // Just show all leads with date range
        break;
      case 'totalCommunications':
        // Show all leads with communications in date range
        break;
      case 'newLeads':
        url += `${separator}status=Lead`;
        break;
      case 'contacted':
        url += `${separator}status=Contacted`;
        break;
      case 'appointment':
        url += `${separator}booking_status=true`;
        break;
      default:
        break;
    }
    
    window.location.href = url;
  };

  return (
    <div className="row gx-2 gx-xl-3">
        {/* Communication Overview */}
        <div className="col col-xxl-6 col-lg-12 col-12">
          <div className="w_card">
            <h3 className="w_card_title">Communication Overview</h3>
            <div className="row g-3">
              <div className="col col-md-4 col-12">
                <div className="row g-1">
                  <div className="col-12">
                    <div 
                      className="d-flex align-items-center px-2 py-2 border rounded"
                      onClick={() => handleDataClick('emailsSent', emailsSent)}
                      style={{ cursor: emailsSent > 0 ? 'pointer' : 'default' }}
                      title={emailsSent > 0 ? 'Click to view leads with email communications' : ''}
                    >
                      <p className="mb-0 me-auto">Emails Sent:</p>                          
                        {/* {emailMetrics?.email?.change && (
                        <div className={`small ${emailMetrics.email.change >= 0 ? 'text-success' : 'text-danger'} me-2`}>
                          {emailMetrics.email.change >= 0 ? '↗' : '↘'} {Math.abs(emailMetrics.email.change)}%
                        </div>
                        )} */}
                      <h5 className="mb-0">{emailsSent}</h5>
                    </div>
                  </div>
                  <div className="col-12">
                    <div 
                      className="d-flex align-items-center px-2 py-2 border rounded"
                      onClick={() => handleDataClick('emailsReceived', emailMetrics?.email?.received || 0)}
                      style={{ cursor: (emailMetrics?.email?.received || 0) > 0 ? 'pointer' : 'default' }}
                      title={(emailMetrics?.email?.received || 0) > 0 ? 'Click to view received emails' : ''}
                    >
                      <p className="mb-0 me-auto">Emails Received:</p>
                      <h5 className="mb-0">{emailMetrics?.email?.received || 0}</h5>
                    </div>
                  </div>
                  <div className="col-12">
                    <div 
                      className="d-flex align-items-center px-2 py-2 border rounded"
                      onClick={() => handleDataClick('smsSent', smsSent)}
                      style={{ cursor: smsSent > 0 ? 'pointer' : 'default' }}
                      title={smsSent > 0 ? 'Click to view leads with SMS communications' : ''}
                    >
                      <p className="mb-0 me-auto">SMS Sent:</p>
                      {/* {emailMetrics?.sms?.change && (
                        <div className={`small ${emailMetrics.sms.change >= 0 ? 'text-success' : 'text-danger'} me-2`}>
                          {emailMetrics.sms.change >= 0 ? '↗' : '↘'} {Math.abs(emailMetrics.sms.change)}%
                        </div>
                      )} */}
                      <h5 className="mb-0">{smsSent}</h5>
                    </div>
                  </div>
                  <div className="col-12">
                    <div 
                      className="d-flex align-items-center px-2 py-2 border rounded"
                      onClick={() => handleDataClick('smsReceived', emailMetrics?.sms?.received || 0)}
                      style={{ cursor: (emailMetrics?.sms?.received || 0) > 0 ? 'pointer' : 'default' }}
                      title={(emailMetrics?.sms?.received || 0) > 0 ? 'Click to view received SMS' : ''}
                    >
                      <p className="mb-0 me-auto">SMS Received:</p>
                      <h5 className="mb-0">{emailMetrics?.sms?.received || 0}</h5>
                    </div>
                  </div>
                  <div className="col-12">
                    <div 
                      className="d-flex align-items-center px-2 py-2 border rounded"
                      onClick={() => handleDataClick('totalCommunications', (emailsSent || 0) + (smsSent || 0) + (emailMetrics?.email?.received || 0) + (emailMetrics?.sms?.received || 0))}
                      style={{ cursor: ((emailsSent || 0) + (smsSent || 0) + (emailMetrics?.email?.received || 0) + (emailMetrics?.sms?.received || 0)) > 0 ? 'pointer' : 'default' }}
                      title={((emailsSent || 0) + (smsSent || 0) + (emailMetrics?.email?.received || 0) + (emailMetrics?.sms?.received || 0)) > 0 ? 'Click to view all communications' : ''}
                    >
                      <p className="mb-0 me-auto">Total Communications:</p>
                      <h5 className="mb-0">{(emailsSent || 0) + (smsSent || 0) + (emailMetrics?.email?.received || 0) + (emailMetrics?.sms?.received || 0)}</h5>
                    </div>
                  </div>
                </div>
                
              </div>
              <div className="col col-md-8 col-12">
                {/* Communication Chart */}
                <div className="mt-3">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={communicationData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
                      <Bar dataKey="value" onClick={handleCommunicationBarClick} style={{ cursor: 'pointer' }}>
                          {communicationData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

        </div>
      </div>

      {/* Lead Status Distribution */}
      <div className="col col-xxl-6 col-lg-12 col-12">
        <div className="w_card">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h3 className="w_card_title mb-0">Lead Status Distribution</h3>
            {period && (
              <small className="text-muted">
                Period: <strong className='text-dark'>{period.label || 'Current Period'}</strong>
                {period.start && period.end && (
                  <span className="ms-2">
                    ({new Date(period.start).toLocaleDateString('en-US', { timeZone: dealerTimezone })} - {new Date(period.end).toLocaleDateString('en-US', { timeZone: dealerTimezone })})
                  </span>
                )}
              </small>
            )}
          </div>
          <div className="row g-3">
            <div className="col col-md-4 col-12">
              <div className="row g-1">
                <div className="col-12">
                  <div 
                    className="d-flex align-items-center px-2 py-2 border rounded"
                    onClick={() => handleDataClick('totalLeads', leadMetrics?.total_leads || 0)}
                    style={{ cursor: (leadMetrics?.total_leads || 0) > 0 ? 'pointer' : 'default' }}
                    title={(leadMetrics?.total_leads || 0) > 0 ? 'Click to view all leads' : 'Total leads created in the selected date range'}
                  >
                    <p className="mb-0 me-auto" title="Total leads created in the selected date range">Total Leads:</p>
                    <h5 className="mb-0">{leadMetrics?.total_leads || 0}</h5>
                  </div>
                  {/* <small className="text-muted ms-2" style={{fontSize: '0.75rem'}}>Leads created in selected period</small> */}
                </div>
                <div className="col-12">
                  <p className='mb-1 mt-2'><b>Lead Count Based on Status</b></p>
                </div>
                <div className="col-12">
                  <div 
                    className="d-flex align-items-center px-2 py-2 border rounded"
                    onClick={() => handleDataClick('newLeads', leadMetrics?.new_leads || 0)}
                    style={{ cursor: (leadMetrics?.new_leads || 0) > 0 ? 'pointer' : 'default' }}
                    title={(leadMetrics?.new_leads || 0) > 0 ? 'Click to view leads with status "Lead"' : 'Leads with status "Lead" created in the selected period'}
                  >
                    <p className="mb-0 me-auto" title="Leads with status 'Lead' created in the selected period">Leads:</p>
                    <h5 className="mb-0">{leadMetrics?.new_leads || 0}</h5>
                  </div>
                  {/* <small className="text-muted ms-2" style={{fontSize: '0.75rem'}}>Leads with status 'Lead' in selected period</small> */}
                </div>

                {/* Additional Lead Status Metrics */}
                <div className="col-12">
                  <div 
                    className="d-flex align-items-center px-2 py-2 border rounded"
                    onClick={() => handleDataClick('contacted', leadMetrics?.contacted_leads || 0)}
                    style={{ cursor: (leadMetrics?.contacted_leads || 0) > 0 ? 'pointer' : 'default' }}
                    title={(leadMetrics?.contacted_leads || 0) > 0 ? 'Click to view contacted leads' : ''}
                  >
                    <p className="mb-0 me-auto">Contacted:</p>
                    <h5 className="mb-0">{leadMetrics?.contacted_leads || 0}</h5>
                  </div>
                </div>
                <div className="col-12">
                  <div 
                    className="d-flex align-items-center px-2 py-2 border rounded"
                    onClick={() => handleDataClick('appointment', leadMetrics?.appointment_leads || 0)}
                    style={{ cursor: (leadMetrics?.appointment_leads || 0) > 0 ? 'pointer' : 'default' }}
                    title={(leadMetrics?.appointment_leads || 0) > 0 ? 'Click to view appointments' : ''}
                  >
                    <p className="mb-0 me-auto">Appointment:</p>
                    <h5 className="mb-0">{leadMetrics?.appointment_leads || 0}</h5>
                  </div>
                </div>
                <div className="col-12">
                  <div 
                    className="d-flex align-items-center px-2 py-2 border rounded"
                    onClick={() => handleDataClick('managerial', leadMetrics?.managerial_review_leads || 0)}
                    style={{ cursor: (leadMetrics?.managerial_review_leads || 0) > 0 ? 'pointer' : 'default' }}
                    title={(leadMetrics?.managerial_review_leads || 0) > 0 ? 'Click to view managerial review leads' : ''}
                  >
                    <p className="mb-0 me-auto">Managerial:</p>
                    <h5 className="mb-0">{leadMetrics?.managerial_review_leads || 0}</h5>
                  </div>
                </div>

              </div>
            </div>
            <div className="col col-md-8 col-12">
              {/* Lead Status Pie Chart */}
              {leadStatusData.length > 0 && (
                <div className="mt-3">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={leadStatusData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        onClick={handleStatusPieClick}
                        label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, name, value }) => {
                          // Calculate percentage manually if percent is not available
                          const total = leadStatusData.reduce((sum, item) => sum + (item.value || 0), 0);
                          const calculatedPercent = total > 0 ? ((value || 0) / total) * 100 : 0;
                          const displayPercent = (percent && !isNaN(percent)) ? percent * 100 : calculatedPercent;
                          
                          // Hide labels for slices less than 3% to prevent overlap
                          if (displayPercent < 3) return null;
                          
                          const RADIAN = Math.PI / 180;
                          // Position labels outside the pie chart
                          const radius = outerRadius + 15;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);

                          return (
                            <text 
                              x={x} 
                              y={y} 
                              fill="#333" 
                              textAnchor={x > cx ? 'start' : 'end'} 
                              dominantBaseline="central"
                              fontSize={10}
                              fontWeight="500"
                            >
                              {`${name} ${displayPercent.toFixed(0)}%`}
                            </text>
                          );
                        }}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        style={{ cursor: 'pointer' }}
                      >
                        {leadStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Reports 
      <div className="col col-12">
        <div className="w_card">
          <h3 className="w_card_title">Scheduled Reports</h3>
          <div className="mb-3">
            <small className="text-muted">
              This section shows pending scheduled reports based on your report schedule settings. 
              Scheduled times are displayed in your configured timezone. Only reports with "Pending" status are shown here. Reports are generated according to the schedule configured in Report Settings.
              <br />
              <strong>Note:</strong> Pending reports are scheduled but haven't been sent yet. They will be automatically sent by the system when their scheduled time arrives.
            </small>
          </div>
          
          {recentReports && recentReports.length > 0 ? (
            <Table responsive striped>
              <thead>
                <tr>
                  <th>Scheduled Time</th>
                  <th>Type</th>
                  <th>Leads</th>
                  <th>Emails</th>
                  <th>SMS</th>
                  <th>Vehicles</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentReports.map((report, index) => (
                  <tr key={report.id || index}>
                    <td>
                      <div>
                        <div>
                          <strong>Scheduled:</strong> {formatScheduledTime(report)}
                        </div>
                        {report.sentAtDisplay && (
                          <div className="mt-1">
                            <strong>Sent:</strong> {report.sentAtDisplay}
                          </div>
                        )}
                        {report.timezone && (
                          <small className="text-muted d-block mt-1" style={{fontSize: '0.75rem'}}>
                            {getTimezoneAbbr(report.timezone)} ({report.timezone})
                          </small>
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge bg="custom">{report.type}</Badge>
                    </td>
                    <td>{report.metrics?.leads || 0}</td>
                    <td>{report.metrics?.emails || 0}</td>
                    <td>{report.metrics?.sms || 0}</td>
                    <td>{report.metrics?.vehicles || 0}</td>
                    <td>
                      <Badge bg={getStatusBadgeVariant(report.status)} className='text-capitalize'>
                        {report.status || 'Unknown'}
                      </Badge>
                      {report.status === 'pending' && report.scheduledAt && new Date(report.scheduledAt) < new Date() && (
                        <small className="text-muted d-block mt-1" style={{fontSize: '0.7rem'}}>
                          Overdue
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted mb-2">
                <strong>No automated reports have been generated yet.</strong>
              </p>
              <p className="text-muted mb-3" style={{fontSize: '0.9rem'}}>
                Automated reports are generated based on your report schedule settings. 
                Configure your report schedule to start receiving automated reports via email.
              </p>
              <Button 
                variant="outline-primary" 
                size="sm"
                onClick={() => window.location.href = '/dealer/report-schedule'}
              >
                <i className="fa-regular fa-calendar me-2"></i>
                Configure Report Schedule
              </Button>
            </div>
          )}
        </div>
      </div>*/}
    </div>
  );
}
