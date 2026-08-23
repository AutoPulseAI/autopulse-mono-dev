// src/hooks/useFetch.js
import { useState, useCallback } from "react";
import { useLoader } from "../context/LoaderContext"; // Import the LoaderContext

const useFetch = () => {
  const [error, setError] = useState(null);
  const { setLoading } = useLoader(); // Use the LoaderContext

  const fetchData = useCallback(async (url, options = {}) => {
    setLoading(true); // Start loading (global)
    setError(null);

    try {
      const response = await fetch(url, options);

      
      return response;
    } catch (error) {
      setError(error.message || "Something went wrong!");
      throw error;
    } finally {
      setLoading(false); // Stop loading (global)
    }
  }, [setLoading]);

  return { fetchData, error };
};

export default useFetch;