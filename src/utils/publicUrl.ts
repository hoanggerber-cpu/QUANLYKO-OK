const DEFAULT_PUBLIC_APP_URL = 'https://quanlyko-ph.vercel.app';

export const getPublicAppUrl = (): string => {
  const configuredUrl = String((import.meta as any).env?.VITE_PUBLIC_APP_URL || '').trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin;
  }
  return DEFAULT_PUBLIC_APP_URL;
};
