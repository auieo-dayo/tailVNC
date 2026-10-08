import type { TcpByteStream } from "./tailscale-vnc-channel";

export type TailnetState =
  | "NoState"
  | "InUseOtherUser"
  | "NeedsLogin"
  | "NeedsMachineAuth"
  | "Stopped"
  | "Starting"
  | "Running";

export type TailnetPeer = {
  name: string;
  addresses: string[];
  online?: boolean;
};

type IPNClient = {
  run(callbacks: {
    notifyState(state: TailnetState): void;
    notifyNetMap(netMap: string): void;
    notifyBrowseToURL(url: string): void;
    notifyPanicRecover(error: string): void;
  }): void;
  login(): void;
  logout(): void;
  openTCP(host: string, port: number): Promise<TcpByteStream>;
};

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

declare global {
  interface Window {
    Go: new () => GoRuntime;
    newIPN(config: {
      stateStorage: {
        getState(key: string): string;
        setState(key: string, value: string): void;
      };
      hostname: string;
    }): IPNClient;
  }
}

let runtimePromise: Promise<IPNClient> | undefined;

export function createTailnetClient(): Promise<IPNClient> {
  runtimePromise ??= startWasm();
  return runtimePromise;
}

async function startWasm(): Promise<IPNClient> {
  const go = new window.Go();
  const response = await fetch("/tailscale.wasm", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Tailscale WASM load failed (${response.status})`);
  }

  const { instance } = await WebAssembly.instantiateStreaming(
    response,
    go.importObject,
  );
  void go.run(instance).catch((error: unknown) => {
    console.error("Tailscale WASM stopped", error);
  });

  return window.newIPN({
    hostname: "tailvnc-web",
    stateStorage: {
      getState: (key) => sessionStorage.getItem(`tailvnc:${key}`) ?? "",
      setState: (key, value) => sessionStorage.setItem(`tailvnc:${key}`, value),
    },
  });
}