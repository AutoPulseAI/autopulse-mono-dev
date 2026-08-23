"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const AdminPermissionsContext = createContext();

export function AdminPermissionsProvider({ children }) {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPermissions = async () => {
      const token = localStorage.getItem("token");
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
    <AdminPermissionsContext.Provider value={{ permissions, loading }}>
      {children}
    </AdminPermissionsContext.Provider>
  );
}

export function useCan(permission) {
  const { permissions, loading } = useContext(AdminPermissionsContext);

  if (loading) return false; // or you might want to return null/loading state

  return permissions.includes(permission);
}