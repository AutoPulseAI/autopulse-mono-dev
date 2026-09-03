// "use client";
// import { Pagination as BSPagination } from 'react-bootstrap';

// export default function Pagination({ currentPage, totalPages, hasNextPage, hasPreviousPage, setCurrentPage }) {
//   // Determine start and end pages for a max of 5 links
//   let start = Math.max(1, currentPage - 2);
//   let end = Math.min(totalPages, start + 4);
//   if (end - start < 4) {
//     start = Math.max(1, end - 4);
//   }

//   const items = [];
//   for (let page = start; page <= end; page++) {
//     items.push(
//       <BSPagination.Item
//         key={page}
//         active={page === currentPage}
//         onClick={() => setCurrentPage(page)}
//       >
//         {page}
//       </BSPagination.Item>
//     );
//   }

//   return (
//     <BSPagination className="justify-content-center">
//       <BSPagination.Prev
//         disabled={!hasPreviousPage}
//         onClick={() => hasPreviousPage && setCurrentPage(currentPage - 1)}
//       />
//       {start > 1 && <BSPagination.Ellipsis disabled />}
//         {items}
//       {end < totalPages && <BSPagination.Ellipsis disabled />}
//       <BSPagination.Next
//         disabled={!hasNextPage}
//         onClick={() => hasNextPage && setCurrentPage(currentPage + 1)}
//       />
//     </BSPagination>
//   );
// }

"use client";

import { Pagination } from "react-bootstrap";

export default function PaginationComponent({ currentPage, setCurrentPage, totalPages }) {
  if (totalPages <= 1) return null; // Hide pagination if only one page

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Helper to generate page numbers (with ellipsis if needed)
  const getPageItems = () => {
    const pageItems = [];
    const delta = 1; // number of pages to show before and after current
    const range = [];
    const left = Math.max(2, currentPage - delta);
    const right = Math.min(totalPages - 1, currentPage + delta);

    range.push(1); // always show first page

    if (left > 2) {
      range.push("ellipsis-left");
    }

    for (let i = left; i <= right; i++) {
      range.push(i);
    }

    if (right < totalPages - 1) {
      range.push("ellipsis-right");
    }

    if (totalPages > 1) {
      range.push(totalPages); // always show last page
    }

    return range;
  };

  return (
    <div className="d-flex justify-content-center mt-3">
      <Pagination>
        <Pagination.First
          onClick={() => goToPage(1)}
          disabled={currentPage === 1}
        />
        <Pagination.Prev
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
        />

        {getPageItems().map((item, index) => {
          if (item === "ellipsis-left" || item === "ellipsis-right") {
            return <Pagination.Ellipsis key={item + index} disabled />;
          } else {
            return (
              <Pagination.Item
                key={item}
                active={currentPage === item}
                onClick={() => goToPage(item)}
              >
                {item}
              </Pagination.Item>
            );
          }
        })}

        <Pagination.Next
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage === totalPages}
        />
        <Pagination.Last
          onClick={() => goToPage(totalPages)}
          disabled={currentPage === totalPages}
        />
      </Pagination>
    </div>
  );
}
