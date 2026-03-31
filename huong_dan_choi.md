# 🃏 Hướng Dẫn Chơi Tiến Lên Miền Nam - Multiplayer LAN

## 1. Yêu Cầu Hệ Thống

- **Node.js** phiên bản 18 trở lên ([tải tại đây](https://nodejs.org/))
- Các máy chơi phải cùng **một mạng LAN/WiFi**
- Trình duyệt hiện đại (Chrome, Edge, Firefox)

## 2. Cài Đặt (Chỉ Cần Làm 1 Lần)

Mở Terminal/CMD tại thư mục project và chạy:

```bash
npm install
```

Lệnh này sẽ cài đặt các thư viện cần thiết (`express`, `socket.io`).

## 3. Khởi Chạy Server

Tại thư mục project, chạy **một trong hai** lệnh sau:

```bash
node server.js
```

hoặc:

```bash
npm start
```

Khi server khởi chạy thành công, bạn sẽ thấy thông báo:

```
🃏 Tiến Lên Miền Nam - Server
   Truy cập: http://localhost:3000
   LAN: http://<IP-máy-bạn>:3000
```

> ⚠️ **Lưu ý:** KHÔNG dùng `python -m http.server` vì game cần WebSocket (Socket.IO) để hỗ trợ multiplayer.

## 4. Tìm Địa Chỉ IP Máy Host

### Windows
Mở CMD và gõ:
```bash
ipconfig
```
Tìm dòng **IPv4 Address** trong phần **Wireless LAN** (WiFi) hoặc **Ethernet** (mạng dây).  
Ví dụ: `192.168.1.100`

### macOS / Linux
```bash
ifconfig
```
hoặc:
```bash
hostname -I
```

## 5. Truy Cập Game

### Máy host (người chạy server):
Mở trình duyệt vào:
```
http://localhost:3000
```

### Các máy khác (cùng mạng LAN):
Mở trình duyệt vào:
```
http://<IP-máy-host>:3000
```
Ví dụ: `http://192.168.1.100:3000`

## 6. Cách Chơi

### Bước 1: Nhập tên
Khi truy cập game, nhập tên của bạn rồi nhấn **Vào Game**.

### Bước 2: Chọn bàn
Trong sảnh chờ có 6 bàn. Nhấn vào bàn muốn chơi để vào.

### Bước 3: Chờ người chơi
- Đợi bạn bè vào cùng bàn.
- Nếu muốn chơi với máy (AI), nhấn nút **+** ở các vị trí trống.
- Cần tối thiểu **2 người chơi** (người thật hoặc AI).

### Bước 4: Sẵn sàng
Tất cả người chơi thật nhấn **Sẵn Sàng**. Game sẽ đếm ngược 3 giây rồi bắt đầu.

### Bước 5: Đánh bài
- Nhấn vào quân bài để chọn (quân được chọn sẽ nhô lên).
- Nhấn **Đánh Bài** để đánh.
- Nhấn **Bỏ Lượt** nếu không muốn/có thể chặn.
- Mỗi lượt có **30 giây** để đánh.

## 7. Quy Tắc Đánh Trước

| Tình huống | Ai đánh trước? |
|---|---|
| Ván đầu tiên | Người vào bàn đầu tiên |
| Các ván tiếp theo | Người thắng ván trước |

## 8. Xử Lý Sự Cố

| Vấn đề | Cách xử lý |
|---|---|
| Không kết nối được từ máy khác | Kiểm tra tường lửa (Firewall), cho phép port 3000 |
| Trang trắng / lỗi kết nối | Đảm bảo đã chạy `npm install` và `node server.js` |
| Game bị lag | Kiểm tra kết nối mạng LAN/WiFi |
| Muốn đổi port | Chạy `set PORT=8080 && node server.js` (Windows) |

### Mở port trên Windows Firewall:
```bash
netsh advfirewall firewall add rule name="TienLen" dir=in action=allow protocol=TCP localport=3000
```

## 9. Dừng Server

Nhấn `Ctrl + C` trong Terminal/CMD đang chạy server.
