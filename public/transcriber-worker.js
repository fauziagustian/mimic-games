let pipelinePromise;
let step = "mulai";
let queue = Promise.resolve();
self.onmessage = (event) => {
  queue = queue.then(() => handleRequest(event));
};
async function handleRequest({ data }) {
  const { id, type, audio, language = "indonesian" } = data;
  try {
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
          "onnx-community/whisper-tiny",
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
      self.postMessage({ id, type: "ready" });
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
    self.postMessage({ id, type: "result", text: result.text.trim() });
  } catch (e) {
    console.error("MIMIC juri:", step, e.message);
    self.postMessage({
      id,
      type: "error",
      error: `Gagal ${step}: ${e.message || "koneksi terputus"}`,
    });
  }
}
