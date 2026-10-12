# Demo Webview Registration V3

App React Native (Expo) để test đầu-cuối 4 API webview registration V3 của backend
`ca-registration-record-management-system`, đóng vai "đại lý tích hợp" gọi API từ mobile.

## Chạy trên điện thoại qua Expo Go

1. Backend Spring Boot phải đang chạy và điện thoại + máy tính phải cùng mạng WiFi (backend nghe ở
   `0.0.0.0:8080` mặc định, chỉ cần máy tính không chặn firewall port 8080).
2. Lấy IP LAN của máy chạy backend:
   - Windows: `ipconfig` → tìm `IPv4 Address` (vd `192.168.1.23`).
3. Cài dependency và chạy dev server:

   ```bash
   npm install
   npx expo start
   ```

4. Mở app **Expo Go** trên điện thoại (Android/iOS), scan mã QR hiện ra trong terminal/trình duyệt.
5. Trong app, mở mục **Cấu hình**, sửa `Base URL backend` thành `http://<IP-LAN-may-tinh>:8080`
   (KHÔNG dùng `localhost`/`127.0.0.1` vì đó là loopback của điện thoại, không phải của máy tính).
6. Điền `apiKey` / `secretKey` của 1 tài khoản đại lý tích hợp (không cần username/password — cả
   `generate-code` lẫn `gen-qr` đều xác thực được bằng `X-API-KEY`+`X-SIGNATURE` vì `HMACFilter` áp
   dụng toàn cục cho mọi request, không riêng `gen-qr`). Tài khoản phải thoả 2 điều kiện:
   - Đã được gán `apiKey` + `secretKey` (qua `PUT /api/users/edit`, xem hướng dẫn Postman trước đó).
   - `type` của tài khoản KHÔNG phải "Tài khoản thường" (`DEFAULT_ACCOUNT`) — tức phải là 1 trong các
     loại tích hợp (`INTEGRATION_ACCOUNT`, `VERIBOX_INTEGRATION_ACCOUNT`, `PARTNER_INTEGRATION_ACCOUNT`,
     `INTERNAL_INTEGRATION_ACCOUNT`). Nếu không, backend trả lỗi `ACCOUNT_NOT_INTEGRATION_TYPE` (1015).
7. Bấm lần lượt các nút theo thứ tự 1 → 4. Log kết quả từng bước hiện ở khối "Log" phía dưới.

## Luồng test trong app

Tất cả các bước gọi API đều xác thực bằng `X-API-KEY` + `X-SIGNATURE` (app tự tính chữ ký
HMAC-SHA256 giống hệt backend), không cần Bearer/login.

1. **Generate Code** — `POST /api/webview/registration/generate-code` lấy `webviewCode`.
2. **Mở Webview** — mở `GET /api/webview/registration/init?code=...` trong 1 WebView thật; app tự
   chặn điều hướng redirect (không cần trang FE `/registration/site` tồn tại thật) để lấy
   `exchangeCode`, rồi tự gọi `POST /api/webview/registration/exchange-token` và giải mã payload JWT
   để hiển thị.
3. **Gen QR** — `POST /api/webview/registration/gen-qr`.
4. **Mở Webview từ QR** — dùng lại đúng cơ chế ở bước 2 nhưng lấy `code` từ `webviewUrl` do gen-qr trả
   về (app tự thay lại host bằng `Base URL backend` đang cấu hình, vì `webviewUrl` gốc trỏ tới
   `ekyc.url` — 1 domain public cấu hình cứng ở backend, không phải địa chỉ backend bạn đang chạy để
   test).

## Bước 5: test luồng đăng ký CTS đầy đủ + nhận event

1. Chạy bước 1 (Generate Code) để có `webviewCode`. Để trống `sessionId` nếu muốn đăng ký mới; có
   `sessionId` thì webview chạy chế độ VERIFICATION (tiếp tục hồ sơ cũ).
2. Bấm **5) Mở luồng đăng ký CTS** → app mở trang thật `<Base URL>/webview/registration/init?code=...`
   và đi hết luồng: điền thông tin → `register-certificate-order` → xác thực → chụp khuôn mặt → ký phiếu.
3. Sau khi ký, webview gọi liên tục `check-cert-for-open-session` và bắn event về app:
   `{ type: "easy-ca:cert-issue-result", status, reason, data }`.
   - `status: true`: `data` có `sessionId`, `serial`, `credentialID`, `certRaw`, `accessToken`.
   - `status: false`: `data.errorCode` là `SESSION_EXPIRED` | `API_ERROR` | `NETWORK_ERROR` | `TIMEOUT` |
     `MISSING_SESSION` | `PENDING` (người dùng tự đóng khi CTS còn đang cấp — chưa chắc là thất bại).
4. App hiện banner ngay trên webview khi nhận event, ghi vào Log và hiện thẻ "Kết quả cấp CTS".
   Webview tự đóng khi web gửi `easy-ca:exist-webview` hoặc kết thúc với `#success`/`#cancel`.
   Nút back Android được chuyển vào web dưới dạng `easy-ca:back-to-previous-screen`.

Cơ chế: web gửi event qua `window.flutter_inappwebview.callHandler(...)` (dành cho app Flutter). App này
inject một shim trước khi trang load để chuyển lời gọi đó sang `window.ReactNativeWebView.postMessage`,
nên không phải sửa web.

Lưu ý:
- `Base URL` phải là nơi phục vụ **cả FE lẫn API** (FE gọi API cùng origin). Backend chạy local chỉ phục
  vụ FE nếu đã build FE vào backend; nếu không hãy dùng UAT.
- Bước chụp khuôn mặt cần camera, mà WebView chỉ cho dùng camera trên **https**. Qua `http://<IP LAN>`
  sẽ không mở được camera → dùng UAT (https) hoặc ngrok.

## Ghi chú

- Cấu hình (baseUrl, apiKey/secretKey, dữ liệu đăng ký) được lưu lại bằng AsyncStorage nên không cần
  nhập lại mỗi lần mở app.
- App không gửi secretKey ra ngoài thiết bị dưới dạng plaintext, chỉ dùng nó cục bộ để tính chữ ký
  HMAC-SHA256; secretKey chỉ lưu local trên máy để tiện test lại.
- Nút "Reset luồng test" chỉ xoá state trong phiên hiện tại (token, webviewCode, log...), không xoá
  cấu hình đã lưu.
