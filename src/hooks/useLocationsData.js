// src/hooks/useLocationsData.js
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import * as turf from "@turf/turf";

/* ---------------- Production model constants ---------------- */
// Keep these synced with LandUseMap (or export them if you want single source)
const LITERS_PER_PE_PER_YEAR = 500; // 1 p.e. ≈ 500 L urine/year (adjust if you have a local factor)
const PRODUCTION_RATIO = 7 / 100;   // 7 L fertilizer per 100 L urine

/* ---------------- Generic helpers ---------------- */
function toNum(raw) {
  if (raw == null) return null;
  let v = String(raw).trim();
  v = v.replace(/\s*(km|KM)\s*$/u, "");
  const hasComma = v.includes(","), hasDot = v.includes(".");
  if (hasComma && hasDot) v = v.replace(/\./g, "").replace(",", ".");
  else if (hasComma && !hasDot) v = v.replace(",", ".");
  else v = v.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
  v = v.replace(/[^0-9.\-]/g, "");
  if (!v || v === "." || v === "-" || v === "-.") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normKey(k) {
  return String(k ?? "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\.\(\)\[\]/:]+/g, " ")
    .replace(/\s+/g, " ");
}

function pick(row, candidates) {
  const keys = Object.keys(row);
  const normMap = new Map(keys.map((k) => [normKey(k), k]));
  for (const c of candidates) {
    const nk = normKey(c);
    if (normMap.has(nk)) {
      const key = normMap.get(nk);
      const val = row[key];
      if (val != null && String(val).trim() !== "") return val;
    }
  }
  return null;
}

function pickWithKey(row, candidates) {
  const keys = Object.keys(row);
  const normMap = new Map(keys.map((k) => [normKey(k), k]));
  for (const c of candidates) {
    const nk = normKey(c);
    if (normMap.has(nk)) {
      const key = normMap.get(nk);
      const val = row[key];
      if (val != null && String(val).trim() !== "") return { key, value: val };
    }
  }
  return null;
}

function findNumberByHeaderContains(row, substrings = []) {
  for (const k of Object.keys(row)) {
    const nk = normKey(k);
    if (substrings.some((s) => nk.includes(s))) {
      const num = toNum(row[k]);
      if (num != null) return { key: k, value: num };
    }
  }
  return null;
}

/* ---------------- WTP row parsing ---------------- */
function autoDetectLatLon(row) {
  const latExplicit = toNum(
    pick(row, ["Latitude of W.T.P.", "latitude", "lat", "Latitude", "Y (Latitude)", "Y"])
  );
  const lonExplicit = toNum(
    pick(row, ["Longitude of W.T.P.", "longitude", "lon", "lng", "Longitude", "X (Longitude)", "X"])
  );
  if (latExplicit != null && lonExplicit != null) return { lat: latExplicit, lon: lonExplicit };

  const latFrom = findNumberByHeaderContains(row, [" lat", "lat ", "lat"]);
  const lonFrom = findNumberByHeaderContains(row, [" lon", "lng", "long", "longitude"]);
  if (latFrom && lonFrom) return { lat: latFrom.value, lon: lonFrom.value };

  const yVal = toNum(pick(row, ["Y", "y"]));
  const xVal = toNum(pick(row, ["X", "x"]));
  if (yVal != null && xVal != null) {
    const aOk = Math.abs(yVal) <= 90 && Math.abs(xVal) <= 180;
    const bOk = Math.abs(xVal) <= 90 && Math.abs(yVal) <= 180;
    if (aOk) return { lat: yVal, lon: xVal };
    if (bOk) return { lat: xVal, lon: yVal };
  }
  return null;
}

function detectRadiusKm(row) {
  const direct = pick(row, [
    "Plant Influence Radius (km)",
    "Coverage radius (km)",
    "radius_km",
    "Radius (km)",
    "radius",
  ]);
  let r = toNum(direct);
  if (r != null && r > 0) return r;
  const found = findNumberByHeaderContains(row, ["radius", "influence", "coverage"]);
  if (found && found.value > 0) return found.value;
  return null;
}

function detectName(row) {
  return pick(row, ["W.T.P. Name", "WTP Name", "Name", "Site", "id", "ID"]) || "";
}

function readWtpRow(row, fallbackRadiusKm) {
  const ll = autoDetectLatLon(row);
  let radius_km = detectRadiusKm(row);
  if (radius_km == null || radius_km <= 0) radius_km = fallbackRadiusKm;
  const name = detectName(row);

  // Prefer Capacity (p.e.), else fallback Potenz. (A.E.)
  const cap = pickWithKey(row, ["Capacity (p.e.)", "Capacity", "p.e.", "PE"]);
  const pot = pickWithKey(row, ["Potenz. (A.E.)", "Potenz A.E.", "Potenz", "AE"]);

  let peLabel = null;
  let peValue = null;
  if (cap && toNum(cap.value) != null) {
    peLabel = cap.key;
    peValue = toNum(cap.value);
  } else if (pot && toNum(pot.value) != null) {
    peLabel = pot.key;
    peValue = toNum(pot.value);
  }

  if (!ll || radius_km == null || radius_km <= 0) return null;

  return {
    lat: ll.lat,
    lon: ll.lon,
    radius_km: Number(radius_km),
    name,
    peLabel,  // actual header name used
    peValue,  // numeric p.e. for this site (may be null)
  };
}

/* ---------------- useLocationGroup ---------------- */
/**
 * Load WTP CSV and compute union.
 * Supports single global radius override via opts.globalRadiusKm.
 * Returns totalProduction computed from sum of p.e. across the group.
 */
export function useLocationGroup(csvUrl, defaultRadiusKm = 2, opts = {}) {
  const { globalRadiusKm = null } = opts;
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!csvUrl) return;
    setLoading(true);
    setError("");
    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      delimiter: "",
      transformHeader: (h) => (h ? h.replace(/\uFEFF/g, "").trim() : h),
      complete: (res) => {
        const normalized = (res.data || [])
          .map((row) => readWtpRow(row, defaultRadiusKm))
          .filter(Boolean);
        if (!normalized.length) setError("No valid rows found (lat/lon/radius missing).");
        setRows(normalized);
        setLoading(false);
      },
      error: (err) => {
        setError(err?.message || "Failed to load CSV");
        setLoading(false);
      },
    });
  }, [csvUrl, defaultRadiusKm]);

  const {
    center,
    baseRows,
    effectiveRows,
    circlesFC,
    unionPolygon,
    maxSearchRadiusKm,
    totalProduction,
  } = useMemo(() => {
    if (!rows.length)
      return {
        center: null,
        baseRows: [],
        effectiveRows: [],
        circlesFC: null,
        unionPolygon: null,
        maxSearchRadiusKm: 5,
        totalProduction: 0,
      };

    const baseRows = rows;

    // Apply single absolute radius to all sites if provided
    const effectiveRows = baseRows.map((r) => ({
      ...r,
      radius_km:
        globalRadiusKm != null && globalRadiusKm > 0
          ? Number(globalRadiusKm)
          : r.radius_km,
    }));

    // Centroid of all sites
    const pts = turf.featureCollection(effectiveRows.map((r) => turf.point([r.lon, r.lat])));
    const ctr = turf.center(pts);
    const [ctrLon, ctrLat] = ctr.geometry.coordinates;
    const center = [ctrLat, ctrLon];

    // Circles and robust union
    const circles = effectiveRows.map((r) =>
      turf.circle([r.lon, r.lat], r.radius_km, { units: "kilometers", steps: 64 })
    );
    const circlesFC = turf.featureCollection(circles);

    let unioned = null;
    try {
      if (circles.length === 1) {
        unioned = circles[0];
      } else {
        const combined = turf.combine(circlesFC);
        unioned = turf.buffer(combined, 0.0001, { units: "kilometers" });
        unioned = turf.simplify(unioned, { tolerance: 0.0001, highQuality: false });
      }
    } catch {
      try {
        unioned = circles[0];
        for (let i = 1; i < circles.length; i++) {
          const next = turf.union(unioned, circles[i]);
          if (next) unioned = next;
        }
      } catch {
        unioned = null;
      }
    }
    const unionOrFC = unioned || circlesFC;

    // Safe fetch radius to cover all circles from the centroid
    const maxSearchRadiusKm =
      Math.max(
        ...effectiveRows.map(
          (r) =>
            turf.distance([ctrLon, ctrLat], [r.lon, r.lat], { units: "kilometers" }) +
            r.radius_km
        )
      ) + 1;

    // ---- Totals: sum p.e. (Capacity or Potenz) → urine → fertilizer
    const totalPE = effectiveRows.reduce((s, r) => s + (r.peValue || 0), 0);
    const totalUrine = totalPE * LITERS_PER_PE_PER_YEAR;
    const totalProduction = totalUrine * PRODUCTION_RATIO;

    return {
      center,
      baseRows,
      effectiveRows,
      circlesFC,
      unionPolygon: unionOrFC,
      maxSearchRadiusKm,
      totalProduction,
    };
  }, [rows, globalRadiusKm]);

  return {
    rows: baseRows,
    effectiveRows,
    center,
    circlesFC,
    unionPolygon,
    maxSearchRadiusKm,
    loading,
    error,
    totalProduction,
  };
}

