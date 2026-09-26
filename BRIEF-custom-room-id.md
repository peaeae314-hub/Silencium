# 任务：创建房间支持「自定义房间号」+ 创建占用检查 + 房间号格式校验，并发布 v1.5.0

仓库：/workspace/Silencium（HEAD `3ca723b` = v1.4.0 / versionCode 5）。远端：`origin`=ubiiii（**不要推**），`peaeae`=https://github.com/peaeae314-hub/Silencium.git（推这里）。发布仓库：https://github.com/peaeae314-hub/silencium-releases（`gh` 已登录为 peaeae314-hub）。
提交作者用环境变量：`GIT_AUTHOR_NAME=peaeae314 GIT_AUTHOR_EMAIL=peaeae314@gmail.com GIT_COMMITTER_NAME=peaeae314 GIT_COMMITTER_EMAIL=peaeae314@gmail.com`，不要改全局 git config。
范围：只改 /workspace/Silencium 与发布仓库（可以 clone 到 /tmp 或 /workspace/Silencium 之外的临时目录操作 silencium-releases）。**本机 8090 端口和上面的 cloudflared 隧道属于另一个项目，不要占用、不要杀**；测试用其它端口（如 relay 3001/3999，vite 5173/4173）。E2EE、房间密钥不上服务器、2 人房、B14 重连宽限逻辑都不能退化。

## 现状（编排侧已查）
- `client/src/pages/CreateRoom.jsx`：`mode` = 'create' | 'join'；`generateRoomId()` = 16 字节 CSPRNG → base64url 22 位；`handleCreateRoom` 校验房间密钥后 `goToRoom(generateRoomId(), key)` → `navigate('/chat?room=<id>')`；`handleJoinRoom` 用 `extractRoomId()` 解析邀请链接/`?room=`/裸 id，空则 `home.joinError`。错误用 `errorKey`（存 i18n key）。
- `client/src/pages/ChatRoom.jsx` 有 **4 处** `socket.emit('join-room', { roomId, participantId })`：约 469 行（B14 前台恢复 resume）、520 行（`handleConnect`，每次 socket connect）、564 行（`handleReconnect`）、760 行（首次 setup，`socket.connected` 时）。首次进入时 setup 和 handleConnect **可能都发一次**。`join-error` 处理（约 916 行）：`alert('❌ ' + msg)` 然后 `navigate('/')`。
- `server/app.js` `join-room`（约 206–272 行）：拒绝带密钥字段 → 校验 roomId 为非空字符串 → 限流 → 记 participantId → 若 socket 已在别的房间先离开 → `reclaimPendingDisconnect(roomId, socket.id, participantId)`（B14：同一 participant 在宽限期内重连，接管旧座位）→ `roomManager.joinRoom`（不存在就创建；同一 socket 重复加入是幂等的；满 2 人返回 'Room is full'）。错误都是 `socket.emit('join-error', '<英文字符串>')`。
- `server/rooms/roomManager.js`：内存 `rooms[roomId] = [socketId…]`，有 `joinRoom/leaveRoom/getUsers/deleteRoom/replaceUser/removeUser`。
- i18n：`client/src/i18n/locales/{zh-Hans,zh-Hant,en}.js`。
- **没有单元测试框架**（server/client 的 `npm test` 都是占位）。现有测试是 `tools/` 下的 Node 脚本，对真实 relay 进程跑：`tools/smoke-test.cjs`（需要 relay 在 `SILENCIUM_URL`，默认 3001）、`tools/b14-grace-test.cjs`（自己拉起 relay，端口 3999，`SILENCIUM_DISCONNECT_GRACE_MS` 缩短宽限）、`tools/update-logic-test.mjs`、`tools/update-e2e-test.mjs`。运行方式见各文件头（`NODE_PATH=/workspace/Silencium/client/node_modules node tools/...`）。另有 `client` 的 `npm run lint`。

## 需求（用户已确认）

