# REPORT — 自定义房间号 + 占用检查 + 格式校验 + v1.5.0 发布

任务来源：`BRIEF-custom-room-id.md`。范围只涉及 `/workspace/Silencium` 源码与
`peaeae314-hub/silencium-releases` 发布仓库；未占用 8090 端口，未触碰
`unity-douyin` 的 cloudflared 隧道（`ss` 复查 8090 仍由原 python3 进程监听）。

## 1. 结论摘要

| 验收项 | 结果 |
|---|---|
| 创建页可选自定义房间号；留空 = 随机 22 位 base64url | ✅ |
| 非法房间号内联报错、不提交；合法但 < 8 位黄色警告但仍可创建 | ✅ |
| `intent=create` 同名占用 → 「房间号已被占用」、回首页、不进房 | ✅ |
| 创建者自己的重连 / 前台恢复 / 刷新 / 重复 join 不会被判占用 | ✅（`custom-room-id-test` 覆盖 reclaim/幂等） |
| 服务端 + 加入表单都校验 `^[A-Za-z0-9_-]{4,64}$` | ✅ |
| zh-Hans / zh-Hant / en 三语文案齐全 | ✅ |
| 现有测试 + 新测试通过；lint 无新增错误 | ✅（源码 0 problems） |
| web 构建成功；两标签页浏览器冒烟 8 张截图 | ✅ `screens/custom-room-id/` |
| APK v1.5.0 (versionCode 6) 构建 | ✅ `dist-mobile/Silencium-debug.apk` |
| Release v1.5.0（APK + version.json）+ main version.json 并验证 | ✅ |
| 源码推送 `peaeae`（非 origin、非 force） | ✅ 快进 `3ca723b..5713515` |
| 本报告 | ✅ |

> 重要部署前提：**占用检查与格式校验在服务端实现**。relay 运营方必须部署本次
> 的新 `server/` 才有这两项能力；只更新网页/APK 而 relay 不更新时，客户端仍会
> 正常创建/加入（旧行为，见 §6 兼容性）。

## 2. 设计

### 2.1 房间号格式（共享常量）

- 新模块 `client/src/utils/roomId.js`：`ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/`、
  `ROOM_ID_MIN_LENGTH = 4`、`ROOM_ID_MAX_LENGTH = 64`、
  `SHORT_ROOM_ID_WARN_LEN = 8`、`isValidRoomId`、`isShortRoomId`、
  `generateRoomId`（16 字节 CSPRNG → base64url 22 位）。
- 服务端 `server/rooms/roomManager.js` 单独定义同一正则 `ROOM_ID_PATTERN` 与
  `isValidRoomId`（CommonJS 不能 import ESM），两边注释互相指向，保持同步。

### 2.2 一次性创建意图（客户端）

- `CreateRoom` 在创建跳转前调用 `markCreateIntent(roomId)`，在
  `sessionStorage` 写 `silencium.createIntent.<roomId> = '1'`。
- `ChatRoom` 挂载时用 `claimCreateIntent(roomId)` **读取并删除**该标记，只把结果
  用于本页面实例的**第一次** `join-room`：`intent: 'create'`；其余所有
  `join-room`（`handleConnect`、`handleReconnect`、前台 resume、重复 setup）都发
  `intent: 'join'`。
- 因为 sessionStorage 标记「用完即删」，**刷新 `/chat?room=…`、复制到新标签页、
  或 React 重新挂载都只会发 join**，不会被当作 create。
- 首次进入时 setup 与 handleConnect 可能各发一次：客户端只让第一次带 create，
  服务端再把同 socket 的重复 create 视为幂等成功（双层保护）。

### 2.3 服务端占用判定与 reclaim

`server/app.js` 的 `join-room` 顺序不变（密钥字段 → 格式 → 限流 → participantId →
清理旧房间 → `reclaimPendingDisconnect` → `roomManager.joinRoom({ intent })`）。
`roomManager.joinRoom` 的规则：

1. 房间已存在且**本 socket 已是成员** → 幂等成功（覆盖重复 create 和普通重复 join）。
2. 房间已存在、本 socket 不是成员、`intent === 'create'` → 返回
   `{ error: 'Room ID is already taken', code: 'ROOM_OCCUPIED' }`，**不 push、不改动房间**。
   宽限期内被保留的旧座位仍在 `rooms[roomId]` 中，因此也计入“有人占用”。
