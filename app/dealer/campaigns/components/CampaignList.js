"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Table, Button, Badge, Spinner, Alert, Pagination, OverlayTrigger, Tooltip, Modal, ListGroup, Row, Col } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { formatTimestamp } from "../../../utils/dateUtils";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

const statusVariantMap = {
  draft: "secondary",
  scheduled: "custom",
  active: "success",
  completed: "info",
  cancelled: "danger"
};


const CampaignList = ({ onCreate, onEdit, refreshKey = 0 }) => {
  const router = useRouter();
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent || user;

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dealerTimezone, setDealerTimezone] = useState("America/New_York");
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10
  });
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch dealer timezone
  useEffect(() => {
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
    fetchDealerTimezone();
  }, [activeEntity]);

  const fetchCampaigns = useCallback(async (page = 1) => {
    if (!activeEntity?.id) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/campaigns?dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch campaigns");
      }

      setCampaigns(data.data || []);
      setPagination({
        currentPage: data.pagination?.currentPage || page,
        totalPages: data.pagination?.totalPages || 1,
        totalItems: data.pagination?.totalItems || 0,
        itemsPerPage: data.pagination?.itemsPerPage || 10
      });
    } catch (err) {
      console.error("Error fetching campaigns:", err);
      setError(err.message || "Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, pagination.itemsPerPage]);

  useEffect(() => {
    if (activeEntity?.id) {
      fetchCampaigns(1);
    }
  }, [activeEntity?.id, fetchCampaigns, refreshKey]);

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > pagination.totalPages) return;
    fetchCampaigns(newPage);
  };

  const confirmDelete = (campaign) => {
    setCampaignToDelete(campaign);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!campaignToDelete) return;

    setDeleting(true);
    try {
      const token = localStorage.getItem('dealertoken');
      const response = await fetch(`/api/campaigns/${campaignToDelete._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete campaign');
      }

      // Close modal and refresh list
      setShowDeleteModal(false);
      setCampaignToDelete(null);
      await fetchCampaigns(pagination.currentPage);
    } catch (err) {
      console.error('Error deleting campaign:', err);
      setError(err.message || 'Failed to delete campaign');
    } finally {
      setDeleting(false);
    }
  };

  // const handleDeleteCancel = () => {
  //   setShowDeleteModal(false);
  //   setCampaignToDelete(null);
  // };

  const canEditCampaign = (campaign) => {
    // Cannot edit if any messages have been sent (MOST IMPORTANT CHECK)
    if (campaign.stats?.sent > 0) {
      return false;
    }
    
    // Cannot edit if campaign status is completed
    if (campaign.status === 'completed') {
      return false;
    }
    
    // Allow edit if status is "active" but no messages sent yet
    // (This happens when cron sets status to active but worker hasn't started)
    if (campaign.status === 'active' && campaign.stats?.sent === 0) {
      return true; // Allow editing - campaign queued but not started
    }
    
    // Cannot edit if status is active and messages have been sent
    if (campaign.status === 'active') {
      return false;
    }
    
    return true; // Draft and scheduled campaigns can be edited
  };

  // Check if campaign can be deleted
  const canDeleteCampaign = (campaign) => {
    // Cannot delete if any messages have been sent (MOST IMPORTANT CHECK)
    if (campaign.stats?.sent > 0) {
      return false;
    }
    
    // Cannot delete if campaign status is completed
    if (campaign.status === 'completed') {
      return false;
    }
    
    // Allow delete if status is "active" but no messages sent yet
    // (This happens when cron sets status to active but worker hasn't started)
    if (campaign.status === 'active' && campaign.stats?.sent === 0) {
      return true; // Allow deleting - campaign queued but not started
    }
    
    // Cannot delete if status is active and messages have been sent
    if (campaign.status === 'active') {
      return false;
    }
    
    return true; // Draft and scheduled campaigns can be deleted
  };

  // Handle showing campaign report
  const handleShowReport = (campaign) => {
    router.push(`/dealer/campaigns/${campaign._id}/report`);
  };

  // Format date in dealer timezone
  const formatDateInDealerTimezone = (utcDate) => {
    if (!utcDate) return "Not Scheduled";
    try {
      const date = new Date(utcDate);
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: dealerTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return formatter.format(date);
    } catch (err) {
      return formatTimestamp(utcDate);
    }
  };

  // Determine campaign execution status
  const getCampaignExecutionStatus = (campaign) => {
    // If campaign has been sent, it's executed
    if (campaign.stats?.sent > 0) {
      return { status: "executed", variant: "success" };
    }

    // Check actual_scheduled_date (UTC) for execution status
    if (!campaign.actual_scheduled_date) {
      return { status: "pending", variant: "warning" };
    }

    const now = new Date();
    const scheduledDate = new Date(campaign.actual_scheduled_date);
    const diffMs = scheduledDate.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // If scheduled time is in the past (more than 1 hour ago), consider it executed
    if (diffHours < -1) {
      return { status: "executed", variant: "success" };
    }

    // If scheduled time is within the next hour or just passed (within last hour), it's running
    if (diffHours >= -1 && diffHours <= 1) {
      return { status: "running", variant: "info" };
    }

    // Otherwise, it's pending
    return { status: "pending", variant: "warning" };
  };

  if (loading) {
    return (
      <div className="loader_in_main text-center flex-column">
          <div className="spinner-border text-dark" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
    );
  }

  if (error) {
    return (
      <Alert variant="danger">
        {error}
        <div className="mt-2">
          <Button size="sm" variant="outline-danger" onClick={() => fetchCampaigns(pagination.currentPage)}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-4 text-muted">
        No campaigns found.{" "}
        <Button variant="link" size="sm" className="p-0" onClick={onCreate}>
          Create your first campaign
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="w_card">
        <h3 className="w_card_title">Campaign List</h3>                

        <div className="w_card_list">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" className="w_card_list_head border-bottom-0">
              <Row className="align-items-center w-100 g-0 gx-1">
                <Col xl={10} lg={9} sm={9} xs={12}>
                  <Row className="align-items-center gx-2">
                    <Col xl={4} lg={3} sm={3} xs={12}>
                      <p className="label"><small>Name</small></p>
                    </Col>
                    <Col xl={1} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Type</small></p>
                    </Col>
                    <Col xl={4} lg={3} sm={3} xs={12}>
                      <p className="label"><small>Scheduled For</small></p>
                    </Col>
                    <Col xl={1} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Reach</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Execution</small></p>
                    </Col>
                    
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="label"><small>Status</small></p>
                </Col>
                <Col xl={1} lg={2} sm={2} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {campaigns.map((campaign) => {
              const editable = canEditCampaign(campaign);
              const deletable = canDeleteCampaign(campaign);
              const scheduledDate = formatDateInDealerTimezone(campaign.scheduled_date);
              const executionStatus = getCampaignExecutionStatus(campaign);
              const templatePreview = campaign.message_content?.body
                ? `${campaign.message_content.body.slice(0, 60)}${campaign.message_content.body.length > 60 ? "..." : ""}`
                : "—";

              return (
                <ListGroup.Item as="li" key={campaign._id} className={`lead-item w_card_list_box d-flex align-items-center`}>
                  <Row className="align-items-center w-100 g-0 gx-1">
                    <Col xl={10} lg={9} sm={9} xs={12} className="mb-1 mb-md-0">
                      <Row className="align-items-center gx-2">
                        <Col xl={4} lg={3} sm={3} xs={12}>
                          <p className="p_bold">{campaign.name || "N/A"}</p>
                          <p><small className="text-muted">Created {formatTimestamp(campaign.createdAt)}</small></p>
                        </Col>
                        <Col xl={1} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Type:</small></p>
                            <p className="text-truncate text-capitalize">{campaign.message_type || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={4} lg={3} sm={3} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Scheduled For:</small></p>
                            <p className="text-truncate">{scheduledDate || "N/A"}</p>
                            {campaign.actual_scheduled_date && (() => {
                              const utcDate = new Date(campaign.actual_scheduled_date);
                              const utcDateStr = `${String(utcDate.getUTCDate()).padStart(2, '0')}/${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}/${utcDate.getUTCFullYear()}`;
                              const utcTimeStr = `${String(utcDate.getUTCHours()).padStart(2, '0')}:${String(utcDate.getUTCMinutes()).padStart(2, '0')}:${String(utcDate.getUTCSeconds()).padStart(2, '0')}`;
                              return (
                                <small className="text-muted d-block" style={{ fontSize: '0.8em' }}>
                                  (Server time: {utcDateStr}, {utcTimeStr} UTC)
                                </small>
                              );
                            })()}
                          </div>
                        </Col>
                        <Col xl={1} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Leads:</small></p>
                            <p className="text-truncate">{campaign.stats?.total_leads || campaign.leads?.length || 0}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Execution:</small></p>
                            <Badge bg={executionStatus.variant} className="text-capitalize">
                              {executionStatus.status}
                            </Badge>
                            {campaign.stats && (
                              <div className="mt-1">
                                <small className="text-muted">
                                  Sent: {campaign.stats.sent || 0} / {campaign.stats.total_leads || 0}
                                </small>
                              </div>
                            )}
                          </div>
                        </Col>
                        
                      </Row>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={7}>
                      <Badge
                        bg={statusVariantMap[campaign.status] || "secondary"}
                        className="text-wrap text-capitalize"
                      >
                        {campaign.status || "draft"}
                      </Badge>
                    </Col>
                    <Col xl={1} lg={2} sm={2} xs={5}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button 
                          variant="custom" 
                          size="sm" 
                          onClick={() => handleShowReport(campaign)}
                          title="Show Campaign Report"
                        >
                          <i className="fa-regular fa-chart-bar"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={() => onEdit?.(campaign)}
                        disabled={!editable}>
                          {editable ? (
                            <>
                              <i className="fa-regular fa-pen-to-square"></i>
                            </>
                          ) : (
                            <>
                              <i className="fa-regular fa-lock"></i>
                            </>
                          )}
                        </Button>
                        {deletable ? (
                          <Button variant="danger" size="sm" onClick={() => confirmDelete(campaign)}
                          disabled={deleting}>
                            <i className="fa-regular fa-trash"></i>
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" disabled title="Cannot delete active or completed campaigns">
                            <i className="fa-regular fa-ban"></i>
                          </Button>
                        )}
                      </div>
                     
                    </Col>
                  </Row>
                </ListGroup.Item>
              );
            })}
          </ListGroup>

          {pagination.totalPages > 1 && (
            <div className="d-flex justify-content-center mt-3">
              <Pagination className="mb-md-0 justify-content-center flex-wrap">
                <Pagination.Prev
                  onClick={() => handlePageChange(pagination.currentPage - 1)}
                  disabled={pagination.currentPage === 1}
                />
                <Pagination.Item active>
                  Page {pagination.currentPage} of {pagination.totalPages}
                </Pagination.Item>
                <Pagination.Next
                  onClick={() => handlePageChange(pagination.currentPage + 1)}
                  disabled={pagination.currentPage === pagination.totalPages}
                />
              </Pagination>
            </div>
          )}
        </div>
      </div>

      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Campaign?"
        body={
            <>
              Are you sure you want to delete the campaign{" "}
              <strong>{campaignToDelete?.name}</strong>?
              <small className="d-block mt-1 text-muted">This action cannot be undone. All associated campaign leads will also be deleted.</small>
            </>
          }
      />
    </>
  );
};

export default CampaignList;

