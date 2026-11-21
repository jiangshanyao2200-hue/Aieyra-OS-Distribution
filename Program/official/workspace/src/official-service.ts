import rawOfficialService from "../shared/config/official-service.json" with { type: "json" };

export type OfficialPortalPage = "account" | "login" | "register" | "wallet" | "usage" | "keys";

type OfficialServiceConfig = {
  version: number;
  serviceName: string;
  portalOrigin: string;
  accountApiOrigin?: string;
  apiOrigin: string;
  cookieDomain: string;
  legacyOrigins: readonly string[];
  portalRoutes: Readonly<Record<OfficialPortalPage, string>>;
};

function trustedOrigin(value: string, label: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`Official service ${label} must be a credential-free HTTPS origin.`);
  }
  return parsed.origin;
}

const typedOfficialService = rawOfficialService as OfficialServiceConfig;
const portalOrigin = trustedOrigin(typedOfficialService.portalOrigin, "portalOrigin");
const accountApiOrigin = trustedOrigin(typedOfficialService.accountApiOrigin || typedOfficialService.portalOrigin, "accountApiOrigin");
const apiOrigin = trustedOrigin(typedOfficialService.apiOrigin, "apiOrigin");

export const OFFICIAL_SERVICE: OfficialServiceConfig = Object.freeze({
  ...typedOfficialService,
  portalOrigin,
  accountApiOrigin,
  apiOrigin,
  legacyOrigins: Object.freeze([...typedOfficialService.legacyOrigins]),
  portalRoutes: Object.freeze({ ...typedOfficialService.portalRoutes })
});
export const OFFICIAL_PORTAL_HOST = new URL(OFFICIAL_SERVICE.portalOrigin).host;

export function officialPortalUrl(page: OfficialPortalPage = "account") {
  const route = OFFICIAL_SERVICE.portalRoutes[page];
  if (!/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(route)) throw new Error(`Official service route ${page} is invalid.`);
  const target = new URL(route, OFFICIAL_SERVICE.portalOrigin);
  if (target.origin !== OFFICIAL_SERVICE.portalOrigin || target.search || target.hash) {
    throw new Error(`Official service route ${page} must stay on the configured portal origin.`);
  }
  return target.toString();
}
