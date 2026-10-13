export const ASR_MODELS={tiny:'onnx-community/whisper-tiny',base:'onnx-community/whisper-base'};
export const asrModel=value=>Object.hasOwn(ASR_MODELS,value)?value:'tiny';
