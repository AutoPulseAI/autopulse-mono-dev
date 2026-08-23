"use client";
import { useState, useEffect } from "react";
import { useUser } from "../context/UserContext";
import useFetch from "../../hooks/useFetch";
import { Card, Row, Col, Spinner, Alert, Form } from "react-bootstrap";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import DateRangePickerComponent from "../components/DateRangePicker";
import CountCard from "./components/CountCard";
import LineChartProgress from "./components/LineChartProgress";
import BarChartProgress from "./components/BarChartProgress";

export default function VendorDashboard() {
  const { user, loading: userLoading } = useUser();
  const { fetchData } = useFetch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [leadStats, setLeadStats] = useState(null);
  const [communicationData, setCommunicationData] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [selectedDealer, setSelectedDealer] = useState("all");
  const [dateRange, setDateRange] = useState({ startDate: null, endDate: null });
  // const [dateRange, setDateRange] = useState({
  //   startDate: new Date(new Date().setDate(new Date().getDate() - 30)),
  //   endDate: new Date()
  // });

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

  // Fetch all dealers under this vendor
  const fetchVendorDealers = async () => {
    try {
      const res = await fetchData(`/api/users/dealers?vendor_id=${user.id}`,{headers: {
        'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
      }});
      if (!res.ok) throw new Error('Failed to fetch dealers');
      const data = await res.json();
      setDealers(data.dealers);
    } catch (err) {
      console.error("Failed to fetch dealers:", err);
    }
  };

  const fetchDashboardData = async (startDate, endDate, dealerId = null) => {
    try {
      if (!user?.id) return;
      setLoading(true);
      setError(null);

      let queryParams = `vendor_id=${user.id}`;
      if (dealerId && dealerId !== "all") {
        queryParams += `&dealer_id=${dealerId}`;
      }
      if (startDate && endDate) {
        queryParams += `&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
      }

      const [statsRes, commRes] = await Promise.all([
        fetchData(`/api/leads/vendor-stats?${queryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }}),
        fetchData(`/api/conversations/vendor-stats?${queryParams}&limit=50`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }})
      ]);

      if (!statsRes.ok) throw new Error('Failed to fetch lead statistics');
      if (!commRes.ok) throw new Error('Failed to fetch communications');

      const statsData = await statsRes.json();
      const commData = await commRes.json();

      setLeadStats(statsData);
      setCommunicationData(commData);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.type === "vendor") {
      fetchVendorDealers();
      fetchDashboardData(dateRange.startDate, dateRange.endDate);
    }
  }, [user]);

  useEffect(() => {
    if (user?.type === "vendor") {
      fetchDashboardData(
        dateRange.startDate,
        dateRange.endDate,
        selectedDealer === "all" ? null : selectedDealer
      );
    }
  }, [dateRange, selectedDealer]);

  const handleDateRangeChange = ({ startDate, endDate }) => {
    setDateRange({ startDate, endDate });
  };

  const handleDealerChange = (e) => {
    setSelectedDealer(e.target.value);
  };

  if (userLoading || !user) {
    return (
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}>
          <Spinner animation="border" variant="dark" />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}>
          <Spinner animation="border" variant="dark" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page_content">
        <Alert variant="danger">{error}</Alert>
      </div>
    );
  }

  // Prepare data for charts - Group lead sources by case-insensitive matching
  const leadSourceData = (() => {
    if (!leadStats?.sources) return [];
    
    const sourceMap = new Map();
    
    leadStats.sources.forEach(source => {
      const originalName = source._id || 'Unknown';
      const normalizedName = originalName.toLowerCase().trim();
      const count = source.count || 0;
      
      if (count > 0) {
        if (sourceMap.has(normalizedName)) {
          // If we already have this source (case-insensitive), add the counts
          const existing = sourceMap.get(normalizedName);
          existing.value += count;
          // Keep the original name with proper capitalization if it exists
          if (originalName !== 'Unknown' && originalName !== originalName.toLowerCase()) {
            existing.name = originalName;
          }
        } else {
          // New source
          sourceMap.set(normalizedName, {
            name: originalName,
            value: count
          });
        }
      }
    });
    
    return Array.from(sourceMap.values()).sort((a, b) => b.value - a.value);
  })();

  // Group lead statuses by case-insensitive matching
  const leadStatusData = (() => {
    if (!leadStats?.statuses) return [];
    
    const statusMap = new Map();
    
    leadStats.statuses.forEach(status => {
      const originalName = status._id || 'Unknown';
      const normalizedName = originalName.toLowerCase().trim();
      const count = status.count || 0;
      
      if (count > 0) {
        if (statusMap.has(normalizedName)) {
          const existing = statusMap.get(normalizedName);
          existing.value += count;
          if (originalName !== 'Unknown' && originalName !== originalName.toLowerCase()) {
            existing.name = originalName;
          }
        } else {
          statusMap.set(normalizedName, {
            name: originalName,
            value: count
          });
        }
      }
    });
    
    return Array.from(statusMap.values()).sort((a, b) => b.value - a.value);
  })();

  // Group communication types by case-insensitive matching
  const communicationTypesData = (() => {
    if (!leadStats?.communication_types) return [];
    
    const typeMap = new Map();
    
    leadStats.communication_types.forEach(type => {
      const originalName = type._id || 'Unknown';
      const normalizedName = originalName.toLowerCase().trim();
      const count = type.count || 0;
      
      if (count > 0) {
        if (typeMap.has(normalizedName)) {
          const existing = typeMap.get(normalizedName);
          existing.value += count;
          if (originalName !== 'Unknown' && originalName !== originalName.toLowerCase()) {
            existing.name = originalName;
          }
        } else {
          typeMap.set(normalizedName, {
            name: originalName,
            value: count
          });
        }
      }
    });
    
    return Array.from(typeMap.values()).sort((a, b) => b.value - a.value);
  })();

  const activityOverTimeData = leadStats?.activity_over_time?.map(item => ({
    date: item._id,
    count: item.count
  })) || [];

  const dealerPerformanceData = leadStats?.dealer_performance?.map(dealer => ({
    name: dealer.dealer_name,
    leads: dealer.lead_count,
    converted: dealer.converted_count
  })) || [];

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0 me-auto text-nowrap">Agency Dashboard</h3>
              <div className="d-flex gap-1">
                <Form.Select
                  value={selectedDealer}
                  onChange={handleDealerChange}
                  size="sm"
                >
                  <option value="all">All Dealers</option>
                  {dealers.map(dealer => (
                    <option key={dealer._id} value={dealer._id}>
                      {dealer.name}
                    </option>
                  ))}
                </Form.Select>
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={dateRange}
                  initialStartDate={null}
                  initialEndDate={null}
                // onChange={handleDateRangeChange}
                // initialStartDate={dateRange.startDate}
                // initialEndDate={dateRange.endDate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {/* Dashboard Counts */}
        <div className="dashboard_counts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">

            <CountCard
              iconClass="fa-light fa-users"
              count={leadStats?.total_dealers || dealers.length || 0}
              label="Total Dealers"
              link="#"
            />

            <CountCard
              iconClass="fa-light fa-magnet"
              count={leadStats?.total_leads || 0}
              label="Total Leads"
              link="#"
            />

            <CountCard
              iconClass="fa-light fa-user"
              count={leadStats?.active_dealers || 0}
              label="Total Appoinment Booked"
              link="#"
            />

            <CountCard
              iconClass="fa-light fa-calendar-range"
              count={leadStats?.converted || 0}
              label="Total Subscription Amount"
              link="#"
            />

          </div>
        </div>

        {/* Charts */}
        <div className="dashboard_charts">
          <div className="row gx-2 gx-xxl-4 gx-xl-3">
            <div className="col col-lg-6 col-12">
              <div className="w_card">
                <h3 className="w_card_title">Monthly Trend Data</h3>
                <LineChartProgress />
              </div>
            </div>
            <div className="col col-lg-6 col-12">
              <div className="w_card">
                <h3 className="w_card_title">Monthly Aggregated Data</h3>
                <BarChartProgress />
              </div>
            </div>
          </div>
        </div>

        {/* <Row className="mb-4">
          <Col md={6} className="mb-4">
            <Card className="shadow-sm h-100">
              <Card.Body>
                <Card.Title>Lead Sources</Card.Title>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={leadSourceData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {leadSourceData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card.Body>
            </Card>
          </Col>

          <Col md={6} className="mb-4">
            <Card className="shadow-sm h-100">
              <Card.Body>
                <Card.Title>Dealer Performance</Card.Title>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dealerPerformanceData}
                      margin={{
                        top: 5,
                        right: 30,
                        left: 20,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="leads" fill="#8884d8" name="Total Leads" />
                      <Bar dataKey="converted" fill="#82ca9d" name="Converted" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row> */}

        {/* <Row className="mb-4">
          <Col md={6} className="mb-4">
            <Card className="shadow-sm h-100">
              <Card.Body>
                <Card.Title>Communication Types</Card.Title>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={communicationTypesData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {communicationTypesData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card.Body>
            </Card>
          </Col>

          <Col md={6} className="mb-4">
            <Card className="shadow-sm h-100">
              <Card.Body>
                <Card.Title>Lead Activity Over Time</Card.Title>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={activityOverTimeData}
                      margin={{
                        top: 5,
                        right: 30,
                        left: 20,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#82ca9d" name="Leads" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row> */}
      </div>
    </div>
  );
}