3. 否则 `intent==='join'`/缺省 → 原逻辑（满 2 人 `ROOM_FULL`，否则加入/自动创建）。

**为什么创建者自己的重连不会被误判占用：**

- 首次 create 已消费一次性标记；重连/刷新/resume 发的是 `intent:'join'`，不触发规则 2。
- 真正的断线重连走 B14 `reclaimPendingDisconnect`：同一 participantId 在宽限期内接管
  旧座位（`replaceUser`），此时该 socket **已经是成员**，`joinRoom` 命中规则 1，
  即使带了 create 也返回成功。
- 宽限期被陌生人 create 时，座位仍属于旧 socket → 规则 2 正确拒绝；同一 participant
  用新 socket + create 则先 reclaim 成为成员，再成功。

### 2.4 错误码与兼容性

`join-error` 现在第二个参数带机器码：
`SECRET_FIELD` / `INVALID_ROOM_ID` / `RATE_LIMITED` / `ROOM_OCCUPIED` / `ROOM_FULL`。
第一个参数仍是英文消息，旧客户端只读第一个参数 → 行为不变。

- **新客户端 + 旧 relay**：relay 不认识 `intent` → 相当于普通 join，照常进房；
  但不会返回 `ROOM_OCCUPIED`/`INVALID_ROOM_ID` 码，占用提示与格式码不生效（客户端
  仍有自己的格式校验，所以非法输入不会提交）。
- **旧 APK/旧客户端 + 新 relay**：不带 `intent` = join，自动创建行为不变；旧房间号
  仍满足 `^[A-Za-z0-9_-]{4,64}$`；旧客户端收到英文 `join-error` 后照旧 `alert`。
- 客户端收到 `ROOM_OCCUPIED` / `INVALID_ROOM_ID`：不进入房间，`navigate('/', {
  replace, state })` 回表单，内联显示翻译文案并保留输入；`ROOM_OCCUPIED` 通过
  `revert` 快照把“上次房间”回滚到创建前的值，避免被拒的房间号污染 join 预填。

### 2.5 顺带修复的加密竞态（由「被拒 → 重新加入」流程暴露）

1. `crypto.worker.js` 之前在模块顶层 `await sodium.ready` 之后才设置
   `self.onmessage`；快速重进时新 worker 尚未 ready 就收到 `deriveAuthKey`，消息被
   丢弃导致永久卡在「等待对方」。改为**同步安装 `onmessage`**，每条消息内
   `await sodiumReady`。
2. `ChatRoom` 连接/重试发送公钥改读 `myPublicKeyRef.current`（而非渲染闭包），
   避免快速进房时双方都错过首轮公钥。
3. 队列中的 auth proof 在验证通过后直接调用 `markVerifiedRef.current()`，不再依赖
   可能已经跑过的 `hasSharedKey`/`fingerprint` effect。

## 3. 改动文件

新增：

- `client/src/utils/roomId.js`（格式/长度常量、校验、随机 id）
- `client/src/utils/roomIntent.js`（一次性 create 标记）
- `tools/custom-room-id-test.cjs`、`tools/room-id-unit-test.cjs`、`tools/browser-smoke.cjs`
- `screens/custom-room-id/*.png`（8 张）
- `BRIEF-custom-room-id.md`（本任务书）

修改：

- 客户端：`pages/CreateRoom.jsx`、`pages/ChatRoom.jsx`、`utils/lastRoom.js`、
  `crypto/crypto.worker.js`、`src/styles/hacker-theme.css`、`i18n/locales/{en,zh-Hans,zh-Hant}.js`、
  `update/appVersion.js`、`eslint.config.js`、`android/app/build.gradle`
- 服务端：`server/app.js`、`server/rooms/roomManager.js`
- 测试/文档：`tools/update-e2e-test.mjs`、`README.md`、`FEATURES.md`、
  `CUT-PROGRESS.md`、`MOBILE-ANDROID.md`

`client/android/gradle.properties` 与根 `client/android/build.gradle` 的代理/`mavenLocal`
仅为本机构建临时改动，**已还原**，最终提交中不含。

## 4. 测试结果