### 1. 创建页：可选自定义房间号
- create 模式加一个可选输入框「自定义房间号（可选）」（placeholder / 说明文字也要 i18n），放在房间密钥附近，不打乱现有布局；移动端也要好看。
- 留空 → 仍用 `generateRoomId()`（22 位随机 base64url）。
- 输入去掉首尾空白后校验 `^[A-Za-z0-9_-]{4,64}$`：
  - 不合法 → 输入框下方内联错误（例如「房间号只能包含字母、数字、- 和 _，长度 4–64」），不提交；
  - 合法但长度 < 8 → 显示黄色/提示色警告「房间号太短，容易被别人猜中」，**仍允许创建**；
  - 建议在输入框旁注明房间号就是加入凭证，越长越难猜（一句话即可）。
- 把正则/长度常量放到一个共享的小模块（例如 `client/src/utils/roomId.js`，导出 `ROOM_ID_PATTERN`、`isValidRoomId`、`SHORT_ROOM_ID_WARN_LEN = 8`，`generateRoomId` 也可以挪进去），服务端用同样的正则（服务端单独定义一份常量，两边写注释互相指向）。

### 2. 创建意图 intent='create' 与「房间号已被占用」
- 客户端：从创建页进入时，要让 ChatRoom 知道这是「创建」（例如 `navigate('/chat?room=…', { state: { intent: 'create' } })`，或一次性 sessionStorage 标记）。ChatRoom **只在本页面实例的第一次 join-room** 带 `intent: 'create'`，之后所有 join-room（handleConnect 重连、handleReconnect、前台 resume、刷新页面）都发 `intent: 'join'`（或不带 intent）。标记用完即清除，**刷新 `/chat?room=…` 不能再次当作 create**（注意 `history.state` 在刷新后会保留，如果用 router state 要在第一次使用后 `navigate(..., { replace: true, state: null })` 清掉，或者用一次性内存/sessionStorage 标记）。
- 首次进入时 setup 和 handleConnect 可能各发一次 join-room：第二次如果也带 create，服务端要**把同一 socket 的重复 create 视为幂等成功**（socket 已在该房间 → 直接返回成功，不报占用）。建议两层保护：客户端只让第一次带 create + 服务端对「该 socket 已是成员」「本次是 reclaim 接管」都不判占用。
- 服务端 `join-room`：
  - `intent === 'create'` 且房间已存在且有**除本 socket 之外**的成员（包括宽限期中被保留的座位）→ 拒绝，**不加入**、不影响房内的人，返回占用错误。
  - `intent === 'join'` 或缺省 → 维持现状（不存在就自动创建）。
  - B14 reclaim 路径不受影响：如果 `reclaimPendingDisconnect` 接管成功，一律按加入成功处理，即使带了 create。
  - 占用判断放在 `roomManager`（例如 `roomExists(roomId)` / `joinRoom(roomId, socketId, { intent })` 返回 `{ error: 'ROOM_OCCUPIED' }`），app.js 不直接碰 rooms map（B9 约定）。
- **错误码**：给 join-error 加机器可读的错误码，兼容旧客户端。推荐：`socket.emit('join-error', '<英文消息>', { code: 'ROOM_OCCUPIED' | 'INVALID_ROOM_ID' | 'ROOM_FULL' | 'RATE_LIMITED' | 'SECRET_FIELD' })`（旧客户端只读第一个参数，照旧 alert）。新客户端按 code 显示翻译过的文案。
- 客户端收到 `ROOM_OCCUPIED`：**不进入房间**，回到首页创建表单，保留用户输入的自定义房间号和密钥，在表单内联显示「房间号已被占用」（不要用 alert；其它错误可以也改成回首页内联显示，至少 ROOM_OCCUPIED 和 INVALID_ROOM_ID 要这样）。回首页后不要把这个房间号写进「上次房间」预填的 join 链接里造成混淆（按现有 `saveLastRoom` 逻辑判断，必要时在被拒时不保存/回滚）。
- 兼容：新客户端 + 旧 relay（不认识 intent）→ 就是现在的行为，照常加入；旧 APK + 新 relay → 不带 intent = join，行为不变。在报告里写明。

