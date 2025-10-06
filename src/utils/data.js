// src/utils/data.js
export const LOCATION_GROUPS = [
  {
    id: "attica",
    name: "Attica",
    csv: "/locations/wtp-attica.csv",
    publicCsv: "/locations/public-attica.csv",   // ← add this
    defaultRadiusKm: 2
  },
  {
    id: "campania",
    name: "Campania",
    csv: "/locations/wtp-campania.csv",
    publicCsv: "/locations/public-campania.csv", // ← and this
    defaultRadiusKm: 2
  }
];
