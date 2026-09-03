"use client";
import { useEffect, useState } from "react";

export function useCan(permission) {
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
        const fetchPermissions = async () => {
        const token = localStorage.getItem("token");

        if (!token) {
          console.warn("No token found in localStorage");
          router.push("/admin");
          return;
        }
  
        console.log("Token from localStorage:", token); //  Debugging
  
        try {
          const res = await fetch("/api/auth/me", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });
        const data = await res.json();
        if (res.ok) {
          setHasPermission(data.permissions.includes(permission));
        }
      } catch (error) {
        console.error("Error fetching permissions:", error);
      }
    };
    fetchPermissions();
  }, [permission]);

  return hasPermission;
}
