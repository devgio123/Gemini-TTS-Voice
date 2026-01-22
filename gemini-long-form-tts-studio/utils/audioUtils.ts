
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function pcmToWav(pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1): Promise<Blob> {
  const dataLen = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  // Write WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true); // 16 bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLen, true);

  // Write PCM samples
  const pcmView = new Uint8Array(buffer, 44);
  pcmView.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function mergeAudioBlobs(blobs: Blob[]): Promise<Blob> {
  // Simple concatenation for now, as they share the same format.
  // Real audio merging should ideally re-encode to ensure no header issues, 
  // but for raw PCM encoded as WAV with same parameters, it usually works if we strip headers.
  // To be safe, we'll just concatenate the data parts.
  
  const headers = [];
  const datas = [];
  
  for (const blob of blobs) {
    const arrayBuffer = await blob.arrayBuffer();
    // Assuming 44 byte header for all
    datas.push(arrayBuffer.slice(44));
    if (headers.length === 0) {
      headers.push(arrayBuffer.slice(0, 44));
    }
  }

  const totalDataSize = datas.reduce((acc, d) => acc + d.byteLength, 0);
  const finalBuffer = new Uint8Array(44 + totalDataSize);
  
  // Header
  const firstHeader = new DataView(headers[0]);
  firstHeader.setUint32(4, 36 + totalDataSize, true);
  firstHeader.setUint32(40, totalDataSize, true);
  finalBuffer.set(new Uint8Array(headers[0]), 0);

  // Data
  let offset = 44;
  for (const data of datas) {
    finalBuffer.set(new Uint8Array(data), offset);
    offset += data.byteLength;
  }

  return new Blob([finalBuffer], { type: 'audio/wav' });
}
