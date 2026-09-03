// context/UserContext.js
import { createContext, useContext, useState, useEffect } from "react";

// Create the context
const UserContext = createContext();

// Create the provider component
export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [dealerParent, setDealerParent] = useState(null);
  const [loadingParent, setLoadingParent] = useState(false);

  // Fetch user data on initial load (client-side only)
  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("vendortoken");

      if (!token) {
        console.warn("No token found in localStorage");
        return;
      }

      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json();

        if (res.ok) {
          setUser(data);
          // If user has parent_id, fetch parent details
          const parentId = data?.parent_id;
        
          if (parentId !== null && parentId !== undefined) {
           
            await fetchParentDetails(parentId, token);
          } else {
            // If no parent_id, set user as dealer parent
            setDealerParent(data);
           
          }
        } else {
          
        }
      } catch (error) {
        console.error("Error fetching user:", error);
      }
    };

    fetchUser();
  }, []);

  // Function to fetch parent details
  const fetchParentDetails = async (parentId, token) => {
    
    setLoadingParent(true);
    try {
      const res = await fetch(`/api/dealers/profile?dealer_id=${parentId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        
      });

      const data = await res.json();

      if (res.ok) {
        setDealerParent(data);
      } else {
        console.error("Failed to fetch parent:", data.message);
        // Fallback to current user if parent fetch fails
        setDealerParent(user);
      }
    } catch (error) {
      console.error("Error fetching parent:", error);
      // Fallback to current user if parent fetch fails
      setDealerParent(user);
    } finally {
      setLoadingParent(false);
    }
  };

  // Function to update the user
  const updateUser = (updatedUser) => {
    setUser(updatedUser);
    // If updated user has no parent_id, set as dealer parent
    if (!updatedUser.parent_id) {
      setDealerParent(updatedUser);
    } else if (updatedUser.parent_id !== user?.parent_id) {
      // If parent_id changed, fetch new parent details
      const token = localStorage.getItem("vendortoken");
      fetchParentDetails(updatedUser.parent_id, token);
    }
  };

  // Function to explicitly update dealer parent
  const updateDealerParent = (newParentData) => {
    setDealerParent(newParentData);
  };

  // Function to log out the user
  const logout = () => {
    localStorage.removeItem("vendortoken");
    setUser(null);
    setDealerParent(null);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        dealerParent,
        loadingParent,
        updateUser,
        updateDealerParent, // Add this to the context value
        logout,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

// Custom hook to use the UserContext
export const useUser = () => {
  return useContext(UserContext);
};