declare global {
  type Ytcfg = {
    INNERTUBE_API_KEY?: string;
    INNERTUBE_CONTEXT?: {
      client?: { clientName?: string; clientVersion?: string };
    };
  };

  interface Window {
    ytInitialData?: unknown;
    ytcfg?: { data_?: Ytcfg };
  }
}

export {};
