/**
 * UltraVNC can stream one monitor at a time and exposes a monitor switch via
 * its own RFB extensions:
 *
 *   - pseudo-encoding 0xFFFF8005 (rfbEncodingMonitorInfo) requests the count
 *   - server message 252 (rfbMonitorInfo): type, count, padding, padding
 *   - client message 254 (rfbSetMonitor): type, index, padding, padding
 *
 * noVNC 1.7.0 does not know these extensions. This module adds the encoding
 * to SetEncodings and consumes message 252 before noVNC rejects it.
 *
 * The noVNC version is pinned in package.json. Keep all access to its
 * internals in this file.
 */

export type UltraVncMonitorState = {
  count: number;
  current: number | null;
};

export type UltraVncMonitorController = {
  select(index: number): void;
  cycle(): void;
  dispose(): void;
};

type ClientEncodings = ((socket: unknown, encodings: number[]) => void) & {
  __tailvncMonitorInfoPatched?: boolean;
};

type RfbMessages = {
  clientEncodings?: ClientEncodings;
};

type RfbConstructor = {
  messages?: RfbMessages;
};

type UltraVncSocket = {
  rQwait(message: string, bytes: number): boolean;
  rQpeek8(): number;
  rQshift8(): number;
  rQskipBytes(bytes: number): void;
  sQpush8(value: number): void;
  sQpush16(value: number): void;
  flush(): void;
};

export type UltraVncRfb = {
  constructor?: RfbConstructor;
  _sock?: UltraVncSocket;
  _FBU?: { rects: number };
  _fbWidth?: number;
  _fbHeight?: number;
  _normalMsg?: () => boolean;
  _resize?: (width: number, height: number) => void;
};

export const RFB_ENCODING_MONITOR_INFO = 0xffff8005 | 0;

export function isUltraVncDesktopName(name: string): boolean {
  return / - (?:service|application) mode$/i.test(name.trim());
}

const RFB_SET_SW = 10;
const RFB_MONITOR_INFO = 252;
const RFB_SET_MONITOR = 254;
const MONITOR_INFO_BYTES = 4;
const SWITCH_REFRESH_DELAY_MS = 300;
const RESIZE_REFRESH_DELAY_MS = 100;

let monitorInfoUsers = 0;

function getMessages(rfb: UltraVncRfb): RfbMessages | undefined {
  return rfb.constructor?.messages;
}

/**
 * The SetEncodings helper lives on the shared RFB class, so it is patched once
 * per page load. The wrapper only advertises the pseudo-encoding while a
 * controller is alive, otherwise a later connection would receive monitor info
 * messages that nothing consumes.
 */
function acquireMonitorInfoEncoding(rfb: UltraVncRfb): boolean {
  const messages = getMessages(rfb);
  const original = messages?.clientEncodings;
  if (!messages || typeof original !== "function") {
    return false;
  }

  monitorInfoUsers += 1;
  if (original.__tailvncMonitorInfoPatched) {
    return true;
  }

  const wrapped: ClientEncodings = (socket, encodings) => {
    if (
      monitorInfoUsers > 0 &&
      !encodings.includes(RFB_ENCODING_MONITOR_INFO)
    ) {
      encodings.push(RFB_ENCODING_MONITOR_INFO);
      console.info("[TailVNC] UltraVNC monitor info requested");
    }
    original.call(messages, socket, encodings);
  };
  wrapped.__tailvncMonitorInfoPatched = true;
  messages.clientEncodings = wrapped;
  return true;
}

function releaseMonitorInfoEncoding(): void {
  monitorInfoUsers = Math.max(0, monitorInfoUsers - 1);
}

