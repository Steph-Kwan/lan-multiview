# 內網 RTSP 多路合成廣播（macOS）

把多支網路攝影機的 RTSP 訊號拉進來,在瀏覽器裡排成四分割 / 二分割等版面,合成後再推回內網給所有人看。

## 為什麼不只是一個 HTML 檔

瀏覽器**完全不支援 RTSP**,Chrome、Safari 都一樣,而且不會改變。所以中間一定要有轉封裝這一層:

```
IP 攝影機          MediaMTX              multiview.html         relay-server        MediaMTX
RTSP  ──────►  轉成 WebRTC  ──────►  拉多路 + Canvas 合成  ──►  ffmpeg 轉 H.264  ──►  program
                                            ▲                                          │
                                      你在這裡切版面                                    ▼
                                                                          內網任何人用 VLC / 網頁觀看
```

三個元件全部跑在你這台 Mac 上,不需要對外網路。

## 安裝

```bash
brew install mediamtx ffmpeg node
```

三個都在 Homebrew core 裡,Apple Silicon 和 Intel 都有現成的 bottle,不用自己編譯。

先複製一份設定檔:

```bash
cp mediamtx.example.yml mediamtx.yml
```

編輯 `mediamtx.yml`,把 `cam1`~`cam4` 的 `source` 換成攝影機真正的 RTSP 網址:

- 海康 / Hikvision：`rtsp://admin:密碼@IP:554/Streaming/Channels/101`
- 大華 / Dahua：`rtsp://admin:密碼@IP:554/cam/realmonitor?channel=1&subtype=0`
- TP-Link Tapo：`rtsp://帳號:密碼@IP:554/stream1`

要幾路就加幾段,路徑名稱自己取。然後:

```bash
./start-mac.sh
```

這支腳本會一起啟動 MediaMTX 和轉播伺服器,並用 `caffeinate` 擋住睡眠(不然 Mac 一休眠廣播就斷)。終端機印出的 `http://192.168.x.x:8080` 就是控制台網址。

第一次啟動時 macOS 會跳出防火牆詢問,**兩個都要按「允許」**,否則內網其他機器連不進來。

想分開跑的話:

```bash
mediamtx ./mediamtx.yml     # 終端機視窗 1
node relay-server.js        # 終端機視窗 2
```

## 用 Chrome 開控制台,不要用 Safari

這點很重要。Safari 的 `MediaRecorder` 只吐 MP4,而 fragmented MP4 走管線進 ffmpeg 常常卡住;Chrome 的 WebM 穩定得多。程式兩種都支援也會自動協商,但 Safari 那條路只當備援。

Chrome 對多路 WebRTC 的硬體解碼支援也比較好,九分割以上差距明顯。

## 操作

| 動作 | 位置 |
|---|---|
| 抓所有攝影機 | 左上「掃描串流」,自動列出 MediaMTX 裡的所有路徑 |
| 手動加一路 | 左側填路徑名稱(如 `cam1`)按「加入」 |
| 換版面 | 左側 12 個版面按鈕,單畫面到十六分割 |
| 指派畫面 | **直接點畫布上的格子**,選要放哪支攝影機 |
| 選聲音 | 上方下拉,一次挑一路的音訊帶進輸出 |
| 開始廣播 | 右上按鈕,邊框亮紅燈代表 ON AIR |

版面切換時每個版面各自記住自己的指派,四分割切到九分割再切回來不會跑掉。

## 觀看合成後的畫面

廣播開始後,內網其他人可以用:

- **VLC / 監控軟體**:`rtsp://<你的Mac IP>:8554/program`
- **瀏覽器,低延遲**:`http://<你的Mac IP>:8889/program`
- **Safari / iPhone / iPad**:`http://<你的Mac IP>:8888/program`
- **Apple TV、電視棒**:`http://<你的Mac IP>:8888/program/index.m3u8`

HLS(8888)這條在 Apple 生態系裡是原生支援的,iPhone 直接用 Safari 開就能看。

## 效能

`relay-server.js` 開機時會自動偵測並優先使用 **VideoToolbox 硬體編碼**,CPU 用量大約是純軟體編碼的五分之一。啟動時終端機會印出 `編碼器：h264_videotoolbox` 確認。

大致的機器需求(1080p30 輸出):

| 機器 | 四分割 | 九分割 |
|---|---|---|
| M1 / M2 MacBook Air | 輕鬆 | 可以 |
| M1 Pro 以上 | 輕鬆 | 輕鬆,十六分割也行 |
| Intel MacBook | 可以 | 會燙,建議改用子碼流 |

CPU 吃緊時的調整順序:攝影機改用子碼流(海康 `/102`、大華 `subtype=1`)→ 控制台輸出改 1280×720 → 降位元率 `BITRATE=3M node relay-server.js`。

延遲方面,端到端大約 1 秒(觀眾走 WebRTC 或 RTSP),走 HLS 會變 2~6 秒。

## 常見問題

**畫面一直顯示「無訊號」**
先直接開 `http://localhost:8889/cam1` 看單路能不能播。不能播就是 MediaMTX 那層還沒通,看 MediaMTX 終端機的錯誤訊息,多半是 RTSP 帳密或路徑寫錯。

**自己的 Mac 看得到,其他機器連不上**
macOS 防火牆。系統設定 → 網路 → 防火牆 → 選項,確認 `node` 和 `mediamtx` 都允許連入。

**Mac 同時開 Wi-Fi 和有線網路時畫面連不上**
WebRTC 的候選位址會挑錯網卡。在 `mediamtx.yml` 取消註解 `webrtcAdditionalHosts`,填控制台實際用的那個 IP。

**按了廣播沒反應**
按「紀錄」展開日誌看 ffmpeg 的訊息。

**合成到一半自己斷掉**
Mac 睡著了。用 `start-mac.sh` 啟動就有 `caffeinate` 擋著;手動啟動的話在前面加 `caffeinate -dims`。

**想開機自動啟動**
`brew services start mediamtx` 可以讓 MediaMTX 常駐(設定檔路徑用 `brew info mediamtx` 查)。轉播伺服器就寫一個 LaunchAgent plist 丟到 `~/Library/LaunchAgents/`。

## 想再加東西

`multiview.html` 是單一檔案,沒有任何相依套件。幾個容易接上去的方向:

- 自動輪播:定時改 `S.layout` 和 `slotArr()` 的內容
- 快捷鍵:綁 `keydown`,數字鍵切版面
- 移動偵測跳大畫面:MediaMTX 收到攝影機事件時切成 `full` 版面
- 同時錄影:`relay-server.js` 的 ffmpeg 加一組 `-f segment` 輸出,推流和存檔一起做
