// src/App.jsx
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import Splash from "./pages/Splash";
import Menu from "./pages/Menu";
import LandUseMap from "./LandUseMap";
import Dashboard from "./Dashboard";

import { LOCATION_GROUPS } from "./utils/data";
import {
  useLocationGroup,
  usePublicBuildings,   // keep if you still want red markers when AOI=WTP
  usePublicAOI,        // ← new
} from "./hooks/useLocationsData";
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
  const [publicRadiusKm, setPublicRadiusKm] = useState(2);

  // WTP AOI (adjustable radius)
  const {
    effectiveRows: wtpRows,
    center: wtpCenter,
    circlesFC: wtpCircles,
    unionPolygon: wtpUnion,
    maxSearchRadiusKm,
    loading: wtpLoading,
    error: wtpError,
    totalProduction,
  } = useLocationGroup(group?.csv, group?.defaultRadiusKm ?? 2, { globalRadiusKm });

  // Public AOI (fixed 2 km per your spec)
  const {
    rows: publicRows,
    center: publicCenter,
    circlesFC: publicCircles,
    unionPolygon: publicUnion,
    loading: publicLoading,
    error: publicError,
  } = usePublicAOI(group?.publicCsv, publicRadiusKm);

  // If you still want standalone public red markers when AOI=WTP:
  // const { points: publicMarkers } = usePublicBuildings(group?.publicCsv);
  // We'll just reuse `publicRows` as markers (has lat/lon/name).

  const [toggles, setToggles] = useState(() =>
    landuseTypes.reduce((o, t) => ({ ...o, [t]: true }), {})
  );
  const [features, setFeatures] = useState([]);

  // Marker toggles
  const [showWtp, setShowWtp] = useState(true);
  const [showPublic, setShowPublic] = useState(true);

  // AOI source: "wtp" or "public"
  const [aoiSource, setAoiSource] = useState("wtp");

  useEffect(() => {
    setFeatures([]);
    setGlobalRadiusKm(group?.defaultRadiusKm ?? 2);
    setAoiSource("wtp");
  }, [groupId]);

  const visible = useMemo(
    () => features.filter((f) => toggles[f.properties.landuse]),
    [features, toggles]
  );

  if (!group) return <Navigate to="/menu" replace />;

  // Choose AOI union/circles/center based on source
  const aoi = aoiSource === "public"
    ? { center: publicCenter, union: publicUnion, circles: publicCircles }
    : { center: wtpCenter,    union: wtpUnion,    circles: wtpCircles };

  // Prevent Overpass fetch if AOI is missing
  const enableAOI = aoiSource === "public" || showWtp; // WTP AOI hidden when WTP toggle off

  return (
    <div className="app-container" style={{ position: "relative" }}>
      <div className="map-pane" style={{ flex: 1, minWidth: 0 }}>
        <LandUseMap
          center={aoi.center}
          searchRadiusKm={enableAOI ? maxSearchRadiusKm : null}
          landuseToggles={toggles}

          // Land tiles follow chosen AOI
          features={enableAOI ? visible : []}
          onDataUpdate={setFeatures}
          unionPolygon={enableAOI ? aoi.union : null}
          circlesFC={enableAOI ? aoi.circles : null}

          // Markers: WTP (blue default) + Public (red); both obey their own toggles
          locationRows={showWtp ? wtpRows : []}
          publicBuildings={showPublic ? publicRows : []}

          // Production allocation stays based on WTP (as before)
          totalProduction={showWtp ? totalProduction : 0}
        />
      </div>

      {/* (your resizer + details pane wrapper stays the same) */}
      <div className="resizer" /* ...handlers... */ />
      <div className="details-pane" /* style={{ width: sidebarWidth }} */>
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

          // marker toggles
          showWtp={showWtp}
          onToggleWtp={() => setShowWtp((s) => !s)}
          showPublic={showPublic}
          onTogglePublic={() => setShowPublic((s) => !s)}

          // NEW: AOI source switch
          aoiSource={aoiSource}
          onChangeAoiSource={setAoiSource}
        />

        {(wtpLoading || publicLoading) && (
          <div className="notice notice-loading">Loading AOI…</div>
        )}
        {(wtpError || publicError) && (
          <div className="notice notice-error">
            {wtpError || publicError}
          </div>
        )}
      </div>
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