### 3. 房间号格式校验（服务端 + 加入表单）
- 服务端 `join-room`：`roomId` 不匹配 `^[A-Za-z0-9_-]{4,64}$` → 拒绝（code `INVALID_ROOM_ID`），create 和 join 都校验。随机 22 位 id 天然符合，旧邀请链接不受影响（确认 `tools/smoke-test.cjs`、`b14-grace-test.cjs` 里生成的测试房间号也符合；`b14-…-时间戳` 这种符合）。其它按 roomId 的事件（send-message/图片/公钥等）不强制改，但如有统一入口可以顺带校验，别引入回归。
- 客户端加入表单：`extractRoomId()` 结果也用同一正则校验，不合法显示内联错误（新 i18n 文案），不跳转。短 id 在加入时不警告（只在创建时警告）。

### 4. i18n
所有新文案三种语言（zh-Hans / zh-Hant / en）齐全：输入框标签「自定义房间号（可选）」、占位/说明、格式错误、太短警告「房间号太短，容易被别人猜中」、「房间号已被占用」、加入时房间号格式错误、以及其它你新增的提示。

### 5. 测试
- 先跑现有测试确认基线：`tools/smoke-test.cjs`（自己起一个 relay：`cd server && PORT=3001 node app.js` 或按 README，测完关掉）、`tools/b14-grace-test.cjs`、`tools/update-logic-test.mjs`、`tools/update-e2e-test.mjs`（如需网络/条件不满足就注明）、`client` 的 `npm run lint`（记录改前改后告警数，不新增错误）。
- 新增 `tools/custom-room-id-test.cjs`（同样对真实 relay 进程，参考 b14 测试的起进程方式），覆盖：
  1. 非法 roomId（太短 `abc`、含空格/中文/`/`、65 位）→ `join-error` 且 code=`INVALID_ROOM_ID`，create/join 都测；合法边界 4 位、64 位通过；
  2. A 用 intent=create 创建 `my-room-xyz` 成功；B 用 intent=create 同名 → `ROOM_OCCUPIED`，且 B 不在房间里、A 没收到任何 system-message/room-destroyed；
  3. B 用 intent=join 同名 → 成功加入（2 人）；第三个 join → Room is full（原逻辑）；
  4. A 断线后在宽限期内用**新 socket、同 participantId、intent=create** 重新 join → 接管成功（不报占用）；以及 intent=join 重连同样成功；
  5. 同一 socket 连发两次 intent=create → 两次都成功（幂等）；
  6. 房间空了/销毁后再用 create → 成功。
- 如果给 roomManager 加了纯函数，也可以加一个不依赖进程的 `tools/room-id-unit-test.cjs`。
- 所有测试结果（通过数/输出摘要）写进报告。

### 6. 构建与浏览器冒烟
- `cd client && npm run build`（会先 version:sync）。本地起 relay（生产模式会顺带服务 `client/dist`，见 README「Build the client once, then run the relay in production mode」；否则用 vite preview 并在设置里指向本地 relay），端口避开 8090。
- 用 headless Chrome/Playwright/CDP 两个标签页（或两个 context）冒烟，并截图到 `screens/custom-room-id/`（手机竖屏尺寸如 390×844 为主，桌面一张可选；截图前确认内容与文件名一致）：
  1. 标签 A：创建页填自定义房间号（如 `team-alpha-2026`）+ 密钥 → 成功进入房间；
  2. 标签 B：创建页填同一房间号 → 回到首页并显示「房间号已被占用」，没进入房间；
  3. 标签 B：切到加入模式，填同一房间号 + 同一密钥 → 成功加入，双方能互发一条加密消息；
  4. 创建页输入 `abc12`（5 位）→ 显示「房间号太短，容易被别人猜中」但可以创建；输入 `ab`/`含空格 id` → 格式错误；
  5. 加入页输入非法房间号 → 内联错误；
  6. 三种语言至少各截一张新文案（可以只截创建页）。
