// Which customer list the user opened a customer from (the Customers page's filters and page), kept per browser tab,
// so the list beside the profile shows that same list. Small on purpose: the Customers page imports it.
export const CUSTOMER_LIST_KEY = "customerListQuery";

export function rememberCustomerList(query, page) {
  try { sessionStorage.setItem(CUSTOMER_LIST_KEY, JSON.stringify({ query, page })); } catch { /* the side list starts at page 1 */ }
}

export function keptCustomerList() {
  try { return JSON.parse(sessionStorage.getItem(CUSTOMER_LIST_KEY) || "null") || { query: "", page: 1 }; } catch { return { query: "", page: 1 }; }
}
