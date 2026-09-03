"use client";
import { useState, useEffect } from "react";

export default function VendorForm({ fetchVendors, setEditVendor, editVendor }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});

  //  Properly update form fields when editing
  useEffect(() => {
    if (editVendor) {
      setName(editVendor.name || "");
      setEmail(editVendor.email || "");
    } else {
      setName("");
      setEmail("");
      setPassword("");
    }
  }, [editVendor]); //  Trigger update when editVendor changes

  const validateForm = () => {
    let newErrors = {};
    if (!name.trim()) newErrors.name = "Name is required.";
    if (!email.trim()) newErrors.email = "Email is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!validateForm()) return;

    const payload = {
      name,
      email,
      password: editVendor ? undefined : password, 
      type: "vendor",
    };

    const method = editVendor ? "PUT" : "POST";
    const url = "/api/vendors";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editVendor ? { ...payload, vendorId: editVendor._id } : payload),
    });

    const data = await res.json();

    if (res.ok) {
      setMessage(editVendor ? "Vendor updated!" : "Vendor added!");

      //  Fetch updated vendors instead of manually modifying state
      fetchVendors();

      // Clear form fields
      setName("");
      setEmail("");
      setPassword("");
      setEditVendor(null);
    } else {
      setMessage(data.message);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h3 className="text-lg font-bold text-gray-700 mb-4">{editVendor ? "Edit Vendor" : "Add Vendor"}</h3>
      {message && <p className="text-green-600 text-sm">{message}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-gray-700 font-medium">Name</label>
          <input 
            type="text" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            required 
            className="w-full px-3 py-2 border rounded-md"
          />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-gray-700 font-medium">Email</label>
          <input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="w-full px-3 py-2 border rounded-md"
          />
          {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
        </div>
        {!editVendor && (
          <div>
            <label className="block text-gray-700 font-medium">Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        )}


        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg">
          {editVendor ? "Update" : "Add"}
        </button>
      </form>
    </div>
  );
}
