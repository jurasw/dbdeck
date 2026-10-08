export class EventEmitter {
  listeners = new Set();
  event = (fn) => {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  };
  fire(value) {
    this.listeners.forEach((fn) => fn(value));
  }
}
export const workspace = { getConfiguration: () => ({ get: () => undefined }) };
export const window = { showErrorMessage() {} };
