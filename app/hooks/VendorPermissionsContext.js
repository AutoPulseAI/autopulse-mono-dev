"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const VendorPermissionsContext = createContext();

export function VendorPermissionsProvider({ children }) {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      const token = localStorage.getItem("vendortoken");
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok) {
          setPermissions(data.permissions || []);
        }
      } catch (error) {
        console.error("Error fetching permissions:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchPermissions();
  }, []);
  console.log(permissions);
  return (
    <VendorPermissionsContext.Provider value={{ permissions, loading }}>
      {children}
    </VendorPermissionsContext.Provider>
  );
}

export function useCan(permission) {
  const { permissions, loading } = useContext(VendorPermissionsContext);

  if (loading) return false; // or you might want to return null/loading state

  return permissions.includes(permission);
}