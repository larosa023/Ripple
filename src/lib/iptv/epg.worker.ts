// Unpacks and parses an XMLTV guide off the main thread so the app never stutters.
import { decodeGuideBytes, parseXmltv } from './xmltv';

self.onmessage = async (e: MessageEvent<{ id: number; buf: ArrayBuffer; from: number; to: number }>) => {
  const { id, buf, from, to } = e.data;
  try {
    const text = await decodeGuideBytes(buf);
    if (!/<tv[\s>]/i.test(text.slice(0, 4000))) throw new Error("That link isn't an XMLTV guide.");
    const guide = parseXmltv(text, from, to);
    self.postMessage({ id, guide });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
