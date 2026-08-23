"use client";
import Pagination from "../../components/Pagination";

export default function VendorList({fetchVendors, vendors, setEditVendor, currentPage, setCurrentPage, totalPages }) {
  const handleDelete = async (vendorId) => {
    const res = await fetch("/api/vendors", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId }),
    });

    if (res.ok) {
      setEditVendor(null); 
      fetchVendors();
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h3 className="text-lg font-bold text-gray-700 mb-4">Vendor List (Parent Vendors Only)</h3>
      <table className="w-full border-collapse border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-4 py-2">Name</th>
            <th className="border px-4 py-2">Email</th>
            <th className="border px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {Array.isArray(vendors) && vendors.length > 0 ? (
            vendors.map((s) => (
              <tr key={s._id} className="hover:bg-gray-50">
                <td className="border px-4 py-2">{s.name}</td>
                <td className="border px-4 py-2">{s.email}</td>
                <td className="border px-4 py-2">
                  <button onClick={() => setEditVendor(s)} className="px-3 py-1 text-white bg-yellow-500 hover:bg-yellow-600 rounded-lg mr-2">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(s._id)} className="px-3 py-1 text-white bg-red-600 hover:bg-red-700 rounded-lg">
                    Delete
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="3" className="text-center text-gray-500 py-4">
                No parent vendors found.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Pagination currentPage={currentPage} setCurrentPage={setCurrentPage} totalPages={totalPages} />
    </div>
  );
}
