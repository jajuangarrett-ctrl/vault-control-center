import type { DashboardSettings, DashboardTheme } from "./types";

const THEME_CLASSES = ["fjg-vcc-theme-dark", "fjg-vcc-theme-light"];
const SHELL_CLASS = "fjg-vcc-shell-enabled";

export function applyDashboardTheme(settings: Pick<DashboardSettings, "theme" | "applyShellTheme">): void {
  const body = document.body;
  body.classList.remove(...THEME_CLASSES, SHELL_CLASS);
  body.classList.add(`fjg-vcc-theme-${settings.theme}`);

  if (settings.applyShellTheme) {
    body.classList.add(SHELL_CLASS);
  }
}

export function clearDashboardTheme(): void {
  document.body.classList.remove(...THEME_CLASSES, SHELL_CLASS);
}

export function oppositeTheme(theme: DashboardTheme): DashboardTheme {
  return theme === "dark" ? "light" : "dark";
}

