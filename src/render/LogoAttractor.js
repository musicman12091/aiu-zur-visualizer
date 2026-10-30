const WIDTH = 512;
const HEIGHT = 128;
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function generatedGlyph(char) {
  let seed = char.charCodeAt(0) || 1;
  return Array.from({ length: 7 }, () => {
    let row = "";
    for (let x = 0; x < 5; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      row += (seed >>> 31) ? "1" : "0";
    }
    return row;
  });
}

function bitmapPoints(text) {
  const chars = Array.from(text.toUpperCase());
  const width = Math.max(1, chars.length * 6 - 1);
  const points = [];
  chars.forEach((char, index) => {
    const glyph = FONT[char] || generatedGlyph(char);
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (glyph[y][x] === "1") points.push([(index * 6 + x) / width, y / 6]);
      }
    }
  });
  return points.length ? points : [[0.5, 0.5]];
}

function canvasPoints(text) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  let fontSize = 92;
  context.font = `700 ${fontSize}px monospace`;
  while (context.measureText(text).width > WIDTH - 24 && fontSize > 12) {
    fontSize -= 4;
    context.font = `700 ${fontSize}px monospace`;
  }
  context.fillText(text || "ZUR", WIDTH / 2, HEIGHT / 2, WIDTH - 24);
  const image = context.getImageData(0, 0, WIDTH, HEIGHT).data;
  const points = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (image[(y * WIDTH + x) * 4 + 3] > 127) points.push([x / WIDTH, y / HEIGHT]);
    }
  }
  return points.length ? points : null;
}

/** Returns deterministic vec4 xyz logo targets, using a canvas in browsers and a 5x7 font in Node. */
export function sampleLogoTargets(text = "AI: UNDERGROUND", count = 65536) {
  const safeText = typeof text === "string" && text.length ? text.slice(0, 64) : "ZUR";
  const points = canvasPoints(safeText) || bitmapPoints(safeText);
  const targetCount = Math.max(0, Math.floor(count));
  const targets = new Float32Array(targetCount * 4);
  for (let i = 0; i < targetCount; i += 1) {
    const [x, y] = points[i % points.length];
    const offset = i * 4;
    targets[offset] = (x - 0.5) * 7.2;
    targets[offset + 1] = (0.5 - y) * 2.4;
    targets[offset + 2] = 0;
    targets[offset + 3] = 1;
  }
  return targets;
}
