declare module "@novnc/novnc" {
  type Credentials = {
    password?: string;
    username?: string;
  };

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      channel: WebSocket | RTCDataChannel,
      options?: { credentials?: Credentials; shared?: boolean },
    );

    scaleViewport: boolean;
    clipViewport: boolean;
    focusOnClick: boolean;
    qualityLevel: number;
    disconnect(): void;
    sendCredentials(credentials: Credentials): void;
  }
}