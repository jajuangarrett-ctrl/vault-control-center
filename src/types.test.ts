import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_DATA_SETTINGS } from "./data";
import { DEFAULT_SETTINGS, ROUTES, ROUTE_DEFINITIONS } from "./types";

describe("Areas route configuration", () => {
  it("places Areas directly between Home and Programs", () => {
    expect(ROUTES.slice(0, 3)).toEqual(["home", "areas", "programs"]);
    expect(ROUTE_DEFINITIONS.slice(0, 3).map(({ id }) => id)).toEqual([
      "home",
      "areas",
      "programs",
    ]);
    expect(ROUTE_DEFINITIONS.find(({ id }) => id === "areas")?.label).toBe(
      "Areas"
    );
  });

  it("uses the canonical Areas folder by default in both settings layers", () => {
    expect(DEFAULT_SETTINGS.areasFolder).toBe("03 Areas");
    expect(DEFAULT_DASHBOARD_DATA_SETTINGS.areasFolder).toBe("03 Areas");
  });
});
