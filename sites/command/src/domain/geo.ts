import type { GeoPoint } from "./types";
import { round1 } from "./resources";

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Command's own rough road-distance estimate, used only until RouteBridge has answered.
 * It is always labelled "estimate" wherever it is shown.
 */
export const ESTIMATE_ROAD_FACTOR = 1.32;
export const ESTIMATE_SPEED_KMH = 32;

export function estimateRoadKm(a: GeoPoint, b: GeoPoint): number {
  return round1(haversineKm(a, b) * ESTIMATE_ROAD_FACTOR);
}

export function estimateTransitHours(a: GeoPoint, b: GeoPoint): number {
  return round1(estimateRoadKm(a, b) / ESTIMATE_SPEED_KMH + 1);
}

export function centroid(points: GeoPoint[]): GeoPoint {
  if (!points.length) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

export function isValidPoint(point: unknown): point is GeoPoint {
  if (!point || typeof point !== "object") return false;
  const { lat, lng } = point as GeoPoint;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
