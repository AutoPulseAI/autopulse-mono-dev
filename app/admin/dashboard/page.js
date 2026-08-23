"use client";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "../context/UserContext";
import CustomLoader from "./../components/CustomLoader";
import useFetch from "../../hooks/useFetch";
import { Alert } from "react-bootstrap";
import moment from "moment-timezone";
import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import CountCard from "./components/CountCard";
import DateRangePickerComponent from "../components/DateRangePicker";
import AgencyDealerDataPie from "./components/AgencyDealerDataPie";
import SubscriptionStatusDataPie from "./components/SubscriptionStatusDataPie";
import UserDistributionBar from "./components/UserDistributionBar";
import SubscriptionOverviewBar from "./components/SubscriptionOverviewBar";

// import RedisQueueControl from "./components/RedisQueueControl";
import ReportCronServiceControl from "./components/ReportCronServiceControl";

export default function AdminDashboard() {
  const { user, loading: userLoading } = useUser();
  const { fetchData } = useFetch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [messageStats, setMessageStats] = useState(null);
  
  // Admin timezone defaults to EST
  const adminTimezone = 'America/New_York';
  
  // Initialize with no date filter (show all-time data by default)
  const [dateRange, setDateRange] = useState({
    startDate: null,
    endDate: null
  });

  // State for chart visibility
  const [chartVisibility, setChartVisibility] = useState({
    emailCount: true,
    smsCount: true
  });


  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let queryParams = '';
      if (dateRange.startDate && dateRange.endDate) {
        queryParams = `?start_date=${dateRange.startDate.toISOString()}&end_date=${dateRange.endDate.toISOString()}`;
      }

      // Fetch both regular stats and message stats in parallel
      const [statsRes, messageStatsRes] = await Promise.all([
        fetchData(`/api/admin/stats${queryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }}),
        fetchData(`/api/admin/message-stats${queryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }})
      ]);

      if (!statsRes.ok) throw new Error('Failed to fetch admin statistics');
      if (!messageStatsRes.ok) throw new Error('Failed to fetch message statistics');

      setStats(await statsRes.json());
      setMessageStats(await messageStatsRes.json());
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchData, dateRange]);

  useEffect(() => {
    if (user?.type === "admin") {
      fetchDashboardData();
    }
  }, [user, dateRange, fetchDashboardData]);

  const handleDateRangeChange = ({ startDate, endDate }) => {
    setDateRange({ startDate, endDate });
  };

  // Helper function to build URL with date range parameters
  const buildUrlWithDateRange = (baseUrl) => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return baseUrl;
    }
    
    try {
      const url = baseUrl.startsWith('http') 
        ? new URL(baseUrl) 
        : new URL(baseUrl, window.location.origin);
      
      url.searchParams.set('startDate', dateRange.startDate.toISOString());
      url.searchParams.set('endDate', dateRange.endDate.toISOString());
      
      return url.pathname + url.search;
    } catch (e) {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}startDate=${encodeURIComponent(dateRange.startDate.toISOString())}&endDate=${encodeURIComponent(dateRange.endDate.toISOString())}`;
    }
  };

  // Click handlers for charts
  const handleAgencyDealerClick = (data) => {
    if (data && data.name) {
      let url = '';
      if (data.name === 'Agencys') {
        url = '/admin/vendors';
      } else if (data.name === 'Dealers') {
        url = '/admin/dealers';
      }
      if (url) {
        url = buildUrlWithDateRange(url);
        window.location.href = url;
      }
    }
  };

  const handleSubscriptionStatusClick = (data) => {
    if (data && data.name) {
      let url = '';
      if (data.name === 'Active') {
        url = '/admin/dealers?subscription_status=active';
      } else if (data.name === 'Expired') {
        url = '/admin/dealers?subscription_status=expired';
      } else if (data.name === 'None') {
        url = '/admin/dealers?subscription_status=none';
      }
      if (url) {
        url = buildUrlWithDateRange(url);
        window.location.href = url;
      }
    }
  };

  const handleUserDistributionClick = (data) => {
    if (data && data.name) {
      let url = '';
      if (data.name === 'Agencys') {
        url = '/admin/vendors';
      } else if (data.name === 'Dealers') {
        url = '/admin/dealers';
      }
      if (url) {
        url = buildUrlWithDateRange(url);
        window.location.href = url;
      }
    }
  };

  const handleSubscriptionOverviewClick = (data, type) => {
    if (data && data.name) {
      let url = '';
      if (type === 'vendors') {
        if (data.name === 'Subscribed') {
          url = '/admin/vendors?subscribed=1';
        } else {
          url = '/admin/vendors?subscribed=0';
        }
      } else if (type === 'dealers') {
        if (data.name === 'Subscribed') {
          url = '/admin/dealers?subscribed=1';
        } else {
          url = '/admin/dealers?subscribed=0';
        }
      }
      if (url) {
        url = buildUrlWithDateRange(url);
        window.location.href = url;
      }
    }
  };

  const handleMessageBarClick = (data) => {
    if (data && data.date) {
      const dateStr = data.date;
      let startDate, endDate;

      // Parse date in EST timezone
      const dateMoment = moment.tz(dateStr, 'YYYY-MM-DD', adminTimezone);
      startDate = dateMoment.startOf('day').utc().toDate();
      endDate = dateMoment.endOf('day').utc().toDate();

      // Navigate to a relevant page with date filter (you can customize this)
      const url = `/admin/vendors?startDate=${encodeURIComponent(startDate.toISOString())}&endDate=${encodeURIComponent(endDate.toISOString())}`;
      window.location.href = url;
    }
  };

  // if (userLoading || !user) {
  //   return <LoadingSpinner />;
  // }

  if (loading || userLoading || !user) {
    return <CustomLoader />;
  }

  if (error) {
    return (
      <div className="page_content">
        <Alert variant="danger">{error}</Alert>
      </div>
    );
  }

  // Prepare data for charts - Only independent users without parent_id (excluding staff/members)
  const vendorDealerData = [
    { name: 'Agencys', value: stats?.counts?.independent_vendors || 0 },
    { name: 'Dealers', value: stats?.counts?.all_independent_dealers || 0 }
  ];

  // Use dealer-only subscription status (excluding staff with parent_id)
  const subscriptionData = [
    { name: 'Active', value: stats?.dealer_subscription_status?.active || 0 },
    { name: 'Expired', value: stats?.dealer_subscription_status?.expired || 0 },
    { name: 'None', value: stats?.dealer_subscription_status?.none || 0 }
  ];

  // User Distribution - Only independent users without parent_id (excluding staff/members)
  const userDistributionData = [
    { name: 'Agencys', value: stats?.counts?.independent_vendors || 0 },
    { name: 'Dealers', value: stats?.counts?.all_independent_dealers || 0 }
  ];

  const subscriptionOverviewData = [
    {
      name: 'Subscribed',
      vendors: stats?.counts?.subscribed_vendors || 0,
      dealers: stats?.counts?.subscribed_dealers || 0
    },
    {
      name: 'Not Subscribed',
      vendors: (stats?.counts?.independent_vendors || 0) - (stats?.counts?.subscribed_vendors || 0),
      dealers: (stats?.counts?.independent_dealers || 0) + (stats?.counts?.vendor_dealers || 0) - (stats?.counts?.subscribed_dealers || 0)
    }
  ];

  // Prepare message data for charts
  const messageTrendData = messageStats?.dailyStats || [];
  const emailCount = messageStats?.emailCount || 0;
  const smsCount = messageStats?.smsCount || 0;


  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0 me-auto">Admin Dashboard</h3>
              <div className="d-flex gap-3">
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={dateRange}
                  initialStartDate={dateRange.startDate}
                  initialEndDate={dateRange.endDate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {/* Dashboard Counts - Updated with all metrics */}
        <div className="dashboard_counts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <CountCard
              iconClass="fa-light fa-store"
              count={stats?.counts?.independent_vendors || 0}
              label="Total Agencies"
              link={buildUrlWithDateRange("/admin/vendors")}
            />

            <CountCard
              iconClass="fa-light fa-car"
              count={stats?.counts?.vendor_dealers || 0}
              label="Agency Dealers"
              link={buildUrlWithDateRange("/admin/dealers?dealer_type=vendor")}
            />

            <CountCard
              iconClass="fa-light fa-car"
              count={stats?.counts?.independent_dealers || 0}
              label="Self Dealers"
              link={buildUrlWithDateRange("/admin/dealers?dealer_type=independent")}
            />

            <CountCard
              iconClass="fa-light fa-users"
              count={stats?.counts?.staff_members || 0}
              label="Employee Members"
              link={buildUrlWithDateRange("/admin/staff")}
            />

            <CountCard
              iconClass="fa-light fa-user-check"
              count={stats?.counts?.subscribed_vendors || 0}
              label="Subscribed Agency"
              link={buildUrlWithDateRange("/admin/vendors?subscribed=1")}
            />

            <CountCard
              iconClass="fa-light fa-user-check"
              count={stats?.counts?.subscribed_dealers || 0}
              label="Subscribed Dealers"
              link={buildUrlWithDateRange("/admin/dealers?subscribed=1")}
            />

            <CountCard
              iconClass="fa-light fa-envelope"
              count={emailCount}
              label="Total Emails"
              
            />

            <CountCard
              iconClass="fa-light fa-mobile"
              count={smsCount}
              label="Total SMS"
             
            />
          </div>
        </div>

        {/* Report Cron Service Control */}
        {/* <div className="dashboard_charts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <div className="col col-12">
              <ReportCronServiceControl />
            </div>
          </div>
        </div> */}

        {/* Service Controls 
        <div className="dashboard_charts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <div className="col col-12">
              <CSVCronServiceControl />
            </div>
          </div>
        </div>

        
        <div className="dashboard_charts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <div className="col col-12">
              <CSVDataDisplay />
            </div>
          </div>
        </div>*/}
        {/* Charts - All existing plus new message trend chart */}
        <div className="dashboard_charts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <div className="col col-md-6 col-12">
              <div className="w_card">
                <h3 className="w_card_title">Agency & Dealer Distribution</h3>
                <AgencyDealerDataPie data={vendorDealerData} onPieClick={handleAgencyDealerClick} />
              </div>
            </div>
            <div className="col col-md-6 col-12">
              <div className="w_card">
                <h3 className="w_card_title">Dealer Subscription Status</h3>
                <SubscriptionStatusDataPie data={subscriptionData} onPieClick={handleSubscriptionStatusClick} />
              </div>
            </div>
            <div className="col col-md-6 col-12">
              <div className="w_card">
                <h3 className="w_card_title">User Distribution</h3>
                <UserDistributionBar data={userDistributionData} onBarClick={handleUserDistributionClick} />
              </div>
            </div>
            <div className="col col-md-6 col-12">
              <div className="w_card">
                <h3 className="w_card_title">Subscription Overview</h3>
                <SubscriptionOverviewBar data={subscriptionOverviewData} onBarClick={handleSubscriptionOverviewClick} />
              </div>
            </div>
            {/* New Message Trend Chart */}
            <div className="col col-12">
              <div className="w_card">
                <h3 className="w_card_title">Daily Message Trends</h3>
                
                {/* Custom Legend with Toggle Buttons */}
                <div className="d-flex justify-content-center mb-3 gap-2">
                  <button
                    className={`btn btn-sm ${chartVisibility.emailCount ? 'btn-custom' : 'btn-outline-custom'}`}
                    onClick={() => setChartVisibility(prev => ({ ...prev, emailCount: !prev.emailCount }))}
                  >
                    <i className={`fa-regular ${chartVisibility.emailCount ? 'fa-eye' : 'fa-eye-slash'} me-1`}></i>
                    Emails {chartVisibility.emailCount ? '(Visible)' : '(Hidden)'}
                  </button>
                  <button
                    className={`btn btn-sm ${chartVisibility.smsCount ? 'btn-secondary2' : 'btn-outline-secondary2'}`}
                    onClick={() => setChartVisibility(prev => ({ ...prev, smsCount: !prev.smsCount }))}
                  >
                    <i className={`fa-regular ${chartVisibility.smsCount ? 'fa-eye' : 'fa-eye-slash'} me-1`}></i>
                    SMS {chartVisibility.smsCount ? '(Visible)' : '(Hidden)'}
                  </button>
                </div>

                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={messageTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    {chartVisibility.emailCount && (
                      <Bar dataKey="emailCount" fill="var(--primary)" name="Emails" onClick={handleMessageBarClick} style={{ cursor: 'pointer' }} />
                    )}
                    {chartVisibility.smsCount && (
                      <Bar dataKey="smsCount" fill="var(--secondary)" name="SMS" onClick={handleMessageBarClick} style={{ cursor: 'pointer' }} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// function LoadingSpinner() {
//   return (
//     <div className="page_content">
//       <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}>
//         <Spinner animation="border" variant="dark" />
//       </div>
//     </div>
//   );
// }