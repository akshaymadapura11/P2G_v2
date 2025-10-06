// src/LandUseMap.jsx
import { useEffect, useRef, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Marker,
  Popup,
  useMapEvent,
} from "react-leaflet";
import L from "leaflet";
import osmtogeojson from "osmtogeojson";
import area from "@turf/area";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";

/* ---------------- Icons: same dot style, different colors ---------------- */
function createColoredDotIcon(hex = "#d93025") {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <circle cx="12" cy="12" r="6" fill="${hex}" stroke="white" stroke-width="2"/>
    </svg>`
  );
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconRetinaUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
    className: ""
  });
}
const blueDotIcon = createColoredDotIcon("#1967d2"); // WTPs (blue)
const redDotIcon  = createColoredDotIcon("#d93025"); // Public buildings (red)

/* ---------------- Constants kept from your setup ---------------- */
const LITERS_PER_PE_PER_YEAR = 500; // for per-site popup calc
const PRODUCTION_RATIO = 7 / 100;

const LANDUSE_COLORS = {
  farmland: "#FFD700",
  plantation: "#8B4513",
  orchard: "#7FFF00",
  vineyard: "#8B008B",
  greenhouse_horticulture: "#00CED1",
};

/* ---------------- Overpass helpers (cache + retry/rotate) ---------------- */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

const overpassCache = new Map();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchOverpassWithBackoff(query, abortSignal, cacheKey) {
  if (overpassCache.has(cacheKey)) return overpassCache.get(cacheKey);
  const maxAttempts = 5;
  let endpointIdx = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[endpointIdx % OVERPASS_ENDPOINTS.length];
    try {
      const url = endpoint + "?data=" + encodeURIComponent(query);
      const resp = await fetch(url, { signal: abortSignal });
      if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
      const json = await resp.json();
      const gj = osmtogeojson(json);
      overpassCache.set(cacheKey, gj);
      return gj;
    } catch (err) {
      if (abortSignal?.aborted) throw err;
      const backoff = Math.min(2000 * 2 ** attempt, 12000) + Math.random() * 500;
      endpointIdx++;
      await sleep(backoff);
    }
  }
  throw new Error("Overpass failed after multiple retries");
}

/* ---------------- Component ---------------- */
export default function LandUseMap({
  center,
  searchRadiusKm,
  landuseToggles,
  features = [],
  onDataUpdate,
  unionPolygon,
  publicBuildings = [],
  circlesFC,
  locationRows = [],
  totalProduction = 0,
}) {
  const abortRef = useRef(null);

  // Signatures to bust stale caches/force remount when geometry changes
  const unionSig = useMemo(() => {
    try {
      if (!unionPolygon) return "union-none";
      const b = turf.bbox(unionPolygon).map((n) => n.toFixed(6)).join("|");
      const count = (unionPolygon.features?.length ?? 1);
      return `t:${unionPolygon.type}|n:${count}|b:${b}`;
    } catch {
      return "union-fallback";
    }
  }, [unionPolygon]);

  const circlesSig = useMemo(() => {
    try {
      if (!circlesFC?.features?.length) return "circles-none";
      const b = turf.bbox(circlesFC).map((n) => n.toFixed(6)).join("|");
      return `n:${circlesFC.features.length}|b:${b}`;
    } catch {
      return "circles-fallback";
    }
  }, [circlesFC]);

  useEffect(() => {
    if (!center || !searchRadiusKm || !unionPolygon) return;

    // Tight bbox around union; fallback to center+radius if needed
    let bbox;
    try {
      bbox = turf.bbox(unionPolygon);
    } catch {
      const [lat, lon] = center;
      const d = searchRadiusKm;
      const dLat = d / 111;
      const dLon = d / (111 * Math.cos((lat * Math.PI) / 180) || 1);
      bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
    }
    const [minLon, minLat, maxLon, maxLat] = bbox;

    const tags = Object.keys(LANDUSE_COLORS).join("|");
    const query = `
      [out:json][timeout:30];
      way["landuse"~"${tags}"](${minLat},${minLon},${maxLat},${maxLon});
      out body geom;
    `;

    // Include union signature in cache key to avoid stale reuse
    const cacheKey =
      `${minLon.toFixed(6)},${minLat.toFixed(6)},${maxLon.toFixed(6)},${maxLat.toFixed(6)}|${tags}|${unionSig}`;

    const debounceMs = 650 + Math.random() * 200;
    const timer = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const gj = await fetchOverpassWithBackoff(query, controller.signal, cacheKey);

        const region = unionPolygon;
        const isFC = region?.type === "FeatureCollection";

        function clipOne(tf) {
          if (isFC) {
            const parts = [];
            for (const c of region.features) {
              try {
                const part = turf.intersect(tf, c);
                if (part) parts.push(part);
              } catch {}
            }
            if (parts.length === 1) return parts[0];
            if (parts.length > 1) {
              try {
                let merged = parts[0];
                for (let i = 1; i < parts.length; i++) {
                  const u = turf.union(merged, parts[i]);
                  if (u) merged = u;
                }
                return merged;
              } catch {}
            }
            // centroid fallback
            try {
              const ctr = turf.centroid(tf);
              for (const c of region.features) {
                if (turf.booleanPointInPolygon(ctr, c)) return tf;
              }
            } catch {}
            return null;
          }

          // Non-FC region
          try {
            if (turf.booleanIntersects(tf, region)) {
              const inter = turf.intersect(tf, region);
              if (inter) return inter;
            }
          } catch {}
          try {
            const ctr = turf.centroid(tf);
            if (turf.booleanPointInPolygon(ctr, region)) return tf;
          } catch {}
          return null;
        }

        const clipped = [];
        let totalArea = 0;

        for (const f of gj.features) {
          const sourceLanduse =
            f.properties?.landuse ??
            f.properties?.tags?.landuse ??
            f.properties?.["landuse"];
          if (!sourceLanduse) continue;
          if (!landuseToggles[sourceLanduse]) continue;

          const tf = turf.feature(f.geometry, { landuse: sourceLanduse });
          const inter = clipOne(tf);
          if (inter) {
            if (
              inter.geometry?.type !== "Polygon" &&
              inter.geometry?.type !== "MultiPolygon"
            ) continue;
            const a = area(inter);
            if (a > 0) {
              inter.properties = { ...inter.properties, landuse: sourceLanduse, area: a };
              totalArea += a;
              clipped.push(inter);
            }
          }
        }

        const totalFertLiters = Number.isFinite(totalProduction) ? totalProduction : 0;
        for (const f of clipped) {
          f.properties.fertilizer =
            totalArea > 0 ? (f.properties.area / totalArea) * totalFertLiters : 0;
        }

        onDataUpdate(clipped);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("Overpass fetch / clip error:", err);
        onDataUpdate([]);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [center, searchRadiusKm, unionPolygon, landuseToggles, totalProduction, unionSig, onDataUpdate]);

  // Keys to force GeoJSON remounts
  const unionKey = useMemo(() => `union-${unionSig}`, [unionSig]);
  const circlesKey = useMemo(() => `circles-${circlesSig}`, [circlesSig]);
  const featuresKey = useMemo(() => {
    if (!features?.length) return "features-none";
    try {
      const fc = turf.featureCollection(features);
      const b = turf.bbox(fc).map((n) => n.toFixed(6)).join("|");
      return `n:${features.length}|b:${b}`;
    } catch {
      return `n:${features.length}`;
    }
  }, [features]);

  const stylePlot = (feature) => ({
    fillColor: LANDUSE_COLORS[feature.properties.landuse] || "#ccc",
    weight: 1,
    color: "#555",
    fillOpacity: 0.6,
  });

  const onEachFeature = (feature, layer) => {
    layer.on({
      mouseover: () => {
        layer.setStyle({ weight: 3, fillOpacity: 0.9 });
        layer
          .bindPopup(
            `Type: ${feature.properties.landuse}<br/>` +
              `Area: ${(feature.properties.area / 1e6).toFixed(2)} km²<br/>` +
              `Fertilizer: ${feature.properties.fertilizer.toFixed(2)} L`
          )
          .openPopup();
      },
      mouseout: () => {
        layer.setStyle(stylePlot(feature));
        layer.closePopup();
      },
    });
  };

  function ClickDistance() {
    useMapEvent("click", (e) => {
      if (!center) return;
      const d = L.latLng(center[0], center[1]).distanceTo(e.latlng) / 1000;
      console.log(`Distance: ${d.toFixed(2)} km`);
    });
    return null;
  }

  return (
    <MapContainer center={center || [0, 0]} zoom={12} style={{ height: "100vh", width: "100%" }}>
      <TileLayer
        className="base-map"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />

      {/* Original circles */}
      {circlesFC &&
        circlesFC.features?.map((c, i) => (
          <GeoJSON
            key={`${circlesKey}-${i}`}
            data={c}
            style={{ color: "#666", weight: 1, fillOpacity: 0.08 }}
          />
        ))}

      {/* Union polygon */}
      {unionPolygon && (
        <GeoJSON
          key={unionKey}
          data={unionPolygon}
          style={{ color: "#333", weight: 2, fillOpacity: 0.1 }}
        />
      )}

      {/* WTP markers — BLUE dot markers */}
      {locationRows?.map((pt, i) => {
        const pe = Number(pt.peValue || 0);
        const perSiteUrine = pe * LITERS_PER_PE_PER_YEAR;
        const perSiteProd  = perSiteUrine * PRODUCTION_RATIO;
        return (
          <Marker key={`wtp-${i}`} position={[pt.lat, pt.lon]} icon={blueDotIcon}>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <strong>{pt.name || `Location ${i + 1}`}</strong>
                <div style={{ marginTop: 6 }}>
                  Radius: <strong>{pt.radius_km.toFixed(1)} km</strong>
                </div>
                {pt.peLabel && pe > 0 && (
                  <>
                    <div style={{ marginTop: 6 }}>
                      <strong>{pt.peLabel}:</strong> {pe.toLocaleString()}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      Est. Production: <strong>{perSiteProd.toFixed(2)} L</strong>
                    </div>
                  </>
                )}
                <div style={{ marginTop: 6, color: "#666" }}>
                  Lat/Lon: {pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Land‐use overlays */}
      {features?.length > 0 && (
        <GeoJSON
          key={featuresKey}
          data={{ type: "FeatureCollection", features }}
          style={stylePlot}
          onEachFeature={onEachFeature}
        />
      )}

      {/* Public buildings — RED dot markers */}
      {publicBuildings?.map((p, i) => (
        <Marker key={`pb-${i}`} position={[p.lat, p.lon]} icon={redDotIcon}>
          <Popup>
            <strong>{p.name || "Public Building"}</strong>
            <div>{p.lat?.toFixed?.(5)}, {p.lon?.toFixed?.(5)}</div>
            <div>
              Yearly presence/capacity:{" "}
              {p.waste != null && Number.isFinite(p.waste) ? p.waste : "N/A"}
            </div>
          </Popup>
        </Marker>
      ))}

      <ClickDistance />
    </MapContainer>
  );
}
