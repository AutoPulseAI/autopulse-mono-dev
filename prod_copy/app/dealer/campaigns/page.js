"use client";
import { useState, Suspense } from "react";
import CampaignForm from "./components/CampaignForm";
import CampaignList from "./components/CampaignList";
import { Button, Spinner } from "react-bootstrap";

export default function CampaignManagement() {
  const [editCampaign, setEditCampaign] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'create', 'list', 'view'
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCampaignSaved = () => {
    setEditCampaign(null);
    setViewMode('list');
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                {viewMode !== 'list' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className="me-2"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )}
                <h3 className="page_title mb-0">Campaigns</h3>
              </div>

              {viewMode === 'list' && (
                <Button
                  variant="custom"
                  size="sm"
                  onClick={() => {
                    setEditCampaign(null);
                    setViewMode('create');
                  }}
                >
                  <i className="fa-solid fa-plus me-1"></i>Create New Campaign
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Suspense fallback={<div className="loader_in_main text-center flex-column">
          <div className="spinner-border text-dark" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>}>
          {viewMode === 'create' || editCampaign ? (
            <CampaignForm 
              setEditCampaign={setEditCampaign} 
              editCampaign={editCampaign}
              onSuccess={handleCampaignSaved}
              onCancel={() => {
                setEditCampaign(null);
                setViewMode('list');
              }}
            />
          ) : (            
            <CampaignList 
              refreshKey={refreshKey}
              onCreate={() => {
                setEditCampaign(null);
                setViewMode('create');
              }}
              onEdit={(campaign) => {
                setEditCampaign(campaign);
                setViewMode('create');
              }}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}

