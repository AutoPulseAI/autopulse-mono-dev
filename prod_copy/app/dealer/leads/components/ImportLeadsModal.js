// components/Leads/ImportLeadsModal.js
"use client";
import { useState, useRef, useEffect } from "react";
import { Modal, Button, Form, Alert, ProgressBar, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

export default function ImportLeadsModal({ show, onHide, onSuccess }) {
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef(null);
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent || user;

  useEffect(() => {
    // Check if dealerParent data is loaded
    if (activeEntity?.id) {
      setIsInitializing(false);
    }
  }, [activeEntity]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type === "text/csv" || selectedFile.name.endsWith(".csv")) {
        setFile(selectedFile);
        setError("");
      } else {
        setError("Please select a valid CSV file.");
        setFile(null);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !activeEntity?.id) return;

    setIsLoading(true);
    setProgress(0);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('dealer_id', activeEntity.id); // Add dealer_id to form data

      const response = await fetch("/api/leads/import", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import CSV");
      }

      setSuccess(`CSV import started. ${data.stats.processed} leads queued for processing.`);
      onSuccess();
    } catch (err) {
      console.error("Error during import:", err);
      setError(err.message || "An unexpected error occurred during import.");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setError("");
    setSuccess("");
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    resetForm();
    onHide();
  };

  if (isInitializing) {
    return (
      <Modal show={show} onHide={handleClose} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Import Leads from CSV</Modal.Title>
        </Modal.Header>
        <Modal.Body className="text-center py-4">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading dealer information...</span>
          </Spinner>
          <p className="mt-2">Loading dealer information...</p>
        </Modal.Body>
      </Modal>
    );
  }

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Import Leads from CSV</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>CSV File</Form.Label>
            <Form.Control
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              ref={fileInputRef}
              disabled={isLoading}
              required
            />
            <Form.Text className="text-muted">
              CSV should include columns for: name, email, phone, make, model, year, vin, comments
              <a href="/csv/lead.csv" download target="_blank" rel="noopener noreferrer">
                Download Sample CSV
              </a>
            </Form.Text>
          </Form.Group>

          {isLoading && (
            <div className="mb-3">
              <ProgressBar now={progress} label={`${progress}%`} />
              <div className="text-center mt-2">Processing CSV file...</div>
            </div>
          )}

          <div className="mb-3">
            <h5>CSV Format Example:</h5>
            <div className="bg-light p-2 rounded">
              <pre className="mb-0">
                name,email,phone,make,model,year,vin,comments<br />
                John Doe,john@example.com,5551234567,Toyota,Camry,2022,1HGBH41JXMN109186,Interested in test drive<br />
                Jane Smith,jane@example.com,,Honda,Accord,2021,,Looking for financing options<br />
                Bob Johnson,,5559876543,Ford,F-150,2020,1FTFW1ET8EFC12345,"Trade-in available, needs appraisal"
              </pre>
            </div>
          </div>

          <div className="d-flex justify-content-end gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button 
              variant="custom" 
              type="submit" 
              disabled={!file || isLoading}
            >
              {isLoading ? "Importing..." : "Import Leads"}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
}