// src/pages/Splash.jsx
import { useNavigate } from "react-router-dom";
import "../App.css";

export default function Splash() {
  const nav = useNavigate();
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
      }}
    >
      <img
        src="/logo.png"
        alt="Open Menu"
        style={{
          width: 240,
          height: 240,
          cursor: "pointer",
          borderRadius: 16,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
        }}
        onClick={() => nav("/menu")}
      />
    </div>
  );
}
