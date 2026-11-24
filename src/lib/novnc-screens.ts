/**
 * noVNC 1.7.0 keeps only the first screen from RFB's Extended Desktop Size
 * pseudo-encoding. This module peeks at the payload before noVNC consumes it
 * and uses noVNC's Display viewport to show one screen at a time.
 *
 * noVNC is pinned in package.json. Keep all access to its internals in this
 * file so an upgrade only requires changes here.
 */

export type VncScreen = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
  primary: boolean;
};

export type ScreenState = {
  screens: VncScreen[];
  selectedId: number | null;
};

export type ViewportSize = {
  width: number;
  height: number;
};

type DisplayViewport = {
  clipViewport: boolean;
  autoscale(width: number, height: number): void;
  viewportChangeSize(width: number, height: number): void;
  viewportChangePos(deltaX: number, deltaY: number): void;
  readonly _viewportLoc: { x: number; y: number; w: number; h: number };
};

type RawVncSocket = {
  rQwait(message: string, bytes: number): boolean;
  rQpeek8(): number;
  rQpeekBytes(length: number): Uint8Array;
};

/**
 * The small part of noVNC's RFB object this module relies on. All properties
 * are optional so a noVNC upgrade degrades to the normal full-desktop view.
 */
export type ScreenRfb = {
  _sock?: RawVncSocket;
  _display?: DisplayViewport;
  _handleExtendedDesktopSize?: () => boolean;
  _updateScale?: () => void;
};

export type ScreenController = {
  select(id: number | null): void;
  dispose(): void;
};

const HEADER_SIZE = 4;
const SCREEN_SIZE = 16;

export function parseExtendedDesktopScreens(payload: Uint8Array): VncScreen[] | null {
  if (payload.byteLength < HEADER_SIZE) {
    return null;
  }

  const count = payload[0];
  const expectedLength = HEADER_SIZE + count * SCREEN_SIZE;
  if (payload.byteLength < expectedLength) {
    return null;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const screens: VncScreen[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = HEADER_SIZE + index * SCREEN_SIZE;
    const width = view.getUint16(offset + 8);
    const height = view.getUint16(offset + 10);
    if (width === 0 || height === 0) {
      continue;
    }

    const flags = view.getUint32(offset + 12);
    screens.push({
      id: view.getUint32(offset),
      x: view.getUint16(offset + 4),
      y: view.getUint16(offset + 6),
      width,
      height,
      flags,
      primary: (flags & 0x1) !== 0,
    });
  }

  return screens;
}

function normalizeScreens(screens: VncScreen[]): VncScreen[] {
  const unique = new Map<number, VncScreen>();
  for (const screen of screens) {
    if (!unique.has(screen.id)) {
      unique.set(screen.id, screen);
    }
  }

  return [...unique.values()].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.id - b.id,
  );
}

function layoutSignature(screens: VncScreen[]): string {
  return screens
    .map(
      (screen) =>
        `${screen.id}:${screen.x},${screen.y},${screen.width},${screen.height},${screen.flags}`,
    )
    .join("|");
}

