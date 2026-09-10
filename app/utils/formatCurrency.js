// Utility function to format a dollar amount consistently across the
// Dealer 360 customer view (header value snapshot, Sales/Service tabs).
export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
};
