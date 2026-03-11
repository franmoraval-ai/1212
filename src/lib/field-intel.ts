interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt?: string;
}

interface UserIdentity {
  uid?: string;
  email?: string | null;
}

interface EvidenceInput {
  checkpointId?: string;
  gps: GeoPoint | null;
  photos: string[];
  user: UserIdentity | null;
  geofence?: GeofenceEvaluation | null;
}

export interface GeofenceTarget {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface GeofenceEvaluation {
  inside: boolean;
  radiusMeters: number;
  nearestDistanceMeters: number | null;
  nearestTargetId: string | null;
  nearestTargetLabel: string | null;
}

interface LastPoint {
  lat: number;
  lng: number;
  at: string;
}

const LAST_POINT_KEY = "ho_last_geo_point_v1";

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(a: GeoPoint, b: GeoPoint) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

export function buildEvidenceBundle(input: EvidenceInput) {
  const now = new Date().toISOString();

  const toPhotoMeta = (dataUrl: string, index: number) => {
    const clean = String(dataUrl ?? "");
    const [prefix, payload] = clean.split(",");
    const mimeType = prefix?.match(/^data:(.*?);base64$/)?.[1] ?? "image/jpeg";
    const sizeBytes = payload ? Math.ceil((payload.length * 3) / 4) : 0;
    return {
      index,
      capturedAt: now,
      mimeType,
      sizeKb: Math.round(sizeBytes / 1024),
    };
  };

  return {
    checkpointId: input.checkpointId ?? "general",
    capturedAt: now,
    user: {
      uid: input.user?.uid ?? "unknown",
      email: input.user?.email ?? null,
    },
    gps: input.gps
      ? {
          lat: Number(input.gps.lat),
          lng: Number(input.gps.lng),
          accuracy: typeof input.gps.accuracy === "number" ? input.gps.accuracy : undefined,
          capturedAt: input.gps.capturedAt ?? now,
        }
      : null,
    // Guardamos solo metadata para evitar duplicar imagen base64 en el payload.
    photos: input.photos.map((dataUrl, idx) => toPhotoMeta(dataUrl, idx)),
    geofence: input.geofence ?? null,
  };
}

export function evaluateGeofence(
  current: GeoPoint | null,
  targets: GeofenceTarget[],
  radiusMeters = 250
): GeofenceEvaluation {
  if (!current || !targets.length) {
    return {
      inside: false,
      radiusMeters,
      nearestDistanceMeters: null,
      nearestTargetId: null,
      nearestTargetLabel: null,
    };
  }

  let nearestDistanceMeters = Number.POSITIVE_INFINITY;
  let nearestTarget: GeofenceTarget | null = null;

  for (const target of targets) {
    const distanceMeters = distanceKm(current, target) * 1000;
    if (distanceMeters < nearestDistanceMeters) {
      nearestDistanceMeters = distanceMeters;
      nearestTarget = target;
    }
  }

  return {
    inside: nearestDistanceMeters <= radiusMeters,
    radiusMeters,
    nearestDistanceMeters: Number.isFinite(nearestDistanceMeters) ? Math.round(nearestDistanceMeters) : null,
    nearestTargetId: nearestTarget?.id ?? null,
    nearestTargetLabel: nearestTarget?.label ?? null,
  };
}

export function evaluateGeoRisk(current: GeoPoint | null) {
  const flags: string[] = [];
  if (!current) {
    return { riskLevel: "high", flags: ["gps_missing"], estimatedSpeedKmh: null as number | null };
  }

  if (typeof current.accuracy === "number" && current.accuracy > 120) {
    flags.push("gps_low_accuracy");
  }

  let estimatedSpeedKmh: number | null = null;

  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(LAST_POINT_KEY);
    if (raw) {
      try {
        const prev = JSON.parse(raw) as LastPoint;
        if (prev?.at) {
          const from: GeoPoint = { lat: prev.lat, lng: prev.lng };
          const to: GeoPoint = { lat: current.lat, lng: current.lng };
          const km = distanceKm(from, to);
          const hours = Math.max((Date.now() - new Date(prev.at).getTime()) / 3600000, 0.0001);
          estimatedSpeedKmh = km / hours;
          if (estimatedSpeedKmh > 180) {
            flags.push("gps_unrealistic_speed");
          }
        }
      } catch {
        // Ignore parse failures
      }
    }

    const next: LastPoint = { lat: current.lat, lng: current.lng, at: new Date().toISOString() };
    window.localStorage.setItem(LAST_POINT_KEY, JSON.stringify(next));
  }

  const riskLevel = flags.includes("gps_unrealistic_speed") || flags.includes("gps_missing")
    ? "high"
    : flags.length > 0
      ? "medium"
      : "low";

  return { riskLevel, flags, estimatedSpeedKmh };
}

export function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      const d = candidate.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
