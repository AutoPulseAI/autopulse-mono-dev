// src/components/GlobalLoader.js
"use client";
import { useLoader } from "../context/LoaderContext";

const GlobalLoader = () => {
  const { loading } = useLoader();

  if (!loading) return null;

  return (
    <div style={styles.loader}>
      <p>Loading.....................</p>
    </div>
  );
};

const styles = {
  loader: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(255, 255, 255, 1)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
};

export default GlobalLoader;