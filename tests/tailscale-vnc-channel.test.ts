import { describe, expect, it, vi } from "vitest";
import {
  TailscaleVncChannel,
  type TcpByteStream,
} from "../src/lib/tailscale-vnc-channel";

function createStream() {
  let resolveRead: (value: Uint8Array | null) => void = () => {};
  const write = vi.fn(async (_data: Uint8Array) => {});
  const stream: TcpByteStream = {
    read: vi.fn(
      () =>
        new Promise<Uint8Array | null>((resolve) => {
          resolveRead = resolve;
        }),
    ),
    write,
    close: vi.fn(async () => {
      resolveRead(null);
    }),
  };
  return {
    stream,
    write,
    deliver: (value: Uint8Array | null) => resolveRead(value),
  };
}

describe("TailscaleVncChannel", () => {
  it("opens before forwarding received bytes", async () => {
    const { stream, deliver } = createStream();
    const channel = new TailscaleVncChannel(stream);
    const onmessage = vi.fn();
    const onopen = vi.fn();
    channel.onmessage = onmessage;
    channel.onopen = onopen;

    deliver(new Uint8Array([82, 70, 66]));
    await vi.waitFor(() => expect(onmessage).toHaveBeenCalledOnce());

    expect(onopen).toHaveBeenCalledOnce();
    expect(onopen.mock.invocationCallOrder[0]).toBeLessThan(
      onmessage.mock.invocationCallOrder[0],
    );
    expect([...new Uint8Array(onmessage.mock.calls[0][0].data)]).toEqual([
      82, 70, 66,
    ]);
    expect(channel.diagnostics).toEqual({
      receivedBytes: 3,
      initialBytes: [82, 70, 66],
    });
    channel.close();
  });

  it("normalizes ArrayBuffer values returned by the WASM bridge", async () => {
    let readCount = 0;
    const stream: TcpByteStream = {
      read: vi.fn(async () => {
        readCount += 1;
        return readCount === 1 ? new Uint8Array([82, 70, 66]).buffer : null;
      }),
      write: vi.fn(async (_data: Uint8Array) => {}),
      close: vi.fn(async () => {}),
    };
    const channel = new TailscaleVncChannel(stream);
    const messages: number[][] = [];
    channel.onmessage = (event) => messages.push([...new Uint8Array(event.data)]);
    channel.onopen = vi.fn();

    await vi.waitFor(() => expect(messages).toEqual([[82, 70, 66]]));

    expect(channel.diagnostics).toEqual({
      receivedBytes: 3,
      initialBytes: [82, 70, 66],
    });
  });

  it("buffers bytes received before noVNC subscribes", async () => {
    const { stream, deliver } = createStream();
    const channel = new TailscaleVncChannel(stream);
    deliver(new Uint8Array([82, 70, 66]));
    await vi.waitFor(() => expect(stream.read).toHaveBeenCalledTimes(2));

    const onmessage = vi.fn();
    const onopen = vi.fn();
    channel.onmessage = onmessage;
    channel.onopen = onopen;

    await vi.waitFor(() => expect(onmessage).toHaveBeenCalledOnce());
    expect(onopen).toHaveBeenCalledOnce();
    expect([...new Uint8Array(onmessage.mock.calls[0][0].data)]).toEqual([
      82, 70, 66,
    ]);
    channel.close();
  });

  it("delivers a buffered banner before a remote EOF", async () => {
    let readCount = 0;
    const stream: TcpByteStream = {
      read: vi.fn(async () => {
        readCount += 1;
        return readCount === 1 ? new Uint8Array([82, 70, 66]) : null;
      }),
      write: vi.fn(async (_data: Uint8Array) => {}),
      close: vi.fn(async () => {}),
    };
    const channel = new TailscaleVncChannel(stream);
    const events: string[] = [];
    channel.onmessage = () => events.push("message");
    channel.onopen = () => events.push("open");
    channel.onclose = () => events.push("close");

    await vi.waitFor(() => expect(events).toContain("close"));

    expect(events).toEqual(["open", "message", "close"]);
  });

  it("serializes writes and preserves the submitted bytes", async () => {
    const { stream, write } = createStream();
    const channel = new TailscaleVncChannel(stream);
    channel.onopen = vi.fn();
    await vi.waitFor(() => expect(channel.readyState).toBe("open"));
    const first = new Uint8Array([1, 2]);
    channel.send(first);
    first[0] = 9;
    channel.send(new Uint8Array([3]));

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));

    expect(write.mock.calls.map(([bytes]) => [...bytes])).toEqual([
      [1, 2],
      [3],
    ]);
    channel.close();
  });

  it("closes the underlying stream once", async () => {
    const { stream } = createStream();
    const channel = new TailscaleVncChannel(stream);
    const onclose = vi.fn();
    channel.onclose = onclose;

    channel.close();
    channel.close();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());

    expect(channel.readyState).toBe("closed");
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it("marks a remote EOF as an unclean close", async () => {
    const { stream, deliver } = createStream();
    const channel = new TailscaleVncChannel(stream);
    const onclose = vi.fn();
    channel.onclose = onclose;

    deliver(null);
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());

    expect(onclose.mock.calls[0][0]).toMatchObject({
      code: 1006,
      reason: "Remote TCP peer closed",
      wasClean: false,
    });
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it("notifies listeners when closing the stream fails", async () => {
    const { stream } = createStream();
    vi.mocked(stream.close).mockRejectedValueOnce(new Error("close failed"));
    const channel = new TailscaleVncChannel(stream);
    const onerror = vi.fn();
    const onclose = vi.fn();
    channel.onerror = onerror;
    channel.onclose = onclose;

    channel.close();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());

    expect(onerror).toHaveBeenCalledOnce();
    expect(channel.readyState).toBe("closed");
  });
});