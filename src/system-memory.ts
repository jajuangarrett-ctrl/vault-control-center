export type SystemMemoryHealthTone = "positive" | "attention" | "critical";

export interface SystemMemoryCommandOptions {
  encoding: "utf8";
  maxBuffer: number;
  shell: false;
  timeout: number;
}

export interface SystemMemoryCommandResult {
  stdout: string;
  stderr: string;
}

export type SystemMemoryCommandRunner = (
  executable: string,
  args: readonly string[],
  options: SystemMemoryCommandOptions
) => Promise<SystemMemoryCommandResult>;

export interface SystemMemoryOsProvider {
  totalmem(): number;
  freemem(): number;
}

export interface SystemMemoryPlatformOptions {
  /** Must be true only for the desktop macOS build of Obsidian. */
  isDesktopMac: boolean;
  /** Must be true only on the Mac that owns the loaded automation jobs. */
  isExecutorEligible: boolean;
  now?: Date;
  runner?: SystemMemoryCommandRunner;
  osProvider?: SystemMemoryOsProvider;
}

export interface SystemMemoryUsage {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  freePercent: number;
  usedPercent: number;
  tone: SystemMemoryHealthTone;
}

export interface SystemMemoryReadySnapshot extends SystemMemoryUsage {
  status: "ready";
  checkedAt: string;
  source: "memory-pressure" | "node-os";
  message: string;
}

export interface SystemMemoryUnavailableSnapshot {
  status: "unavailable";
  checkedAt: string;
  reason: "unsupported-platform" | "ineligible-host";
  message: string;
}

export interface SystemMemoryErrorSnapshot {
  status: "error";
  checkedAt: string;
  reason: "memory-read-failed";
  message: string;
}

export type SystemMemorySnapshot =
  | SystemMemoryReadySnapshot
  | SystemMemoryUnavailableSnapshot
  | SystemMemoryErrorSnapshot;

const MEMORY_PRESSURE_EXECUTABLE = "/usr/bin/memory_pressure";
const MEMORY_PRESSURE_ARGS = ["-Q"] as const;
const MEMORY_PRESSURE_OPTIONS: SystemMemoryCommandOptions = {
  encoding: "utf8",
  maxBuffer: 64 * 1024,
  shell: false,
  timeout: 4_000,
};

/** Parse the one stable summary value emitted by `memory_pressure -Q`. */
export function parseMemoryPressureFreePercent(output: string): number | null {
  const match = output.match(
    /System-wide\s+memory\s+free\s+percentage\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i
  );
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return isValidPercent(value) ? roundPercent(value) : null;
}

export function getMemoryHealthTone(usedPercent: number): SystemMemoryHealthTone {
  if (usedPercent >= 85) {
    return "critical";
  }
  if (usedPercent >= 70) {
    return "attention";
  }
  return "positive";
}

export function calculateMemoryUsage(
  totalBytes: number,
  freePercent: number
): SystemMemoryUsage | null {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !isValidPercent(freePercent)) {
    return null;
  }

  const normalizedFreePercent = roundPercent(freePercent);
  const usedPercent = roundPercent(100 - normalizedFreePercent);
  const availableBytes = Math.round(totalBytes * (normalizedFreePercent / 100));
  const usedBytes = Math.max(0, Math.round(totalBytes - availableBytes));

  return {
    totalBytes: Math.round(totalBytes),
    availableBytes,
    usedBytes,
    freePercent: normalizedFreePercent,
    usedPercent,
    tone: getMemoryHealthTone(usedPercent),
  };
}

/**
 * Read memory only when the caller has positively identified the desktop
 * executor Mac. This deliberately does not infer identity from the hostname.
 */
export async function buildSystemMemorySnapshot(
  options: SystemMemoryPlatformOptions
): Promise<SystemMemorySnapshot> {
  const checkedAt = (options.now ?? new Date()).toISOString();

  if (!options.isDesktopMac) {
    return {
      status: "unavailable",
      checkedAt,
      reason: "unsupported-platform",
      message: "RAM monitoring is available in desktop Obsidian on macOS.",
    };
  }

  if (!options.isExecutorEligible) {
    return {
      status: "unavailable",
      checkedAt,
      reason: "ineligible-host",
      message: "RAM monitoring is shown only on the Mac running the vault automations.",
    };
  }

  try {
    const osProvider = options.osProvider ?? (await loadOsProvider());
    const totalBytes = osProvider.totalmem();
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error("The operating system did not report total memory.");
    }

    const runner = options.runner ?? (await loadCommandRunner());
    try {
      const result = await runner(
        MEMORY_PRESSURE_EXECUTABLE,
        MEMORY_PRESSURE_ARGS,
        MEMORY_PRESSURE_OPTIONS
      );
      const freePercent = parseMemoryPressureFreePercent(result.stdout);
      if (freePercent !== null) {
        const usage = calculateMemoryUsage(totalBytes, freePercent);
        if (usage) {
          return readySnapshot(checkedAt, usage, "memory-pressure");
        }
      }
    } catch {
      // `memory_pressure` can be unavailable in restricted Electron contexts.
      // The OS counters below remain a safe, local fallback.
    }

    const freeBytes = osProvider.freemem();
    if (!Number.isFinite(freeBytes) || freeBytes < 0 || freeBytes > totalBytes) {
      throw new Error("The operating system did not report usable free memory.");
    }
    const freePercent = (freeBytes / totalBytes) * 100;
    const usage = calculateMemoryUsage(totalBytes, freePercent);
    if (!usage) {
      throw new Error("Memory usage could not be calculated.");
    }
    return readySnapshot(checkedAt, usage, "node-os");
  } catch {
    return {
      status: "error",
      checkedAt,
      reason: "memory-read-failed",
      message: "RAM usage could not be read on this Mac.",
    };
  }
}

function readySnapshot(
  checkedAt: string,
  usage: SystemMemoryUsage,
  source: SystemMemoryReadySnapshot["source"]
): SystemMemoryReadySnapshot {
  return {
    status: "ready",
    checkedAt,
    source,
    message: `${usage.usedPercent}% of memory is in use.`,
    ...usage,
  };
}

function isValidPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

async function loadOsProvider(): Promise<SystemMemoryOsProvider> {
  const os = await import("node:os");
  return {
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
  };
}

async function loadCommandRunner(): Promise<SystemMemoryCommandRunner> {
  const childProcess = await import("node:child_process");
  return (executable, args, options) =>
    new Promise<SystemMemoryCommandResult>((resolve, reject) => {
      childProcess.execFile(
        executable,
        [...args],
        options,
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
}