| 测试 | 结果 | 说明 |
|---|---|---|
| `tools/smoke-test.cjs` | **16 passed / 0 failed** | 真实 relay（3001）；E2EE 文本/图片、房间满、销毁等基线 |
| `tools/b14-grace-test.cjs` | **8 passed / 0 failed** | 宽限保座、reclaim、真放弃销毁、手动离开、默认 60s |
| `tools/update-logic-test.mjs` | **36 passed / 0 failed** | 更新逻辑；`appVersion` 1.5.0 (6) |
| `tools/update-e2e-test.mjs` | **39 passed / 0 failed** | 真实构建 + headless Chrome；见下「既有测试维护」 |
| `tools/room-id-unit-test.cjs`（新） | **34 passed / 0 failed** | client/server 正则一致性、`joinRoom` intent 纯逻辑 |
| `tools/custom-room-id-test.cjs`（新） | **36 passed / 0 failed** | 真实 relay：非法矩阵、占用、join/full、宽限占用、reclaim（create+join）、幂等、销毁后重建 |
| `tools/browser-smoke.cjs`（新） | **9 passed / 0 failed** | 两标签页真实 UI + 加密消息双向收发 + 三语 |
| `cd client && npm run lint` | **exit 0（0 problems）** | 见下「lint」 |

**lint**：改前 `npm run lint` 为 841 problems（840 errors / 1 warning），全部来自
旧的、被同步进 `client/android/app/.../assets/public/` 的**压缩构建产物**（`dist`
已被忽略，Capacitor 副本没有）；源码 `npx eslint src scripts` 一直为 0。本次在
`eslint.config.js` 的 `globalIgnores` 中补上生成的 Capacitor 目录，`npm run lint`
现在 **exit 0**，不新增任何源码错误。

**既有测试维护**：`tools/update-e2e-test.mjs` 里两处硬编码旧版本 `1.1.0 (2)`
（v1.4.0 时已失效），改为从 `client/src/update/appVersion.js` 读取当前安装版本，
修好后 39/0。

**构建期间遇到的本地环境问题**：Gradle 无法把已缓存的
`drawerlayout-1.0.0.aar`、`lifecycle-viewmodel/runtime-2.6.2.aar` 解析出来（对
`dl.google.com` 直连/代理都偶发 404）。用本地 Gradle 缓存补进 `~/.m2` 并临时加
`mavenLocal()` 后 `assembleDebug` 成功；临时改动已还原，源码不含。这是本机
沙箱/网络问题，不是 APK 配置变化。

## 5. 浏览器冒烟截图清单

生产模式 relay（`NODE_ENV=production PORT=3002`，避开 8090）服务 `client/dist`，
headless Chrome（390×844，DPR 2）两标签页：

| 文件 | 内容 |
|---|---|
| `01-create-custom-ok.png` | A 用自定义房间号 `team-alpha-2026` + 密钥创建成功，进入房间（邀请链接显示该 id） |
| `02-create-occupied.png` | B 用同一 id 创建 → 回首页、表单内联「房间号已被占用，请换一个。」 |
| `03-join-same-id-ok.png` | B 切到加入模式用同一 id + 密钥成功加入；双方各发一条加密消息（`hello-from-B-42` / `hello-from-A-42`），显示「加密已启用」+ 验证码 |
| `04-short-id-warning.png` | 创建页输入 `abc12` → 黄色「房间号太短，容易被别人猜中——建议至少 8 位。」，仍可提交 |
| `05-invalid-id-create.png` | 创建页输入 `bad id` → 红色「房间号只能包含字母、数字、- 和 _，长度 4–64。」 |
| `06-invalid-id-join.png` | 加入页输入 `a b` → 内联「房间号格式不正确，请使用 4–64 位字母、数字、- 或 _。」 |
| `07-zh-Hant.png` | 繁體中文创建页新文案（自訂房間號…、太短警告） |
| `08-en.png` | English 创建页新文案（Custom room id…、short warning） |

已逐张目视核对内容与文件名一致。

## 6. 构建 / APK

- `cd client && npm run build` exit 0（`prebuild` 同步 `appVersion.js` 为 1.5.0 / 6）。
- `npx cap sync android` exit 0。
- `./gradlew assembleDebug` BUILD SUCCESSFUL。
- 产物：`dist-mobile/Silencium-debug.apk`
  - 大小：**4,853,135 bytes（≈ 4.6 MB）**
  - SHA-256：`55ceae7b954473a8bebfc0ee190af44602d611baf28d7880d44e75552de6bc2d`
  - `aapt2 dump badging`：`package app.silencium.chat`，`versionCode 6`，`versionName 1.5.0`
- `dist-mobile/` 与 APK 受 `.gitignore` 管理，不进入源码提交。

## 7. 发布结果

