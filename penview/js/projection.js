/* ==== projection.js ==== ランベルト正角円錐図法（球面近似, 単位 km）。航空図と同じ系統で、日本全域の歪みが小さい */

const RAD = Math.PI / 180;
const R_KM = 6371.0088;
// 標準緯線 25°/45°、原点 36°N 136°E（日本列島をほぼ均等に覆う）
export const DEFAULT_LCC = { lat1: 25, lat2: 45, lat0: 36, lon0: 136 };

export function createProjection(params = DEFAULT_LCC) {
  const p1 = params.lat1 * RAD;
  const p2 = params.lat2 * RAD;
  const t = (phi) => Math.tan(Math.PI / 4 + phi / 2);
  const n = Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
  const f = (Math.cos(p1) * t(p1) ** n) / n;
  const rho = (phi) => (R_KM * f) / t(phi) ** n;
  const rho0 = rho(params.lat0 * RAD);
  const lon0 = params.lon0;

  return {
    forward(lat, lon) {
      const r = rho(lat * RAD);
      const theta = n * (lon - lon0) * RAD;
      return { x: r * Math.sin(theta), y: rho0 - r * Math.cos(theta) };
    },
    inverse(x, y) {
      const dy = rho0 - y;
      const r = Math.sign(n) * Math.hypot(x, dy);
      const theta = Math.atan2(x, dy);
      const lat = 2 * Math.atan(((R_KM * f) / r) ** (1 / n)) - Math.PI / 2;
      return { lat: lat / RAD, lon: lon0 + theta / n / RAD };
    },
    // 真北が地図の上方向から何度ずれるか（東側で正＝反時計回り）。画面上の向き = 真方位 - convergence
    convergence(lon) {
      return n * (lon - lon0);
    },
  };
}