/* ---------------- Public buildings parsing ---------------- */

// Extract the first two numbers from a string like "(lat, lon)" or "lat; lon"
function parseLatLonFromCombined(value) {
  if (!value) return null;
  const s = String(value);
  const matches = s.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) return null;

  let a = matches[0].replace(",", ".");
  let b = matches[1].replace(",", ".");
  const n1 = Number(a);
  const n2 = Number(b);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return null;

  // Assume (lat, lon); if invalid, try swapped
  let lat = n1, lon = n2;
  const latOK = Math.abs(lat) <= 90;
  const lonOK = Math.abs(lon) <= 180;
  if (!(latOK && lonOK)) {
    const altLat = n2, altLon = n1;
    if (Math.abs(altLat) <= 90 && Math.abs(altLon) <= 180) {
      lat = altLat; lon = altLon;
    }
  }
  if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  return null;
}

function readPublicBuilding(row) {
  // 1) Separate lat/lon if available
  let lat = toNum(pick(row, ["Y (Latitude)", "Y", "Latitude", "lat"])) ?? null;
  let lon = toNum(pick(row, ["X (Longitude)", "X", "Longitude", "lon", "lng"])) ?? null;

  // 2) Combined "(Lat, Long)" field if needed
  if (lat == null || lon == null) {
    const combined = pick(row, [
      "Coordinates (Lat, Long)",
      "Coordinates",
      "Coord",
      "Lat Long",
      "Lat/Lon",
      "Lat, Lon",
    ]);
    const pair = parseLatLonFromCombined(combined);
    if (pair) { lat = pair.lat; lon = pair.lon; }
  }

  const name =
    pick(row, ["Name of public building or public space", "Name", "Site", "id"]) ||
    "Public Building";

  // Yearly presence/capacity column (for popup)
  const wasteRaw =
    pick(row, [
      "Yearly presence/ capacity",
      "Yearly presence",
      "Capacity",
    ]) || null;
  const waste = wasteRaw != null ? toNum(wasteRaw) : null;

  if (lat == null || lon == null) return null;
  return { lat, lon, name, waste };
}

