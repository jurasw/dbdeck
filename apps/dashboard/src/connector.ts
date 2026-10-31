export type HostEvent = { type: string; sequence: number; [key: string]: any };
export class Connector {
  private session = "";
  private sequence = 0;
  private generation = 0;
  constructor(
    readonly url: string,
    private token: string,
    private event: (event: HostEvent) => void,
    private failure: (error: Error) => void,
  ) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      parsed.pathname !== "/" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("The connector must run on your local computer.");
  }
  private async request(path: string, body?: unknown) {
    const response = await fetch(`${this.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-DBDeck-Session": this.session,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(body === undefined ? 15000 : 125000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || "The local connector is unavailable.");
    return value;
  }
  health() {
    return this.request("/health");
  }
  async start(snapshot: unknown) {
    const generation = ++this.generation;
    const result = await this.request("/session", { snapshot });
    if (generation !== this.generation) return;
    this.session = result.sessionId;
    this.sequence = 0;
    void this.poll(generation);
    return result;
  }
  async reset() {
    this.generation++;
    this.session = "";
    await this.request("/reset", {});
  }
  closeOnExit() {
    this.generation++;
    void fetch(`${this.url}/reset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      keepalive: true,
    }).catch(() => {});
  }
  async rpc(method: string, params: unknown = {}) {
    return (await this.request("/rpc", { method, params })).result;
  }
  private async poll(generation: number) {
    while (generation === this.generation) {
      try {
        const { events } = await this.request(`/events?after=${this.sequence}`);
        if (generation !== this.generation) return;
        for (const event of events) {
          this.sequence = event.sequence;
          this.event(event);
        }
      } catch (error) {
        if (generation === this.generation) {
          this.generation++;
          this.failure(error as Error);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
}
export function pairing() {
  const params = new URLSearchParams(location.hash.slice(1));
  const url = params.get("connector");
  const token = params.get("token");
  if (url && token) {
    history.replaceState(null, "", location.pathname);
    // Pairing is local browser session data, separate from optional project
    // encryption. It cannot retrieve project credentials from a locked worker.
    sessionStorage.setItem(
      "dbdeck.local-connector",
      JSON.stringify({ url, token }),
    );
    return { url, token };
  }
  try {
    return JSON.parse(
      sessionStorage.getItem("dbdeck.local-connector") || "null",
    ) as { url: string; token: string } | null;
  } catch {
    return null;
  }
}
