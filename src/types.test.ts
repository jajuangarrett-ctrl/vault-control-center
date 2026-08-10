import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_DATA_SETTINGS } from "./data";
import { DEFAULT_SETTINGS, ROUTES, ROUTE_DEFINITIONS } from "./types";

describe("Areas route configuration", () => {
  it("places Areas between Home and Programs and HTML directly after Programs", () => {
    expect(ROUTES.slice(0, 4)).toEqual(["home", "areas", "programs", "html"]);
    expect(ROUTE_DEFINITIONS.slice(0, 4).map(({ id }) => id)).toEqual([
      "home",
      "areas",
      "programs",
      "html",
    ]);
    expect(ROUTE_DEFINITIONS.find(({ id }) => id === "areas")?.label).toBe(
      "Areas"
    );
  });

  it("ships portable HTML gallery defaults and an Automations route", () => {
    expect(DEFAULT_SETTINGS.htmlRoots).toContain("Artifacts");
    expect(DEFAULT_SETTINGS.htmlThumbnailFolder).not.toMatch(/^\//);
    expect(ROUTES).toContain("automations");
  });

  it("uses the canonical Areas folder by default in both settings layers", () => {
    expect(DEFAULT_SETTINGS.areasFolder).toBe("03 Areas");
    expect(DEFAULT_DASHBOARD_DATA_SETTINGS.areasFolder).toBe("03 Areas");
  });
});