export function usePublicBuildings(csvUrl) {
  const [points, setPoints] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!csvUrl) return;
    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      delimiter: "",
      transformHeader: (h) => (h ? h.replace(/\uFEFF/g, "").trim() : h),
      complete: (res) => {
        const pts = (res.data || []).map((row) => readPublicBuilding(row)).filter(Boolean);
        if (!pts.length) setError("No valid public building coordinates found.");
        setPoints(pts);
      },
      error: (err) => setError(err?.message || "Failed to load public buildings"),
    });
  }, [csvUrl]);
  return { points, error };
}

/* ---------------- Public AOI (2 km circles around public buildings) ---------------- */

/**
 * Build AOI from public buildings: fixed radius (default 2 km).
 * Returns center, the FeatureCollection of circles, and a union polygon (or FC fallback).
 */
export function usePublicAOI(csvUrl, radiusKm = 2) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!csvUrl) return;
    setLoading(true);
    setError("");
    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => (h ? h.replace(/\uFEFF/g, "").trim() : h),
      complete: (res) => {
        const pts = (res.data || []).map(readPublicBuilding).filter(Boolean);
        if (!pts.length) setError("No valid public building rows (lat/lon).");
        setRows(pts);
        setLoading(false);
      },
      error: (err) => {
        setError(err?.message || "Failed to load public buildings CSV");
        setLoading(false);
      },
    });
  }, [csvUrl]);

  const { center, circlesFC, unionPolygon } = useMemo(() => {
    if (!rows.length) return { center: null, circlesFC: null, unionPolygon: null };

    const pts = turf.featureCollection(rows.map((r) => turf.point([r.lon, r.lat])));
    const ctr = turf.center(pts);
    const [ctrLon, ctrLat] = ctr.geometry.coordinates;
    const center = [ctrLat, ctrLon];

    const circles = rows.map((r) =>
      turf.circle([r.lon, r.lat], radiusKm, { units: "kilometers", steps: 64 })
    );
    const circlesFC = turf.featureCollection(circles);

    let unioned = null;
    try {
      if (circles.length === 1) {
        unioned = circles[0];
      } else {
        const combined = turf.combine(circlesFC);
        unioned = turf.buffer(combined, 0.0001, { units: "kilometers" });
        unioned = turf.simplify(unioned, { tolerance: 0.0001, highQuality: false });
      }
    } catch {
      try {
        unioned = circles[0];
        for (let i = 1; i < circles.length; i++) {
          const u = turf.union(unioned, circles[i]);
          if (u) unioned = u;
        }
      } catch {
        unioned = null;
      }
    }

    return { center, circlesFC, unionPolygon: unioned || circlesFC };
  }, [rows, radiusKm]);

  return { rows, center, circlesFC, unionPolygon, loading, error };
}