export function createScreenController(
  rfb: ScreenRfb,
  getViewportSize: () => ViewportSize,
  onChange: (state: ScreenState) => void,
): ScreenController {
  let screens: VncScreen[] = [];
  let selectedId: number | null = null;
  let lastSignature: string | null = null;
  let disposed = false;

  const originalHandle = rfb._handleExtendedDesktopSize;
  const originalUpdateScale = rfb._updateScale;

  function emit(): void {
    if (!disposed) {
      onChange({ screens, selectedId });
    }
  }

  function findSelected(): VncScreen | undefined {
    return selectedId === null
      ? undefined
      : screens.find((screen) => screen.id === selectedId);
  }

  function applyViewport(): void {
    try {
      const display = rfb._display;
      if (
        !display ||
        typeof display.autoscale !== "function" ||
        typeof display.viewportChangeSize !== "function" ||
        typeof display.viewportChangePos !== "function" ||
        !display._viewportLoc
      ) {
        return;
      }

      const size = getViewportSize();
      if (!(size.width > 0 && size.height > 0)) {
        return;
      }

      const screen = findSelected();
      if (!screen) {
        if (display.clipViewport) {
          display.clipViewport = false;
        }
        display.autoscale(size.width, size.height);
        return;
      }

      if (!display.clipViewport) {
        display.clipViewport = true;
      }

      const before = display._viewportLoc;
      if (before.w !== screen.width || before.h !== screen.height) {
        display.viewportChangeSize(screen.width, screen.height);
      }

      const current = display._viewportLoc;
      if (current.x !== screen.x || current.y !== screen.y) {
        display.viewportChangePos(screen.x - current.x, screen.y - current.y);
      }

      display.autoscale(size.width, size.height);
    } catch (error) {
      console.warn("TailVNC could not apply the VNC screen viewport", error);
    }
  }

  function updateLayout(nextScreens: VncScreen[]): void {
    const normalized = normalizeScreens(nextScreens);
    const nextSelectedId =
      normalized.length > 1 &&
      selectedId !== null &&
      normalized.some((screen) => screen.id === selectedId)
        ? selectedId
        : null;
    const nextSignature = layoutSignature(normalized);
    const changed =
      nextSignature !== lastSignature || nextSelectedId !== selectedId;

    screens = normalized;
    selectedId = nextSelectedId;
    lastSignature = nextSignature;

    if (changed) {
      console.info(
        `[TailVNC] VNC screen layout (${normalized.length})`,
        normalized.map(({ id, x, y, width, height }) => ({
          id,
          x,
          y,
          width,
          height,
        })),
      );
      emit();
    }
  }

  function handleExtendedDesktopSize(): boolean {
    let pendingLayout: VncScreen[] | null = null;

    if (!disposed) {
      const sock = rfb._sock;
      if (
        sock &&
        typeof sock.rQwait === "function" &&
        typeof sock.rQpeek8 === "function" &&
        typeof sock.rQpeekBytes === "function"
      ) {
        try {
          if (!sock.rQwait("TailVNC screen layout", HEADER_SIZE)) {
            const count = sock.rQpeek8();
            const length = HEADER_SIZE + count * SCREEN_SIZE;
            if (!sock.rQwait("TailVNC screen layout", length)) {
              pendingLayout = parseExtendedDesktopScreens(
                sock.rQpeekBytes(length),
              );
            }
          }
        } catch (error) {
          console.warn("TailVNC could not read the VNC screen layout", error);
        }
      }
    }

    if (!originalHandle) {
      return false;
    }

    const result = originalHandle.call(rfb);
    if (pendingLayout !== null && !disposed) {
      try {
        updateLayout(pendingLayout);
        applyViewport();
      } catch (error) {
        console.warn("TailVNC could not update the VNC screen layout", error);
      }
    }
    return result;
  }

  function handleUpdateScale(): void {
    if (!originalUpdateScale) {
      return;
    }

    originalUpdateScale.call(rfb);
    if (!disposed && selectedId !== null) {
      applyViewport();
    }
  }

  if (originalHandle) {
    rfb._handleExtendedDesktopSize = handleExtendedDesktopSize;
  }
  if (originalUpdateScale) {
    rfb._updateScale = handleUpdateScale;
  }

  return {
    select(id: number | null): void {
      if (disposed) {
        return;
      }

      const next =
        id !== null && screens.some((screen) => screen.id === id) ? id : null;
      const changed = next !== selectedId;

      selectedId = next;
      applyViewport();
      if (changed) {
        emit();
      }
    },

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      if (originalHandle) {
        rfb._handleExtendedDesktopSize = originalHandle;
      }
      if (originalUpdateScale) {
        rfb._updateScale = originalUpdateScale;
      }
      screens = [];
      selectedId = null;
      lastSignature = null;
    },
  };
}
