import { describe, expect, it, vi } from "vitest";
import {
  createScreenController,
  parseExtendedDesktopScreens,
  type ScreenRfb,
} from "../src/lib/novnc-screens";

type ScreenInput = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  flags?: number;
};

function buildLayout(screens: ScreenInput[]): Uint8Array {
  const bytes = new Uint8Array(4 + screens.length * 16);
  bytes[0] = screens.length;
  const view = new DataView(bytes.buffer);

  screens.forEach((screen, index) => {
    const offset = 4 + index * 16;
    view.setUint32(offset, screen.id);
    view.setUint16(offset + 4, screen.x);
    view.setUint16(offset + 6, screen.y);
    view.setUint16(offset + 8, screen.width);
    view.setUint16(offset + 10, screen.height);
    view.setUint32(offset + 12, screen.flags ?? 0);
  });

  return bytes;
}

function createFakeRfb(initialPayload: Uint8Array) {
  let payload = initialPayload;
  const display = {
    clipViewport: false,
    _viewportLoc: { x: 0, y: 0, w: 3840, h: 1080 },
    autoscale: vi.fn(),
    viewportChangeSize: vi.fn((width: number, height: number) => {
      display._viewportLoc.w = width;
      display._viewportLoc.h = height;
      display._viewportLoc.x = Math.min(display._viewportLoc.x, 3840 - width);
      display._viewportLoc.y = Math.min(display._viewportLoc.y, 1080 - height);
    }),
    viewportChangePos: vi.fn((deltaX: number, deltaY: number) => {
      display._viewportLoc.x += deltaX;
      display._viewportLoc.y += deltaY;
    }),
  };
  const sock = {
    rQwait: vi.fn(() => false),
    rQpeek8: vi.fn(() => payload[0]),
    rQpeekBytes: vi.fn(() => payload),
  };
  const originalHandle = vi.fn(() => true);
  const originalScale = vi.fn();
  const rfb: ScreenRfb = {
    _sock: sock,
    _display: display,
    _handleExtendedDesktopSize: originalHandle,
    _updateScale: originalScale,
  };

  return {
    rfb,
    display,
    sock,
    originalHandle,
    originalScale,
    setPayload(next: Uint8Array) {
      payload = next;
    },
  };
}

describe("parseExtendedDesktopScreens", () => {
  it("parses every screen record", () => {
    const screens = parseExtendedDesktopScreens(
      buildLayout([
        { id: 11, x: 0, y: 0, width: 1920, height: 1080, flags: 1 },
        { id: 22, x: 1920, y: 0, width: 2560, height: 1440 },
      ]),
    );

    expect(screens).toEqual([
      {
        id: 11,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        flags: 1,
        primary: true,
      },
      {
        id: 22,
        x: 1920,
        y: 0,
        width: 2560,
        height: 1440,
        flags: 0,
        primary: false,
      },
    ]);
  });

  it("returns null when the payload is incomplete", () => {
    expect(parseExtendedDesktopScreens(new Uint8Array([2, 0, 0, 0]))).toBeNull();
    expect(parseExtendedDesktopScreens(new Uint8Array([0, 0]))).toBeNull();
  });

  it("accepts an empty screen list", () => {
    expect(parseExtendedDesktopScreens(new Uint8Array([0, 0, 0, 0]))).toEqual([]);
  });

  it("drops screens without a drawable area", () => {
    const screens = parseExtendedDesktopScreens(
      buildLayout([
        { id: 1, x: 0, y: 0, width: 0, height: 1080 },
        { id: 2, x: 0, y: 0, width: 1280, height: 720 },
      ]),
    );

    expect(screens?.map((screen) => screen.id)).toEqual([2]);
  });
});

