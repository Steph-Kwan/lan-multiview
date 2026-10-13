#!/usr/bin/env node
/**
 * 轉播伺服器 (macOS 版)
 *  1. 用 http://<本機IP>:8080 提供 multiview.html 給內網任何人開
 *  2. 收下瀏覽器合成好的畫面 (WebSocket)
 *  3. 交給 ffmpeg 轉成 H.264，推回 MediaMTX 的 program 路徑
 *
 * macOS 差異：
 *  - 優先使用 h264_videotoolbox 硬體編碼，CPU 用量大約是 libx264 的 1/5
 *  - 容器格式由瀏覽器決定 (Chrome 給 WebM、Safari 給 MP4)，開場先協商
 *
 * 執行：node relay-server.js
 */
const http = require("http");
const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { WebSocketServer } = require("ws");

const CFG = {
  port:    Number(process.env.PORT || 8080),
  rtspOut: process.env.RTSP_OUT || "rtsp://127.0.0.1:8554/program",
  ffmpeg:  process.env.FFMPEG || "ffmpeg",
  bitrate: process.env.BITRATE || "6M",
  encoder: process.env.ENCODER || "auto",   // auto | videotoolbox | x264
};

/* ---------- 開機時決定用哪個編碼器 ---------- */
function pickEncoder() {
  if (CFG.encoder === "x264") return "libx264";
  try {
    const list = execSync(`${CFG.ffmpeg} -hide_banner -encoders`, {encoding:"utf8", stdio:["ignore","pipe","ignore"]});
    if (list.includes("h264_videotoolbox")) return "h264_videotoolbox";
  } catch { /* ffmpeg 沒裝，稍後會報錯 */ }
  return "libx264";
}
const ENC = pickEncoder();

function videoArgs() {
  if (ENC === "h264_videotoolbox") {
    return ["-c:v","h264_videotoolbox","-realtime","1","-allow_sw","1",
            "-profile:v","high","-b:v",CFG.bitrate,"-g","60"];
  }
  return ["-c:v","libx264","-preset","veryfast","-tune","zerolatency",
          "-profile:v","high","-b:v",CFG.bitrate,"-maxrate",CFG.bitrate,
          "-bufsize","12M","-g","60","-keyint_min","60","-sc_threshold","0"];
}

/* ---------- 靜態網頁 ---------- */
const MIME = {".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css"};
const server = http.createServer((req, res) => {
  const f = req.url === "/" ? "/multiview.html" : req.url.split("?")[0];
  const p = path.join(__dirname, path.normalize(f).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, {"Content-Type": MIME[path.extname(p)] || "application/octet-stream"});
    res.end(buf);
  });
});

/* ---------- 推流 ---------- */
const wss = new WebSocketServer({ server, path: "/publish" });
let busy = null;

wss.on("connection", (ws, req) => {
  const who = req.socket.remoteAddress.replace("::ffff:", "");
  if (busy) { ws.send("已有另一台主機正在廣播，請先停止該來源"); return ws.close(); }
  busy = ws;

  let ff = null;

  function startFfmpeg(mime) {
    // Chrome → video/webm，Safari → video/mp4，各自要不同的解封裝器
    const fmt = mime.includes("mp4") ? "mov,mp4,m4a,3gp,3g2,mj2" : "webm";
    console.log(`[relay] ${who} 開始推流  容器=${mime}  編碼器=${ENC}`);
    ws.send(`已連線，使用 ${ENC === "h264_videotoolbox" ? "VideoToolbox 硬體編碼" : "libx264 軟體編碼"}`);

    ff = spawn(CFG.ffmpeg, [
      "-hide_banner", "-loglevel", "warning",
      "-fflags", "+genpts",
      "-f", fmt, "-i", "pipe:0",
      "-map", "0:v:0", "-map", "0:a:0?",
      ...videoArgs(),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-f", "rtsp", "-rtsp_transport", "tcp", CFG.rtspOut,
    ]);

    ff.stderr.on("data", d => {
      const s = d.toString().trim(); if (!s) return;
      console.error("[ffmpeg]", s);
      if (ws.readyState === 1) ws.send(s.split("\n").pop().slice(0, 200));
    });
    ff.on("error", e => {
      console.error("[relay] 無法執行 ffmpeg：", e.message);
      if (ws.readyState === 1) ws.send("找不到 ffmpeg，請先執行 brew install ffmpeg");
      ws.close();
    });
    ff.on("close", code => {
      console.log("[relay] ffmpeg 結束，代碼", code);
      if (ws.readyState === 1) ws.close();
    });
  }

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {                                  // 開場協商訊息
      try { startFfmpeg(JSON.parse(data.toString()).mime || "video/webm"); }
      catch { startFfmpeg("video/webm"); }
      return;
    }
    if (ff && ff.stdin.writable) ff.stdin.write(data);
  });

  ws.on("close", () => {
    console.log(`[relay] ${who} 停止推流`);
    if (ff) {
      try { ff.stdin.end(); } catch {}
      setTimeout(() => { try { ff.kill("SIGKILL"); } catch {} }, 1500);
    }
    if (busy === ws) busy = null;
  });
});

server.listen(CFG.port, () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(n => n.family === "IPv4" && !n.internal).map(n => n.address);
  console.log(`編碼器：${ENC}`);
  console.log("控制台網址：");
  ips.forEach(ip => console.log(`  http://${ip}:${CFG.port}`));
  console.log(`合成輸出推送到：${CFG.rtspOut}`);
});
