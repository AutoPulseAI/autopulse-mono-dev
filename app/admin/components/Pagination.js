"use client";

import { Pagination } from "react-bootstrap";

export default function PaginationComponent({ currentPage, setCurrentPage, totalPages }) {
  if (totalPages <= 1) return null; // Hide pagination if only one page

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="d-flex justify-content-center mt-3">
      <Pagination>
        <Pagination.Prev
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
        />

        {[...Array(totalPages)].map((_, i) => (
          <Pagination.Item
            key={i}
            active={currentPage === i + 1}
            onClick={() => goToPage(i + 1)}
          >
            {i + 1}
          </Pagination.Item>
        ))}

        <Pagination.Next
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
        />
      </Pagination>
    </div>
  );
}
