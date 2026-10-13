import {asrModel} from './asr-config.js';
let loadedModel=null;
export const modelReadyFor=model=>modelReady&&loadedModel===asrModel(model);
let worker,
  seq = 0,
  pending = new Map();
export let modelReady = false;
export function cancelTranscriber() {
  worker?.terminate();
  worker = null;
  modelReady = false;
  loadedModel = null;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("Penilaian dibatalkan."));
  }
  pending.clear();
}
export function requestTranscription(
  type,
  audio,
  onProgress = () => {},
  language = "indonesian",
  model = 'tiny',
) {
  if (!worker) {
    worker = new Worker(new URL("./transcriber-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        for (const p of pending.values()) p.onProgress(data.progress);
        return;
      }
      const p = pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(data.id);
      if (data.type === "error") {
        modelReady = false;
        loadedModel = null;
        p.reject(new Error(data.error));
      }
      else {
        modelReady = true;
        loadedModel=data.model||'tiny';
        p.resolve(data.text || "");
      }
    };
    worker.onerror = () => {
      cancelTranscriber();
    };
  }
  return new Promise((resolve, reject) => {
    if(loadedModel!==asrModel(model))modelReady=false;
    const id = ++seq;
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(
          new Error(
            "Pengenalan kata terlalu lama. Coba lagi atau lewati giliran.",
          ),
        );
        cancelTranscriber();
      },
      type === "load" ? 300000 : 120000,
    );
    pending.set(id, { resolve, reject, timer, onProgress });
    worker.postMessage({ id, type, audio, language, model:asrModel(model) });
  });
}