- Release：<https://github.com/peaeae314-hub/silencium-releases/releases/tag/v1.5.0>
  - 标题：`v1.5.0 (custom room id + occupied/create guard)`
  - 附件：`Silencium-debug.apk`（4,853,135 bytes）、`version.json`（921 bytes）
- 发布仓库 `main` 的 `version.json` 已更新并推送（commit `c3c7a23`）：

```json
{
  "versionCode": 6,
  "versionName": "1.5.0",
  "apkUrl": "https://github.com/peaeae314-hub/silencium-releases/releases/download/v1.5.0/Silencium-debug.apk",
  "force": false,
  "changelogZh": "创建房间可自定义房间号（4–64 位字母/数字/-/_）；房间号被占用时内联提示、不进入房间；服务端与加入表单校验房间号格式；修复快速重进房间时的密钥交换卡住",
  "changelogEn": "Optional custom room id on create (4–64 letters/digits/-/_); inline \"room id already taken\" error instead of entering the room; server + join form enforce the room-id format; fixed a key-exchange stall when re-entering a room quickly",
  "changelogZhHant": "建立房間可自訂房間號（4–64 位字母/數字/-/_）；房間號已被占用時內聯提示、不進入房間；伺服器與加入表單校驗房間號格式；修復快速重進房間時的金鑰交換卡住"
}
```

- 验证输出：
  - `curl -L .../releases/latest/download/version.json` → `versionCode: 6`、`1.5.0`、apkUrl 指向 v1.5.0 ✅
  - `raw.githubusercontent.com/...@main/version.json` → `versionCode: 6` ✅
  - APK 下载 `HEAD` → **HTTP 200**；`Range: 0-1023` → **HTTP 206，1024 bytes** ✅

## 8. 推送的提交

远端 `peaeae`（`https://github.com/peaeae314-hub/Silencium.git`）`main` 快进
`3ca723b → 5713515`（**未推 origin，未 force**）：

```
5713515 test: add two-tab browser smoke screenshots (screens/custom-room-id)
645c52f docs: add custom-room-id/v1.5.0 brief
b940b4f docs: document optional custom room ids and the occupied-create guard
24e8cc7 chore: bump Android to 1.5.0 (versionCode 6)
d53c33e chore(client): ignore generated Capacitor bundles in eslint
a665914 test: custom room id relay/unit/browser tests
34f2ac2 fix(crypto): don't drop worker messages during sodium init
917bb93 feat(client): create intent + join-error codes in ChatRoom
6a3c9b4 feat(server): validate room id + reject create on occupied room
717d110 i18n: custom room id, occupied and format strings (zh-Hans/zh-Hant/en)
44fb5f6 feat(client): optional custom room id on create
```

报告提交 `docs: add REPORT-custom-room-id.md` 会追加在本报告之后。提交作者使用环境
变量 `peaeae314 <peaeae314@gmail.com>`，未改全局 git config。

## 9. 未解决项与建议

1. **relay 部署**：占用检查 / 服务端格式校验只在本次新 `server/` 生效。任何公开
   relay 必须重启到新版本；网页端也需重新 `npm run build` 才能用内联错误码文案。
2. **旧 relay 时的降级**：新客户端连旧 relay 时，创建同名房间不会收到
   `ROOM_OCCUPIED`，会按旧逻辑自动加入；不是安全问题，但功能依赖新 relay。
3. **本地 Gradle 依赖缓存**：本机对 `dl.google.com` 的 3 个旧版 androidx 构件偶发
   404/解析失败，本次用 `~/.m2` + 临时 `mavenLocal()` 绕过；CI/干净机器可能需要
   预热的 Gradle 缓存或镜像。建议后续在 CI 中固定依赖镜像。
4. **`isValidRoomId` 客户端会 trim**：创建/加入表单先 trim 再校验，符合需求
   “去掉首尾空白后校验”；服务端对收到的字符串按原样匹配（含空格即非法）。若未来
   有客户端直接发送未 trim 的 id，会被服务端拒绝。
5. **房间号短警告仅是提示**：< 8 位仍可创建（按需求）；房间号本身是加入凭证，真正
   的准入仍靠房间密钥认证（B8），所以短房间号的风险是“第二座位易被抢占/骚扰”，
   不是泄密。
6. **未改动的历史行为**：单独在房时的加密握手竞态已顺带修复（§2.5）；`establishing`
   的其它极端时序仍依赖重连/重发兜底，未做额外改动。
