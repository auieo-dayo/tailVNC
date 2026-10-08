export interface TcpByteStream {
  read(): Promise<Uint8Array | ArrayBuffer | null>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface RawVncChannel {
  binaryType: "arraybuffer";
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  protocol: string;
  readonly readyState: "connecting" | "open" | "closing" | "closed";
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
}

function createErrorEvent(error: unknown): Event {
  return Object.assign(new Event("error"), {
    error,
    message: String(error),
  });
}

export class TailscaleVncChannel implements RawVncChannel {
  binaryType: "arraybuffer" = "arraybuffer";
  onerror: RawVncChannel["onerror"] = null;
  onclose: RawVncChannel["onclose"] = null;
  protocol = "";

  #state: RawVncChannel["readyState"] = "connecting";
  #writes = Promise.resolve();
  #reader: Promise<void>;
  #closed = false;
  #onopen: RawVncChannel["onopen"] = null;
  #openScheduled = false;
  #openNotified = false;
  #onmessage: RawVncChannel["onmessage"] = null;
  #pendingMessages: ArrayBuffer[] = [];
  #receivedBytes = 0;
  #initialBytes: number[] = [];

  constructor(private readonly stream: TcpByteStream) {
    this.#reader = this.#readLoop();
  }

  get readyState(): RawVncChannel["readyState"] {
    return this.#state;
  }

  get diagnostics(): { receivedBytes: number; initialBytes: number[] } {
    return {
      receivedBytes: this.#receivedBytes,
      initialBytes: [...this.#initialBytes],
    };
  }

  get onopen(): RawVncChannel["onopen"] {
    return this.#onopen;
  }

  set onopen(handler: RawVncChannel["onopen"]) {
    this.#onopen = handler;
    if (!handler) {
      return;
    }
    if (this.#state === "open") {
      this.#notifyOpen();
      this.#flushMessages();
      return;
    }
    if (this.#state !== "connecting" || this.#openScheduled) {
      return;
    }

    this.#openScheduled = true;
    queueMicrotask(() => this.#activate());
  }

  get onmessage(): RawVncChannel["onmessage"] {
    return this.#onmessage;
  }

  set onmessage(handler: RawVncChannel["onmessage"]) {
    this.#onmessage = handler;
    if (handler && this.#state === "open") {
      this.#flushMessages();
    }
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.#state !== "open") {
      throw new Error("VNC channel is not open");
    }

    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      : new Uint8Array(data).slice();
    this.#writes = this.#writes.then(() => this.stream.write(bytes));
    void this.#writes.catch((error: unknown) => this.#fail(error));
  }

  close(): void {
    if (this.#state === "closed" || this.#state === "closing") {
      return;
    }

    this.#state = "closing";
    void this.#finishClose();
  }

  async #readLoop(): Promise<void> {
    try {
      while (!this.#closed) {
        const received = await this.stream.read();
        if (received === null) {
          this.#activate();
          await this.#finishClose(1006, "Remote TCP peer closed");
          return;
        }
        const data = received instanceof Uint8Array ? received : new Uint8Array(received);
        this.#receivedBytes += data.byteLength;
        if (this.#initialBytes.length < 12) {
          this.#initialBytes.push(...data.subarray(0, 12 - this.#initialBytes.length));
        }
        const message = data.slice().buffer;
        if (this.#onmessage && this.#state === "open") {
          this.#onmessage({ data: message } as MessageEvent<ArrayBuffer>);
        } else {
          this.#pendingMessages.push(message);
        }
      }
    } catch (error) {
      if (!this.#closed) {
        this.#fail(error);
      }
    }
  }

  #flushMessages(): void {
    if (!this.#onmessage || this.#state !== "open" || !this.#openNotified) {
      return;
    }
    for (const data of this.#pendingMessages.splice(0)) {
      this.#onmessage({ data } as MessageEvent<ArrayBuffer>);
    }
  }

  #activate(): void {
    if (this.#state === "connecting") {
      this.#state = "open";
    }
    this.#notifyOpen();
    this.#flushMessages();
  }

  #notifyOpen(): void {
    if (this.#state !== "open" || this.#openNotified || !this.#onopen) {
      return;
    }
    this.#openNotified = true;
    this.#onopen(new Event("open"));
  }

  async #finishClose(code = 1000, reason = ""): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#state = "closing";
    this.#pendingMessages.length = 0;
    try {
      await this.stream.close();
    } catch (error) {
      this.onerror?.(createErrorEvent(error));
    } finally {
      this.#state = "closed";
      this.onclose?.({ code, reason, wasClean: code === 1000 } as CloseEvent);
    }
  }

  #fail(error: unknown): void {
    if (this.#closed) {
      return;
    }
    this.onerror?.(createErrorEvent(error));
    void this.#finishClose(1011, String(error));
  }
}