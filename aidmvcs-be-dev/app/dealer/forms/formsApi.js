// Calls to the Forms Library APIs (app/api/forms), with the dealer sign-in.
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export async function formsGet(path) {
  const res = await fetch(path, { headers: auth() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

export async function formsSend(path, method, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(path, { method, headers: isForm ? auth() : { ...auth(), "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Request failed (${res.status})`), { data });
  return data;
}

// A PDF from the API, opened in a new tab (print = the browser's print dialog there) or saved.
export async function openPdf(path, { method = "GET", body, download = null } = {}) {
  const res = await fetch(path, { method, headers: body ? { ...auth(), "Content-Type": "application/json" } : auth(),
    body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not open the PDF (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  if (download) {
    const a = document.createElement("a");
    a.href = url; a.download = download; a.click();
  } else {
    window.open(url, "_blank", "noopener");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
