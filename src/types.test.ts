import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_DATA_SETTINGS } from "./data";
import { DEFAULT_SETTINGS, ROUTES, ROUTE_DEFINITIONS } from "./types";

const EXPECTED_HTML_HOME_PAGES = [
  "02 Programs/Basic-Needs/Dashboards and Indexes/Basic-Needs-Program-Overview.html",
  "02 Programs/Basic-Needs/Dashboards and Indexes/CARES-Basic-Needs-Expansion-and-Resource-Criteria-Infographic.html",
  "02 Programs/Basic-Needs/MEMOS/AB132_Infographic.html",
  "02 Programs/CalWORKs/Operations/Department Meetings/CalWORKs Agenda Template.html",
  "02 Programs/CalWORKs/Work-Study/index.html",
  "03 Areas/Career/Administrators Institute/Admin Institute Draft Proposal Site/Administrator Collaborative Draft Proposal.html",
  "03 Areas/Career/Full-Time Administration Job Search Dashboard/administration-job-search-dashboard.html",
  "03 Areas/Career/Job-Applications/Apply For VPSS Position at Grossmont College/Interview Prep Dashboard.html",
  "03 Areas/Career/Job-Applications/Apply for Mesa Dean Position/Interview Prep Dashboard.html",
  "03 Areas/Career/Job-Applications/Job Applications Tasks/Apply for Miramar Acting Dean Position/Miramar Acting Dean Interview Prep Dashboard.html",
  "03 Areas/Evaluations/Evaluations 2026 - 2027/Fall 2026 Faculty Evaluation Tracker.html",
  "03 Areas/Evaluations/Evaluations 2026 - 2027/Fall 2026 Faculty Evaluation Tracker (Roberta).html",
  "03 Areas/How-To/AI/Agent Communication/Agent Communication Infographic.html",
  "03 Areas/How-To/Codex/Codex Advanced Workflow Manual/index.html",
  "03 Areas/How-To/GitHub/github-repository-experiment-hub.html",
  "03 Areas/Policies, Processes & Job Aides/Policies and Procedures Dashboard/Policies and Procedures Dashboard.html",
  "03 Areas/Self Improvement/Cognitive Biases and Laws That Explain Human Behavior/Cognitive Biases and Laws That Explain Human Behavior.html",
  "Artifacts/Agenda Dashboard/agenda.html",
  "Artifacts/Agent Mission Control/index.html",
  "Artifacts/Budget Dashboard/index.html",
  "Artifacts/CalWORKs Growth Story/index.html",
  "Artifacts/CalWORKs Schedule HTML/CalWORKs Schedule.html",
  "Artifacts/Committee Hub/index.html",
  "Artifacts/CourtCraft/index.html",
  "Artifacts/Franklins Workout Library/index.html",
  "Artifacts/Habit Tracker/2026-06-01_Habit-Tracker-Streaks.html",
  "Artifacts/ICOR Agent Dashboard/AI Agent Dashboard.html",
  "Artifacts/Inbox Morning Brief/Inbox Morning Brief.html",
  "Artifacts/Water Tracker/index.html",
  "Wiki/48-laws-of-power-study-guide.html",
] as const;

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
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(7);
    expect(DEFAULT_SETTINGS.htmlHomePages).toEqual(EXPECTED_HTML_HOME_PAGES);
    expect(new Set(DEFAULT_SETTINGS.htmlHomePages).size).toBe(30);
    expect(DEFAULT_SETTINGS.htmlHomePages.every((path) => !path.startsWith("/"))).toBe(true);
    expect(DEFAULT_SETTINGS.htmlThumbnailFolder).not.toMatch(/^\//);
    expect(ROUTES).toContain("automations");
  });

  it("uses the canonical Areas folder by default in both settings layers", () => {
    expect(DEFAULT_SETTINGS.areasFolder).toBe("03 Areas");
    expect(DEFAULT_DASHBOARD_DATA_SETTINGS.areasFolder).toBe("03 Areas");
  });
});
