import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function applyQrSettings(instance, data, qrSettings) {
  instance.update({
    data: data || " ",
    dotsOptions: {
      type: qrSettings.dotsType,
      color: qrSettings.gradient ? undefined : qrSettings.dotsColor,
      gradient: qrSettings.gradient
        ? {
            type: "linear",
            colorStops: [
              { offset: 0, color: qrSettings.dotsColor },
              { offset: 1, color: qrSettings.gradientColor2 },
            ],
          }
        : undefined,
    },
    backgroundOptions: { color: qrSettings.backgroundColor },
    cornersSquareOptions: {
      type: qrSettings.cornersType,
      color: qrSettings.dotsColor,
    },
    cornersDotOptions: {
      type: qrSettings.cornersType === "dot" ? "dot" : "square",
      color: qrSettings.dotsColor,
    },
    image: qrSettings.logo,
    imageOptions: { imageSize: 0.22, margin: 6 },
  });
}

export function formatApiError(error, fallback) {
  const detail = error?.response?.data?.details;
  const message = error?.response?.data?.error;

  if (Array.isArray(detail)) {
    return detail.join(" | ");
  }

  return detail || message || fallback;
}

export function isUnauthorizedError(error) {
  return error?.response?.status === 401;
}

export function formatDateTimeInput(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const offset = parsed.getTimezoneOffset();
  const adjusted = new Date(parsed.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 16);
}

export function formatReadableDate(value) {
  if (!value) {
    return "No expiry";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Invalid date";
  }

  return parsed.toLocaleString();
}

export function isExpired(link) {
  return Boolean(link.expiresAt && new Date(link.expiresAt) <= new Date());
}

export function getStatusLabel(link) {
  if (!link.isActive) {
    return "Inactive";
  }

  if (isExpired(link)) {
    return "Expired";
  }

  return "Active";
}
