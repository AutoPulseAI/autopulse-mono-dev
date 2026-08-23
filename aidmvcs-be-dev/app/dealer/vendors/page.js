"use client";
import { useState, useEffect } from "react";
import VendorForm from "./components/VendorForm";
import VendorList from "./components/VendorList";

export default function VendorManagement() {
  const [vendors, setVendors] = useState([]);
  const [editVendor, setEditVendor] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchVendors = async () => {
    try {
      const vendorRes = await fetch(`/api/vendors?page=${currentPage}`);
      const vendorData = await vendorRes.json();

      if (vendorData && Array.isArray(vendorData.vendors)) {
        setVendors(vendorData.vendors);
        setTotalPages(vendorData.totalPages || 1);
      }
    } catch (error) {
      console.error("Error fetching vendors:", error);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, [currentPage]);

  return (
    <div className="container mx-auto p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Vendor Management</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <VendorForm fetchVendors={fetchVendors} setEditVendor={setEditVendor} editVendor={editVendor} />
        <VendorList fetchVendors={fetchVendors} vendors={vendors} setEditVendor={setEditVendor} currentPage={currentPage} setCurrentPage={setCurrentPage} totalPages={totalPages} />
      </div>
    </div>
  );
}
