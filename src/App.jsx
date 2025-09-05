// src/App.jsx (only the MapPage component updated)
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import Splash from "./pages/Splash";
import Menu from "./pages/Menu";
import LandUseMap from "./LandUseMap";
import Dashboard from "./Dashboard";

import { LOCATION_GROUPS, PUBLIC_BUILDINGS_CSV } from "./utils/data";
import { useLocationGroup, usePublicBuildings } from "./hooks/useLocationsData";
import "./App.css";

const landuseTypes = [
  "farmland",
  "plantation",
  "orchard",
  "vineyard",
  "greenhouse_horticulture",
];

function MapPage() {
  const { groupId } = useParams();
  const group = LOCATION_GROUPS.find((g) => g.id === groupId);

  const [globalRadiusKm, setGlobalRadiusKm] = useState(group?.defaultRadiusKm ?? 2);

  const {
    effectiveRows,
    center,
    circlesFC,
    unionPolygon,
    maxSearchRadiusKm,
    loading,
    error,
    totalProduction,
  } = useLocationGroup(group?.csv, group?.defaultRadiusKm ?? 2, { globalRadiusKm });

  const { points: publicBuildings } = usePublicBuildings(PUBLIC_BUILDINGS_CSV);

  const [toggles, setToggles] = useState(() =>
    landuseTypes.reduce((o, t) => ({ ...o, [t]: true }), {})
  );
  const [features, setFeatures] = useState([]);

  const [showWtp, setShowWtp] = useState(true);
  const [showPublic, setShowPublic] = useState(true);

  // --- Resizable sidebar ---
  const DEFAULT_SIDEBAR = 360;
  const MIN_SIDEBAR = 260;
  const MAX_SIDEBAR = 720;

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidthPx"));
    return Number.isFinite(saved) ? saved : DEFAULT_SIDEBAR;
  });

  // Use ref for logic (no stale closures), state only for visuals
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ dragging: false, startX: 0, startW: sidebarWidth });

  useEffect(() => {
    setFeatures([]);
    setGlobalRadiusKm(group?.defaultRadiusKm ?? 2);
  }, [groupId]);

  const visible = useMemo(
    () => features.filter((f) => toggles[f.properties.landuse]),
    [features, toggles]
  );

  const onDragStart = (e) => {
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragRef.current = { dragging: true, startX: clientX, startW: sidebarWidth };
    setIsDragging(true);
    document.body.classList.add("no-select");
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onDragMove, { passive: false });
    window.addEventListener("touchend", onDragEnd);
    window.addEventListener("mouseleave", onDragEnd);
  };

  const onDragMove = (e) => {
    if (!dragRef.current.dragging) return; // ← ref, not state
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const delta = clientX - dragRef.current.startX;
    let next = dragRef.current.startW + delta;
    next = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, next));
    setSidebarWidth(next);
  };

  const onDragEnd = () => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false; // ← stop logic
    setIsDragging(false);             // ← update visuals
    document.body.classList.remove("no-select");
    localStorage.setItem("sidebarWidthPx", String(sidebarWidth));
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    window.removeEventListener("touchmove", onDragMove);
    window.removeEventListener("touchend", onDragEnd);
    window.removeEventListener("mouseleave", onDragEnd);
  };

  if (!group) return <Navigate to="/menu" replace />;

  return (
    <div className="app-container" style={{ position: "relative" }}>
      <div className="map-pane" style={{ flex: 1, minWidth: 0 }}>
        <LandUseMap
          center={center}
          searchRadiusKm={showWtp ? maxSearchRadiusKm : null}
          landuseToggles={toggles}
          features={showWtp ? visible : []}
          onDataUpdate={setFeatures}
          unionPolygon={showWtp ? unionPolygon : null}
          publicBuildings={showPublic ? publicBuildings : []}
          circlesFC={showWtp ? circlesFC : null}
          locationRows={showWtp ? effectiveRows : []}
          totalProduction={showWtp ? totalProduction : 0}
        />
      </div>

      {/* Resizer handle */}
      <div
        className={`resizer ${isDragging ? "dragging" : ""}`}
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize dashboard"
      />

      {/* Sidebar */}
      <div className="details-pane" style={{ width: `${sidebarWidth}px` }}>
        <Dashboard
          radiusKm={globalRadiusKm}
          onRadiusChange={(v) => {
            const num = Number(v);
            if (Number.isFinite(num) && num > 0) setGlobalRadiusKm(num);
          }}
          landuseTypes={landuseTypes}
          toggles={toggles}
          onToggle={(t) => setToggles((p) => ({ ...p, [t]: !p[t] }))}
          features={visible}
          totalProduction={totalProduction}
          showWtp={showWtp}
          onToggleWtp={() => setShowWtp((s) => !s)}
          showPublic={showPublic}
          onTogglePublic={() => setShowPublic((s) => !s)}
        />
      </div>

      {/* Overlay only while dragging */}
      {isDragging && (
        <div
          className="resizing-blocker"
          onMouseUp={onDragEnd}
          onTouchEnd={onDragEnd}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Splash />} />
      <Route path="/menu" element={<Menu />} />
      <Route path="/map/:groupId" element={<MapPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
