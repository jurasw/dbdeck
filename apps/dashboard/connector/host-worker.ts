import { parentPort } from "node:worker_threads";
import { activate } from "../../extension/src/extension";
import { context, dispatch } from "./vscode-adapter";

activate(context as never);
void dispatch("restore", {});
parentPort!.on("message", async ({ id, method, params }) => {
  try {
    parentPort!.postMessage({
      type: "response",
      id,
      result: await dispatch(method, params ?? {}),
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "response",
      id,
      error: (error as Error).message,
    });
  }
});
parentPort!.postMessage({ type: "ready" });
