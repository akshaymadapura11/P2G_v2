// src/Dashboard.jsx
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Cell,
} from "recharts";
import "./App.css";

const COLORS = {
  farmland: "#FFD700",
  plantation: "#8B4513",
  orchard: "#7FFF00",
  vineyard: "#8B008B",
  greenhouse_horticulture: "#00CED1",
};

const REQUIRED_KG_PER_HA = 160; // global requirement per ha (for summary chart)
const DENSITY_KG_PER_L = 1;     // assume ~1 kg/L

// Wheat rates (farmland only)
const WHEAT_STANDARD_KG_HA = 160;
const WHEAT_ORGANIC_KG_HA = 120;

// Custom tooltip for land-use: show % + area
function LanduseTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.type}</div>
      <div>Share: <strong>{p.percent.toFixed(2)}%</strong></div>
      <div>Area: <strong>{p.areaKm2.toFixed(2)} km²</strong></div>
    </div>
  );
}

// Custom tooltip for wheat charts: show kg + % of requirement
function WheatTooltip({ active, payload, requirementKg }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const name = row.name;
  const value = row.value || 0;
  const pct =
    name.toLowerCase().includes("production")
      ? (requirementKg > 0 ? (value / requirementKg) * 100 : 0)
      : 100;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{name}</div>
      <div>Value: <strong>{Number(value).toLocaleString()} kg</strong></div>
      <div>Percent of requirement: <strong>{pct.toFixed(2)}%</strong></div>
    </div>
  );
}