describe("createScreenController", () => {
  const twoScreens = buildLayout([
    { id: 7, x: 1920, y: 0, width: 1920, height: 1080 },
    { id: 3, x: 0, y: 0, width: 1920, height: 1080, flags: 1 },
  ]);

  it("detects screens and switches the viewport", () => {
    const fake = createFakeRfb(twoScreens);
    const onChange = vi.fn();
    const controller = createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      onChange,
    );

    expect(fake.rfb._handleExtendedDesktopSize?.()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith({
      screens: [
        {
          id: 3,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          flags: 1,
          primary: true,
        },
        {
          id: 7,
          x: 1920,
          y: 0,
          width: 1920,
          height: 1080,
          flags: 0,
          primary: false,
        },
      ],
      selectedId: null,
    });

    controller.select(7);
    expect(onChange).toHaveBeenLastCalledWith({
      screens: [
        expect.objectContaining({ id: 3 }),
        expect.objectContaining({ id: 7 }),
      ],
      selectedId: 7,
    });
    expect(fake.display.clipViewport).toBe(true);
    expect(fake.display.viewportChangeSize).toHaveBeenCalledWith(1920, 1080);
    expect(fake.display.viewportChangePos).toHaveBeenCalledWith(1920, 0);
    expect(fake.display.autoscale).toHaveBeenLastCalledWith(1280, 720);

    controller.select(3);
    expect(fake.display.viewportChangePos).toHaveBeenLastCalledWith(-1920, 0);
    expect(fake.display.autoscale).toHaveBeenLastCalledWith(1280, 720);
  });

  it("reapplies the selection when noVNC recalculates the scale", () => {
    const fake = createFakeRfb(twoScreens);
    const controller = createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      vi.fn(),
    );

    fake.rfb._handleExtendedDesktopSize?.();
    controller.select(7);
    fake.display.autoscale.mockClear();

    fake.rfb._updateScale?.();

    expect(fake.originalScale).toHaveBeenCalledOnce();
    expect(fake.display.autoscale).toHaveBeenCalledWith(1280, 720);
  });

  it("does not interfere with noVNC while all displays are selected", () => {
    const fake = createFakeRfb(twoScreens);
    createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      vi.fn(),
    );

    fake.rfb._handleExtendedDesktopSize?.();
    fake.display.autoscale.mockClear();

    fake.rfb._updateScale?.();

    expect(fake.originalScale).toHaveBeenCalledOnce();
    expect(fake.display.autoscale).not.toHaveBeenCalled();
  });

  it("returns to the full desktop after selecting all displays", () => {
    const fake = createFakeRfb(twoScreens);
    const controller = createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      vi.fn(),
    );

    fake.rfb._handleExtendedDesktopSize?.();
    controller.select(7);
    fake.display.autoscale.mockClear();

    controller.select(null);

    expect(fake.display.clipViewport).toBe(false);
    expect(fake.display.autoscale).toHaveBeenCalledWith(1280, 720);
  });

  it("keeps the selection when the layout still contains that screen", () => {
    const fake = createFakeRfb(twoScreens);
    const onChange = vi.fn();
    const controller = createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      onChange,
    );

    fake.rfb._handleExtendedDesktopSize?.();
    controller.select(7);

    fake.setPayload(
      buildLayout([
        { id: 7, x: 0, y: 0, width: 1920, height: 1080 },
        { id: 3, x: 1920, y: 0, width: 1920, height: 1080 },
      ]),
    );
    fake.rfb._handleExtendedDesktopSize?.();

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedId: 7 }),
    );
    expect(fake.display.viewportChangePos).toHaveBeenLastCalledWith(-1920, 0);
  });

  it("resets the selection when a screen disappears", () => {
    const fake = createFakeRfb(twoScreens);
    const onChange = vi.fn();
    const controller = createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      onChange,
    );

    fake.rfb._handleExtendedDesktopSize?.();
    controller.select(7);

    fake.setPayload(
      buildLayout([{ id: 3, x: 0, y: 0, width: 1920, height: 1080 }]),
    );
    fake.rfb._handleExtendedDesktopSize?.();

    expect(onChange).toHaveBeenLastCalledWith({
      screens: [expect.objectContaining({ id: 3 })],
      selectedId: null,
    });
    expect(fake.display.clipViewport).toBe(false);
  });

  it("ignores incomplete payloads", () => {
    const fake = createFakeRfb(twoScreens);
    const onChange = vi.fn();
    createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      onChange,
    );

    fake.sock.rQwait.mockReturnValue(true);

    expect(fake.rfb._handleExtendedDesktopSize?.()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restores noVNC methods when disposed", () => {
    const fake = createFakeRfb(twoScreens);
    const controller = createScreenController(
      fake.rfb,
      () => ({ width: 1280, height: 720 }),
      vi.fn(),
    );

    expect(fake.rfb._handleExtendedDesktopSize).not.toBe(fake.originalHandle);
    expect(fake.rfb._updateScale).not.toBe(fake.originalScale);

    controller.dispose();

    expect(fake.rfb._handleExtendedDesktopSize).toBe(fake.originalHandle);
    expect(fake.rfb._updateScale).toBe(fake.originalScale);
  });

  it("is a no-op when noVNC internals are unavailable", () => {
    const controller = createScreenController(
      {},
      () => ({ width: 1280, height: 720 }),
      vi.fn(),
    );

    expect(() => controller.select(1)).not.toThrow();
    expect(() => controller.select(null)).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
  });
});
