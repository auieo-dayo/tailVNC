import { describe, expect, it, vi } from "vitest";
import {
  createUltraVncMonitorController,
  isUltraVncDesktopName,
  RFB_ENCODING_MONITOR_INFO,
  type UltraVncRfb,
} from "../src/lib/ultravnc-monitors";

function createFakeRfb() {
  const queue: number[] = [];
  const pushed8: number[] = [];
  const pushed16: number[] = [];

  const sock = {
    rQwait: vi.fn((_message: string, bytes: number) => queue.length < bytes),
    rQpeek8: vi.fn(() => queue[0] ?? 0),
    rQshift8: vi.fn(() => queue.shift() ?? 0),
    rQskipBytes: vi.fn((bytes: number) => {
      queue.splice(0, bytes);
    }),
    sQpush8: vi.fn((value: number) => {
      pushed8.push(value);
    }),
    sQpush16: vi.fn((value: number) => {
      pushed16.push(value);
    }),
    flush: vi.fn(),
  };

  const originalNormalMsg = vi.fn(() => true);
  const originalResize = vi.fn();
  const display = {
    clipViewport: false,
    _viewportLoc: { x: 1920, y: 0, w: 1920, h: 1080 },
    viewportChangeSize: vi.fn((width: number, height: number) => {
      display._viewportLoc.w = width;
      display._viewportLoc.h = height;
    }),
    viewportChangePos: vi.fn((deltaX: number, deltaY: number) => {
      display._viewportLoc.x += deltaX;
      display._viewportLoc.y += deltaY;
    }),
  };
  const updateScale = vi.fn();
  const clientEncodings = vi.fn(
    (_socket: unknown, _encodings: number[]) => {},
  );
  const messages = { clientEncodings };
  const rfb = {
    constructor: { messages },
    _sock: sock,
    _display: display,
    _FBU: { rects: 0 },
    _fbWidth: 1920,
    _fbHeight: 1080,
    _normalMsg: originalNormalMsg,
    _resize: originalResize,
    _updateScale: updateScale,
  } as unknown as UltraVncRfb;

  return {
    rfb,
    messages,
    sock,
    display,
    updateScale,
    queue,
    pushed8,
    pushed16,
    originalNormalMsg,
    originalResize,
    clientEncodings,
  };
}

describe("isUltraVncDesktopName", () => {
  it("recognizes UltraVNC desktop names", () => {
    expect(isUltraVncDesktopName("msi - service mode")).toBe(true);
    expect(isUltraVncDesktopName("MSI - Application Mode")).toBe(true);
  });

  it("rejects other desktop names", () => {
    expect(isUltraVncDesktopName("msi")).toBe(false);
    expect(isUltraVncDesktopName("msi - service mode extra")).toBe(false);
  });
});