export default function Dashboard({
  radiusKm,
  onRadiusChange,
  landuseTypes,
  toggles,
  onToggle,
  features,
  totalProduction = 0,

  // marker toggles
  showWtp = true,
  onToggleWtp,
  showPublic = true,
  onTogglePublic,
}) {
  // Aggregate visible/toggled area
  const totalAreaM2 = features
    .filter((f) => toggles[f.properties.landuse])
    .reduce((s, f) => s + (f.properties.area || 0), 0);
  const totalAreaKm2 = totalAreaM2 / 1e6;

  // Requirement (kg) for all visible features using global 160 kg/ha
  const totalRequirementKg = features
    .filter((f) => toggles[f.properties.landuse])
    .reduce((sum, f) => {
      const areaHa = (f.properties.area || 0) / 10000;
      return sum + areaHa * REQUIRED_KG_PER_HA;
    }, 0);

  // Production → kg
  const productionKg = Number(totalProduction || 0) * DENSITY_KG_PER_L;

  // Land-use % data (+ area for tooltip) with map-matched colors
  const landusePercentData = landuseTypes.map((type) => {
    const areaM2 = features
      .filter((f) => toggles[type] && f.properties.landuse === type)
      .reduce((s, f) => s + (f.properties.area || 0), 0);
    const pct = totalAreaM2 > 0 ? (areaM2 / totalAreaM2) * 100 : 0;
    return {
      key: type,
      type: type.replace(/_/g, " "),
      percent: Number(pct.toFixed(2)),
      areaKm2: areaM2 / 1e6,
    };
  });

  // Production vs Requirement as % (Requirement = 100)
  const coveragePct =
    totalRequirementKg > 0 ? (productionKg / totalRequirementKg) * 100 : 0;
  const prodReqPctData = [
    { name: "Production (% of req.)", percent: Number(coveragePct.toFixed(2)) },
    { name: "Requirement", percent: 100 },
  ];

  // Farmland area (ha) for wheat scenarios
  const farmlandAreaHa =
    features
      .filter((f) => toggles["farmland"] && f.properties.landuse === "farmland")
      .reduce((s, f) => s + ((f.properties.area || 0) / 10000), 0) || 0;

  // Wheat requirements
  const wheatReqStandardKg = farmlandAreaHa * WHEAT_STANDARD_KG_HA;
  const wheatReqOrganicKg  = farmlandAreaHa * WHEAT_ORGANIC_KG_HA;

  // Data rows for wheat charts (two bars: production vs requirement)
  const wheatStandardData = [
    { name: "Production (kg)", value: Math.round(productionKg) },
    { name: "Requirement (kg)", value: Math.round(wheatReqStandardKg) },
  ];
  const wheatOrganicData = [
    { name: "Production (kg)", value: Math.round(productionKg) },
    { name: "Requirement (kg)", value: Math.round(wheatReqOrganicKg) },
  ];

  return (
    <div className="details-pane dashboard-pane">
      <h2>Land Use Dashboard</h2>

      {/* Radius */}
      <div className="card">
        <h3>WTP Radius</h3>
        <div className="radius-input">
          <label>Radius (km):</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={radiusKm}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Summary */}
      <div className="card">
        <h3>Summary</h3>
        <p><strong>Total Area:</strong> {totalAreaKm2.toFixed(2)} km²</p>
        <p><strong>Total Production:</strong> {Number(totalProduction || 0).toFixed(2)} L</p>
        <p><strong>Requirement:</strong> {Math.round(totalRequirementKg).toLocaleString()} kg</p>
      </div>

      {/* Marker toggles */}
      <div className="card">
        <h3>Markers</h3>
        <ul className="toggle-list">
          <li>
            <input
              type="checkbox"
              id="toggle-wtp"
              checked={showWtp}
              onChange={onToggleWtp}
            />
            <label htmlFor="toggle-wtp">Show WTP Locations</label>
          </li>
          <li>
            <input
              type="checkbox"
              id="toggle-public"
              checked={showPublic}
              onChange={onTogglePublic}
            />
            <label htmlFor="toggle-public">Show Public Buildings</label>
          </li>
        </ul>
      </div>

      {/* Land Use Layer Toggles */}
      <div className="card">
        <h3>Show / Hide Land Use Layers</h3>
        <ul className="toggle-list">
          {landuseTypes.map((type) => (
            <li key={type}>
              <input
                type="checkbox"
                id={`toggle-${type}`}
                checked={toggles[type]}
                onChange={() => onToggle(type)}
              />
              <label htmlFor={`toggle-${type}`}>
                <span className="color-swatch" style={{ background: COLORS[type] }} />
                {type.replace(/_/g, " ")}
              </label>
            </li>
          ))}
        </ul>
      </div>

      {/* Land-use percentage bar chart (map colors; tooltip shows % + area) */}
      <div className="card">
        <h3>Land-use (% of visible area)</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={landusePercentData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="type" />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<LanduseTooltip />} />
              <Bar dataKey="percent" name="Share of area (%)">
                {landusePercentData.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={COLORS[entry.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Production vs Requirement (percentage view) */}
      <div className="card">
        <h3>Production vs Requirement (%)</h3>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={prodReqPctData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`, "Percent"]} />
              <Legend />
              <Bar dataKey="percent" name="Percent">
                {prodReqPctData.map((row, i) => (
                  <Cell
                    key={`pr-cell-${i}`}
                    fill={row.name.includes("Production") ? "#4CAF50" : "#9E9E9E"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Wheat (Standard) — farmland only */}
      <div className="card">
        <h3>Wheat (Standard) — Production vs Requirement</h3>
        <p style={{ marginTop: -8, color: "#666" }}>
          Applies only to <strong>farmland</strong>. Requirement: {WHEAT_STANDARD_KG_HA} kg/ha.
        </p>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={wheatStandardData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis
                tickFormatter={(v) =>
                  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString()
                }
                label={{ value: "kg", angle: -90, position: "insideLeft" }}
              />
              <Tooltip content={<WheatTooltip requirementKg={wheatReqStandardKg} />} />
              <Legend />
              <Bar dataKey="value" name="Amount (kg)">
                {wheatStandardData.map((row, i) => (
                  <Cell
                    key={`ws-cell-${i}`}
                    fill={row.name.includes("Production") ? "#43A047" : "#757575"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Wheat (Organic) — farmland only */}
      <div className="card">
        <h3>Wheat (Organic) — Production vs Requirement</h3>
        <p style={{ marginTop: -8, color: "#666" }}>
          Applies only to <strong>farmland</strong>. Requirement: {WHEAT_ORGANIC_KG_HA} kg/ha.
        </p>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={wheatOrganicData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis
                tickFormatter={(v) =>
                  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString()
                }
                label={{ value: "kg", angle: -90, position: "insideLeft" }}
              />
              <Tooltip content={<WheatTooltip requirementKg={wheatReqOrganicKg} />} />
              <Legend />
              <Bar dataKey="value" name="Amount (kg)">
                {wheatOrganicData.map((row, i) => (
                  <Cell
                    key={`wo-cell-${i}`}
                    fill={row.name.includes("Production") ? "#2E7D32" : "#616161"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
