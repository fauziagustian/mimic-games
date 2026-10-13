import {ASR_MODELS,asrModel} from './asr-config.js';
let pipelinePromise,loadedModel;
let step = "mulai";
let queue = Promise.resolve();
self.onmessage = (event) => {
  queue = queue.then(() => handleRequest(event));
};
async function handleRequest({ data }) {
  const { id, type, audio, language = "indonesian" } = data, modelKey=asrModel(data.model);
  try {
    if(!['load','transcribe'].includes(type))throw new Error('Permintaan ASR tidak valid.');
    if(type==='transcribe'&&(!(audio instanceof Float32Array)||audio.length<4000||audio.length>240000||audio.some(x=>!Number.isFinite(x))))throw new Error('Audio ASR harus mono 16 kHz, 0,25–15 detik.');
    if(pipelinePromise&&loadedModel!==modelKey){await (await pipelinePromise).dispose();pipelinePromise=null;}
    loadedModel=modelKey;
    if (!pipelinePromise)
      pipelinePromise = (async () => {
        step = "memuat pustaka suara";
        const { pipeline, env } = await import(
          "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"
        );
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = 1;
        return pipeline(
          "automatic-speech-recognition",
          ASR_MODELS[modelKey],
          {
            dtype: "q8",
            device: "wasm",
            progress_callback: (p) => {
              if (p.file) step = "mengunduh " + p.file;
              self.postMessage({ type: "progress", progress: p });
            },
          },
        );
      })().catch((e) => {
        pipelinePromise = null;
        throw e;
      });
    const model = await pipelinePromise;
    if (type === "load") {
      self.postMessage({ id, type: "ready", model:modelKey });
      return;
    }
    step = "membaca ucapan";
    const result = await model(audio, {
      language,
      task: "transcribe",
      return_timestamps: false,
      max_new_tokens: 96,
      temperature: 0,
    });
    self.postMessage({ id, type: "result", text: result.text.trim(), model:modelKey });
  } catch (e) {
    console.error("MIMIC juri:", step, e.message);
    self.postMessage({
      id,
      type: "error",
      error: `Gagal ${step}: ${e.message || "koneksi terputus"}`,
    });
  }
}