describe("createUltraVncMonitorController", () => {
  it("adds the monitor info pseudo-encoding to SetEncodings", () => {
    const fake = createFakeRfb();
    const controller = createUltraVncMonitorController(fake.rfb, vi.fn());

    const encodings = [0, 16];
    fake.rfb.constructor?.messages?.clientEncodings?.(fake.sock, encodings);

    expect(encodings).toEqual([0, 16, RFB_ENCODING_MONITOR_INFO]);
    expect(fake.clientEncodings).toHaveBeenCalledWith(fake.sock, encodings);

    controller.dispose();

    const afterDispose = [0, 16];
    fake.rfb.constructor?.messages?.clientEncodings?.(fake.sock, afterDispose);
    expect(afterDispose).toEqual([0, 16]);
  });

  it("reads the UltraVNC monitor count", () => {
    const fake = createFakeRfb();
    const onChange = vi.fn();
    const controller = createUltraVncMonitorController(fake.rfb, onChange);

    fake.queue.push(252, 2, 0, 0);

    expect(fake.rfb._normalMsg?.()).toBe(true);
    expect(fake.originalNormalMsg).not.toHaveBeenCalled();
    expect(fake.queue).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith({
      count: 2,
      current: null,
      all: null,
    });

    controller.dispose();
  });

  it("waits when the monitor info message is incomplete", () => {
    const fake = createFakeRfb();
    const onChange = vi.fn();
    const controller = createUltraVncMonitorController(fake.rfb, onChange);

    fake.queue.push(252, 2);

    expect(fake.rfb._normalMsg?.()).toBe(false);
    expect(fake.queue).toEqual([252, 2]);
    expect(onChange).not.toHaveBeenCalled();

    fake.queue.push(0, 0);
    expect(fake.rfb._normalMsg?.()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith({
      count: 2,
      current: null,
      all: null,
    });

    controller.dispose();
  });

  it("passes unrelated server messages to noVNC", () => {
    const fake = createFakeRfb();
    const onChange = vi.fn();
    const controller = createUltraVncMonitorController(fake.rfb, onChange);

    fake.queue.push(2);

    expect(fake.rfb._normalMsg?.()).toBe(true);
    expect(fake.originalNormalMsg).toHaveBeenCalledOnce();
    expect(fake.queue).toEqual([2]);
    expect(onChange).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("leaves all-monitors mode and selects a monitor", () => {
    const fake = createFakeRfb();
    const onChange = vi.fn();
    const controller = createUltraVncMonitorController(fake.rfb, onChange);

    fake.queue.push(252, 2, 0, 0);
    fake.rfb._normalMsg?.();
    fake.pushed8.length = 0;
    fake.pushed16.length = 0;
    fake.sock.flush.mockClear();

    controller.select(1);

    expect(onChange).toHaveBeenLastCalledWith({
      count: 2,
      current: 1,
      all: false,
    });
    // last monitor -> all -> primary -> selected monitor
    expect(fake.pushed8).toEqual([
      254, 1, 0, 0, 10, 0, 10, 0, 254, 1, 0, 0, 3, 0,
    ]);
    expect(fake.pushed16).toEqual([1, 1, 1, 1, 0, 0, 1920, 1080]);
    expect(fake.sock.flush).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("switches directly once a single monitor is known", () => {
    const fake = createFakeRfb();
    const controller = createUltraVncMonitorController(fake.rfb, vi.fn());

    fake.queue.push(252, 2, 0, 0);
    fake.rfb._normalMsg?.();
    controller.select(1);
    fake.pushed8.length = 0;
    fake.pushed16.length = 0;
    fake.sock.flush.mockClear();

    controller.select(0);

    expect(fake.pushed8).toEqual([254, 0, 0, 0, 3, 0]);
    expect(fake.pushed16).toEqual([0, 0, 1920, 1080]);

    controller.dispose();
  });

  it("shows all monitors", () => {
    const fake = createFakeRfb();
    const onChange = vi.fn();
    const controller = createUltraVncMonitorController(fake.rfb, onChange);

    fake.queue.push(252, 2, 0, 0);
    fake.rfb._normalMsg?.();
    fake.pushed8.length = 0;
    fake.pushed16.length = 0;
    fake.sock.flush.mockClear();

    controller.selectAll();

    expect(onChange).toHaveBeenLastCalledWith({
      count: 2,
      current: null,
      all: true,
    });
    expect(fake.pushed8).toEqual([254, 1, 0, 0, 10, 0, 3, 0]);
    expect(fake.pushed16).toEqual([1, 1, 0, 0, 1920, 1080]);

    controller.dispose();
  });

  it("cycles monitors for older UltraVNC servers", () => {
    const fake = createFakeRfb();
    const controller = createUltraVncMonitorController(fake.rfb, vi.fn());

    fake.pushed8.length = 0;
    fake.pushed16.length = 0;
    fake.sock.flush.mockClear();

    controller.cycle();

    expect(fake.pushed8).toEqual([10, 0, 3, 0]);
    expect(fake.pushed16).toEqual([1, 1, 0, 0, 1920, 1080]);
    expect(fake.sock.flush).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("ignores monitor indexes outside the reported count", () => {
    const fake = createFakeRfb();
    const onChange = vi.fn();
    const controller = createUltraVncMonitorController(fake.rfb, onChange);

    fake.queue.push(252, 2, 0, 0);
    fake.rfb._normalMsg?.();
    fake.pushed8.length = 0;
    fake.sock.flush.mockClear();
    onChange.mockClear();

    controller.select(2);

    expect(onChange).not.toHaveBeenCalled();
    expect(fake.pushed8).toEqual([]);
    expect(fake.sock.flush).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("resets the viewport after a monitor desktop resize", () => {
    const fake = createFakeRfb();
    const controller = createUltraVncMonitorController(fake.rfb, vi.fn());

    fake.queue.push(252, 2, 0, 0);
    fake.rfb._normalMsg?.();
    fake.rfb._resize?.(1920, 1080);

    expect(fake.display.clipViewport).toBe(true);
    expect(fake.display._viewportLoc.x).toBe(0);
    expect(fake.display._viewportLoc.y).toBe(0);
    expect(fake.updateScale).toHaveBeenCalledOnce();

    controller.dispose();
  });

  it("refreshes after a desktop resize", () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRfb();
      const controller = createUltraVncMonitorController(fake.rfb, vi.fn());

      fake.queue.push(252, 2, 0, 0);
      fake.rfb._normalMsg?.();
      fake.pushed8.length = 0;
      fake.pushed16.length = 0;

      fake.rfb._resize?.(1920, 1080);
      expect(fake.originalResize).toHaveBeenCalledWith(1920, 1080);

      vi.advanceTimersByTime(100);
      expect(fake.pushed8).toEqual([3, 0]);
      expect(fake.pushed16).toEqual([0, 0, 1920, 1080]);

      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores noVNC methods and clears timers when disposed", () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeRfb();
      const controller = createUltraVncMonitorController(fake.rfb, vi.fn());

      expect(fake.rfb._normalMsg).not.toBe(fake.originalNormalMsg);
      expect(fake.rfb._resize).not.toBe(fake.originalResize);

      fake.queue.push(252, 2, 0, 0);
      fake.rfb._normalMsg?.();
      controller.select(1);
      fake.pushed8.length = 0;

      controller.dispose();
      expect(fake.rfb._normalMsg).toBe(fake.originalNormalMsg);
      expect(fake.rfb._resize).toBe(fake.originalResize);

      vi.advanceTimersByTime(1000);
      expect(fake.pushed8).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op when noVNC internals are unavailable", () => {
    const controller = createUltraVncMonitorController(
      {} as UltraVncRfb,
      vi.fn(),
    );

    expect(() => controller.select(0)).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
  });
});