export function createUltraVncMonitorController(
  rfb: UltraVncRfb,
  onChange: (state: UltraVncMonitorState) => void,
): UltraVncMonitorController {
  let count = 0;
  let current: number | null = null;
  let monitorInfoSeen = false;
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const originalNormalMsg = rfb._normalMsg;
  const originalResize = rfb._resize;
  const sock = rfb._sock;

  const canHandleMonitorInfo =
    typeof originalNormalMsg === "function" &&
    sock !== undefined &&
    typeof sock.rQwait === "function" &&
    typeof sock.rQpeek8 === "function" &&
    typeof sock.rQshift8 === "function" &&
    typeof sock.rQskipBytes === "function";

  const encodingAcquired =
    canHandleMonitorInfo && acquireMonitorInfoEncoding(rfb);

  function emit(): void {
    if (!disposed) {
      onChange({ count, current });
    }
  }

  function requestFullUpdate(): void {
    if (disposed || !sock) {
      return;
    }
    try {
      sock.sQpush8(3); // FramebufferUpdateRequest
      sock.sQpush8(0); // non-incremental
      sock.sQpush16(0);
      sock.sQpush16(0);
      sock.sQpush16(rfb._fbWidth ?? 0);
      sock.sQpush16(rfb._fbHeight ?? 0);
      sock.flush();
    } catch (error) {
      console.warn("TailVNC could not request an UltraVNC update", error);
    }
  }

  function scheduleFullUpdate(delay: number): void {
    if (disposed) {
      return;
    }
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      requestFullUpdate();
    }, delay);
  }

  function setMonitorCount(nextCount: number): void {
    const normalized =
      Number.isFinite(nextCount) && nextCount > 0 ? Math.floor(nextCount) : 0;
    const nextCurrent =
      normalized > 0 && (current === null || current >= normalized) ? 0 : current;
    const changed =
      count !== normalized || current !== nextCurrent || !monitorInfoSeen;

    count = normalized;
    current = nextCurrent;
    monitorInfoSeen = true;

    if (changed) {
      console.info(`[TailVNC] UltraVNC monitors: ${normalized}`);
      emit();
    }
  }

  function handleNormalMsg(): boolean {
    if (!disposed && sock && rfb._FBU?.rects === 0) {
      try {
        if (!sock.rQwait("UltraVNC monitor info", 1)) {
          const type = sock.rQpeek8();
          if (type === RFB_MONITOR_INFO) {
            if (sock.rQwait("UltraVNC monitor info", MONITOR_INFO_BYTES)) {
              return false;
            }
            sock.rQshift8(); // type
            const monitorCount = sock.rQshift8();
            sock.rQskipBytes(2); // padding
            setMonitorCount(monitorCount);
            return true;
          }
        }
      } catch (error) {
        console.warn("TailVNC could not read UltraVNC monitor info", error);
      }
    }

    return originalNormalMsg ? originalNormalMsg.call(rfb) : false;
  }

  function handleResize(width: number, height: number): void {
    if (originalResize) {
      originalResize.call(rfb, width, height);
    }
    if (!disposed && monitorInfoSeen) {
      scheduleFullUpdate(RESIZE_REFRESH_DELAY_MS);
    }
  }

  if (canHandleMonitorInfo) {
    rfb._normalMsg = handleNormalMsg;
  }
  if (originalResize) {
    rfb._resize = handleResize;
  }

  return {
    cycle(): void {
      if (disposed || !sock) {
        return;
      }

      try {
        sock.sQpush8(RFB_SET_SW);
        sock.sQpush8(0);
        sock.sQpush16(1);
        sock.sQpush16(1);
        sock.flush();
      } catch (error) {
        console.warn("TailVNC could not cycle the UltraVNC monitor", error);
        return;
      }

      requestFullUpdate();
      scheduleFullUpdate(SWITCH_REFRESH_DELAY_MS);
    },

    select(index: number): void {
      if (disposed || index < 0 || index >= count || !sock) {
        return;
      }

      try {
        sock.sQpush8(RFB_SET_MONITOR);
        sock.sQpush8(index);
        sock.sQpush8(0);
        sock.sQpush8(0);
        sock.flush();
      } catch (error) {
        console.warn("TailVNC could not switch the UltraVNC monitor", error);
        return;
      }

      current = index;
      emit();
      requestFullUpdate();
      scheduleFullUpdate(SWITCH_REFRESH_DELAY_MS);
    },

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (canHandleMonitorInfo) {
        rfb._normalMsg = originalNormalMsg;
      }
      if (originalResize) {
        rfb._resize = originalResize;
      }
      if (encodingAcquired) {
        releaseMonitorInfoEncoding();
      }
      count = 0;
      current = null;
      monitorInfoSeen = false;
    },
  };
}
