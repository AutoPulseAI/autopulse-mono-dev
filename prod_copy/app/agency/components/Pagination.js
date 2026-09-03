"use client";

export default function Pagination({ currentPage, setCurrentPage, totalPages }) {
  if (totalPages <= 1) return null; // Hide pagination if only one page

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="flex justify-center space-x-2 mt-4">
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        className={`px-4 py-2 border rounded ${currentPage === 1 ? "bg-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
      >
        Prev
      </button>

      {[...Array(totalPages)].map((_, i) => (
        <button
          key={i}
          onClick={() => goToPage(i + 1)}
          className={`px-4 py-2 border rounded ${currentPage === i + 1 ? "bg-blue-600 text-white" : "bg-gray-200 hover:bg-gray-300"}`}
        >
          {i + 1}
        </button>
      ))}

      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={`px-4 py-2 border rounded ${currentPage === totalPages ? "bg-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
      >
        Next
      </button>
    </div>
  );
}