- 截图文件名建议：`01-create-custom-ok.png`、`02-create-occupied.png`、`03-join-same-id-ok.png`、`04-short-id-warning.png`、`05-invalid-id-create.png`、`06-invalid-id-join.png`、`07-zh-Hant.png`、`08-en.png`。

### 7. APK 与发布 v1.5.0（常规流程，照 MOBILE-ANDROID.md「Publishing a release (发版步骤)」和 v1.4.0 的做法）
1. `client/android/app/build.gradle`：`versionCode 6`、`versionName "1.5.0"`（单一来源，`npm run build` 会同步 `client/src/update/appVersion.js`）。更新 MOBILE-ANDROID.md 顶部表格的 Version 行。
2. `npm run build` → `npx cap sync android` → `cd android && ./gradlew assembleDebug` → 复制到 `/workspace/Silencium/dist-mobile/Silencium-debug.apk`。
3. 先看 v1.4.0 是怎么发的（`gh release view v1.4.0 -R peaeae314-hub/silencium-releases`、发布仓库里 `version.json` 的历史格式与 changelog 写法），保持一致。
4. 在 silencium-releases 创建 Release `v1.5.0`（tag v1.5.0），附件 `Silencium-debug.apk` 和 `version.json`；`version.json` 同时更新到发布仓库 `main`：`versionCode: 6`、`versionName: "1.5.0"`、`apkUrl: https://github.com/peaeae314-hub/silencium-releases/releases/download/v1.5.0/Silencium-debug.apk`、`force: false`、`changelogZh` / `changelogZhHant` / `changelogEn`（简述：创建房间可自定义房间号；房间号被占用提示；房间号格式校验）。
5. 发布后验证：`curl -L https://github.com/peaeae314-hub/silencium-releases/releases/latest/download/version.json` 返回 versionCode 6；APK 下载 URL 返回 200（HEAD/range 即可）。
6. 把源码提交推到 `peaeae` 远端的当前分支（先 `git fetch peaeae` 确认可快进；**不要 force push，不要推 origin**）。

### 8. 文档与报告
- README / FEATURES.md 各加一两句：可选自定义房间号、格式规则、占用提示、短房间号风险。CUT-PROGRESS.md 如有惯例可简要记一笔。
- 报告 `/workspace/Silencium/REPORT-custom-room-id.md`（简体中文）：结论摘要表、设计（intent 流程、重连/宽限期/重复 join 为什么不会误判占用、错误码与兼容性）、改动文件列表、测试结果（现有 + 新增）、浏览器冒烟截图清单、构建/APK 路径与大小、发布结果（Release 链接、version.json 内容、验证输出）、推送的提交列表、未解决项与建议（例如：relay 运营方需要部署新 server 才有占用检查/格式校验）。
- git 小步提交，信息清楚（例如 `feat(client): optional custom room id on create`、`feat(server): validate room id + reject create on occupied room`、`test: custom room id relay tests`、`i18n: …`、`chore: bump Android to 1.5.0 (versionCode 6)`、`docs: …`）。本 BRIEF 一并提交。工作树最终干净。

## 验收清单
- [ ] 创建页可选自定义房间号；空 = 随机 22 位；非法内联报错；<8 位警告但可创建
- [ ] intent=create 同名占用 → 「房间号已被占用」、回首页、不进房；join 行为不变
- [ ] 创建者自己的重连/前台恢复/刷新/重复 join 不会被判占用（有自动化测试证明）
- [ ] 服务端 + 加入表单都校验 `^[A-Za-z0-9_-]{4,64}$`
- [ ] 三语文案齐全
- [ ] 现有测试 + 新测试通过；lint 不新增错误；web 构建成功；浏览器冒烟截图在 `screens/custom-room-id/`
- [ ] APK v1.5.0 (6) 构建；silencium-releases Release v1.5.0（APK + version.json）+ main 的 version.json 已更新并验证
- [ ] 源码推到 peaeae；REPORT-custom-room-id.md 完成
- 阻塞超过 30 分钟就停下，把现状和原因写进报告（发布/推送失败也如实写明，不要伪造）。
