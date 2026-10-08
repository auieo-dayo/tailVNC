import { h, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ChevronDown,
  Computer,
  ExternalLink,
  Expand,
  LoaderCircle,
  LogOut,
  Monitor,
  Minimize2,
  Network,
  Power,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-preact";
import RFB from "@novnc/novnc";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import { createTailnetClient, type TailnetPeer, type TailnetState } from "./lib/tailscale";
import { TailscaleVncChannel } from "./lib/tailscale-vnc-channel";

function App() {
  const [tailnetState, setTailnetState] = useState<TailnetState>("Starting");
  const [peers, setPeers] = useState<TailnetPeer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState("");
  const [port, setPort] = useState(5900);
  const [password, setPassword] = useState("");
  const [connectionState, setConnectionState] = useState("idle");
  const [error, setError] = useState("");
  const [loginURL, setLoginURL] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qualityLevel, setQualityLevel] = useState(() => {
    const stored = Number(sessionStorage.getItem("tailvnc:quality"));
    return [3, 6, 9].includes(stored) ? stored : 6;
  });
  const clientRef = useRef<Awaited<ReturnType<typeof createTailnetClient>> | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerStageRef = useRef<HTMLElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const connected = connectionState === "connected";
  const waitingForCredentials = connectionState === "waiting-credentials";
  const onlinePeers = peers.filter((peer) => peer.online !== false);
  const selected = peers.find((peer) => peer.name === selectedPeer);

  useEffect(() => {
    let active = true;

    void createTailnetClient()
      .then((client) => {
        if (!active) return;
        clientRef.current = client;
        client.run({
          notifyState: (state) => {
            if (!active) return;
            setTailnetState(state);
            if (state === "NeedsLogin") client.login();
            if (state === "Running") setLoginURL("");
          },
          notifyNetMap: (value) => {
            if (!active) return;
            const netMap = JSON.parse(value) as { peers?: TailnetPeer[] };
            const nextPeers = netMap.peers ?? [];
            setPeers(nextPeers);
            setSelectedPeer((current) =>
              nextPeers.some((peer) => peer.name === current)
                ? current
                : nextPeers.find((peer) => peer.online !== false)?.name ?? "",
            );
          },
          notifyBrowseToURL: (url) => setLoginURL(url),
          notifyPanicRecover: (message) => setError(message),
        });
      })
      .catch((reason: unknown) => {
        if (active) {
          setTailnetState("Stopped");
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      active = false;
      rfbRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === viewerStageRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function connect() {
    if (waitingForCredentials) {
      if (!password) {
        setError("VNCパスワードを入力してください");
        return;
      }
      rfbRef.current?.sendCredentials({ password });
      setError("");
      setConnectionState("connecting");
      return;
    }

    const client = clientRef.current;
    const target = selected;
    const viewer = viewerRef.current;
    if (!client || !target || !viewer || tailnetState !== "Running") return;

    setError("");
    setConnectionState("connecting");
    try {
      const stream = await client.openTCP(target.name, port);
      const channel = new TailscaleVncChannel(stream);
      const rfb = new RFB(viewer, channel as unknown as RTCDataChannel, {
        credentials: password ? { password } : {},
        shared: true,
      });
      rfb.scaleViewport = true;
      rfb.clipViewport = true;
      rfb.focusOnClick = true;
      rfb.qualityLevel = qualityLevel;
      let handshakeComplete = false;
      rfb.addEventListener("connect", () => {
        handshakeComplete = true;
        setConnectionState("connected");
      }, { once: true });
      rfb.addEventListener("disconnect", (event) => {
        const clean = (event as CustomEvent<{ clean: boolean }>).detail?.clean;
        if (!clean && !handshakeComplete) {
          const { receivedBytes, initialBytes } = channel.diagnostics;
          const banner = initialBytes.length
            ? `先頭データ: ${JSON.stringify(String.fromCharCode(...initialBytes))}`
            : "VNCデータなし";
          console.warn("VNC handshake ended before completion", {
            target: target.name,
            port,
            receivedBytes,
            initialBytes,
          });
          setError(`VNCハンドシェイク前に切断 (${receivedBytes} bytes受信、${banner})。${target.name.split(".")[0]}:${port}への接続を確認してください。`);
        }
        setConnectionState("idle");
        rfbRef.current = null;
      });
      rfb.addEventListener("credentialsrequired", () => {
        setConnectionState("waiting-credentials");
        setError("VNCパスワードを入力して認証してください");
      });
      rfb.addEventListener("securityfailure", () => {
        setError("VNC認証に失敗しました");
      });
      rfbRef.current = rfb;
    } catch (reason) {
      setConnectionState("idle");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function disconnect() {
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    setConnectionState("idle");
  }

  function logout() {
    disconnect();
    clientRef.current?.logout();
  }

  async function toggleFullscreen() {
    const stage = viewerStageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "全画面表示を開始できませんでした");
    }
  }

  function changeQuality(value: string) {
    const nextQuality = Number(value);
    setQualityLevel(nextQuality);
    sessionStorage.setItem("tailvnc:quality", String(nextQuality));
    if (rfbRef.current) {
      rfbRef.current.qualityLevel = nextQuality;
    }
  }

  const stateLabel: Record<TailnetState, string> = {
    NoState: "停止中",
    InUseOtherUser: "別の利用者が使用中",
    NeedsLogin: "ログイン待ち",
    NeedsMachineAuth: "承認待ち",
    Stopped: "停止",
    Starting: "接続中",
    Running: "Tailnet接続済み",
  };

  return (
    <main class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="TailVNC home">
          <span class="brand-mark"><Network size={19} strokeWidth={2.2} /></span>
          <span>tail<span>VNC</span></span>
        </a>
        <div class="topbar-right">
          <span class={`net-state ${tailnetState === "Running" ? "is-online" : ""}`}>
            <span class="state-dot" />
            {stateLabel[tailnetState]}
          </span>
          {tailnetState === "Running" && (
            <button class="icon-button" title="Tailscaleからログアウト" onClick={logout}>
              <LogOut size={17} />
            </button>
          )}
        </div>
      </header>

      <div class="workspace">
        <aside class="sidebar">
          <div class="sidebar-heading">
            <div>
              <p class="eyebrow">TAILNET</p>
              <h1>デバイス</h1>
            </div>
            <button class="icon-button" title="デバイス一覧を更新" onClick={() => window.location.reload()}>
              <RefreshCw size={17} />
            </button>
          </div>
          <div class="device-count"><span>{onlinePeers.length}</span> オンライン</div>
          <div class="device-list" role="listbox" aria-label="Tailscaleデバイス">
            {onlinePeers.map((peer) => (
              <button
                class={`device-row ${selectedPeer === peer.name ? "is-selected" : ""}`}
                key={peer.name}
                role="option"
                aria-selected={selectedPeer === peer.name}
                onClick={() => setSelectedPeer(peer.name)}
              >
                <span class="device-icon"><Computer size={17} /></span>
                <span class="device-copy">
                  <span class="device-name">{peer.name.split(".")[0]}</span>
                  <span class="device-address">{peer.addresses[0] ?? "IP未取得"}</span>
                </span>
                <span class="device-live" />
              </button>
            ))}
            {onlinePeers.length === 0 && (
              <div class="list-empty">
                {tailnetState === "Running" ? "オンライン端末なし" : "端末一覧を取得中"}
              </div>
            )}
          </div>
          <div class="sidebar-foot">
            <ShieldCheck size={16} />
            <span>通信はTailscaleで保護されています</span>
          </div>
        </aside>

        <section class="main-panel">
          {(loginURL || tailnetState === "NeedsLogin") && (
            <div class="auth-notice" role="status">
              <div class="auth-copy">
                <p class="eyebrow">TAILSCALE AUTH</p>
                <strong>{tailnetState === "NeedsMachineAuth" ? "デバイスの承認が必要です" : "Tailnetにログイン"}</strong>
                <span>認証画面を別タブで開いてください。完了後、この画面へ戻ります。</span>
              </div>
              {loginURL ? (
                <a class="auth-link" href={loginURL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} /> ログイン画面を開く
                </a>
              ) : (
                <button class="auth-link" onClick={() => clientRef.current?.login()}>
                  <ExternalLink size={15} /> ログインURLを取得
                </button>
              )}
            </div>
          )}
          <div class="connection-bar">
            <div class="target-select-wrap">
              <label class="field-label" for="target">接続先</label>
              <div class="select-frame">
                <Monitor size={17} />
                <select
                  id="target"
                  value={selectedPeer}
                  onChange={(event) => setSelectedPeer(event.currentTarget.value)}
                  disabled={connected || onlinePeers.length === 0}
                >
                  {onlinePeers.length === 0 && <option value="">端末を選択</option>}
                  {onlinePeers.map((peer) => (
                    <option value={peer.name} key={peer.name}>{peer.name.split(".")[0]}</option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </div>
            </div>
            <label class="port-field">
              <span class="field-label">VNCポート</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={port}
                disabled={connected}
                onInput={(event) => setPort(Number(event.currentTarget.value))}
              />
            </label>
            <label class="password-field">
              <span class="field-label">VNCパスワード</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                disabled={connected}
                placeholder="任意"
                onInput={(event) => {
                  setPassword(event.currentTarget.value);
                  setError("");
                }}
              />
            </label>
            {connected ? (
              <button class="connect-button disconnect-button" onClick={disconnect}>
                <Unplug size={16} /> 切断
              </button>
            ) : (
              <button
                class="connect-button"
                disabled={tailnetState !== "Running" || !selectedPeer || connectionState === "connecting"}
                onClick={() => void connect()}
              >
                {connectionState === "connecting" ? <LoaderCircle class="spin" size={16} /> : waitingForCredentials ? <ShieldCheck size={16} /> : <Power size={16} />}
                {connectionState === "connecting" ? "接続中" : waitingForCredentials ? "認証" : "接続"}
              </button>
            )}
          </div>

          <section class="viewer-stage" ref={viewerStageRef} aria-label="VNC画面">
            <div class="viewer-heading">
              <div class="viewer-title">
                <span class="viewer-live-dot" />
                <strong>{connected ? selected?.name.split(".")[0] : "VNCセッション"}</strong>
                <span class="viewer-separator">/</span>
                <span class="viewer-subtitle">{connected ? `${selected?.addresses[0]}:${port}` : "リモートデスクトップ"}</span>
              </div>
              <div class="viewer-actions">
                <label class="quality-control">
                  <span>画質</span>
                  <select
                    aria-label="VNC画質"
                    value={qualityLevel}
                    onChange={(event) => changeQuality(event.currentTarget.value)}
                  >
                    <option value={3}>低</option>
                    <option value={6}>標準</option>
                    <option value={9}>高</option>
                  </select>
                </label>
                <button
                  class="fullscreen-button"
                  title={isFullscreen ? "全画面を終了 (Esc)" : "全画面表示"}
                  aria-label={isFullscreen ? "全画面を終了" : "全画面表示"}
                  aria-pressed={isFullscreen}
                  onClick={() => void toggleFullscreen()}
                >
                  {isFullscreen ? <Minimize2 size={15} /> : <Expand size={15} />}
                  <span>{isFullscreen ? "終了" : "全画面"}</span>
                </button>
              </div>
            </div>
            <div class={`viewer-frame ${connected ? "has-session" : ""}`}>
              <div class="viewer" ref={viewerRef}>
                {!connected && (
                  <div class="viewer-empty">
                    <div class="empty-glyph"><Monitor size={27} strokeWidth={1.6} /></div>
                    <p>{error || (connectionState === "connecting" ? "VNCサーバーへ接続しています" : "接続先を選択")}</p>
                    {tailnetState !== "Running" && (
                      <span class="empty-status">{stateLabel[tailnetState]}</span>
                    )}
                  </div>
                )}
              </div>
              {connected && <span class="session-chip"><span /> LIVE</span>}
            </div>
            <footer class="session-footer">
              <span><span class={`footer-dot ${connected ? "is-online" : ""}`} />{connected ? "セッション接続済み" : "セッション未接続"}</span>
              <div class="footer-right">
                <span class="network-label"><LockKeyholeIcon /> Tailscale peer-to-peer</span>
                <nav class="legal-links" aria-label="法的情報">
                  <a href="/privacy.html" target="_blank" rel="noopener noreferrer">プライバシー</a>
                  <a href="/terms.html" target="_blank" rel="noopener noreferrer">利用規約</a>
                </nav>
              </div>
            </footer>
          </section>
        </section>
      </div>
    </main>
  );
}

function LockKeyholeIcon() {
  return <ShieldCheck size={13} />;
}

render(<App />, document.getElementById("app")!);