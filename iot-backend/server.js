const express = require('express');
const mqtt = require('mqtt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(cors());

// Phục vụ trực tiếp giao diện Web
app.use(express.static(path.join(__dirname, '..')));

const SECRET_KEY = "my_super_secret_jwt_key_b23dcat306";
let phienDangNhap = null;

// Danh sách các đèn thực tế trong hệ thống
const DANH_SACH_LED = ["LED01", "LED02", "LED03"];

// ================= THÔNG TIN MQTT BROKER =================
const mqttUrl = 'mqtt://172.20.10.4:2000'; // Đổi đúng IP máy tính của bạn
const mqttOptions = {
    clientId: 'NodeJS_Backend_' + Math.random().toString(16).substring(2, 8),
    username: 'quantruong',
    password: '123456'
};

const client = mqtt.connect(mqttUrl, mqttOptions);

const TOPIC_SENSOR   = "data_sensors";
const TOPIC_CONTROL  = "device_control";
const TOPIC_RESPONSE = "device_response";

let pendingResponse = null;

// Mạch được coi là mất kết nối nếu quá ngần này ms không gửi dữ liệu cảm biến
const NGUONG_MAT_KET_NOI_MS = 5000;
let lanCuoiNhanDuLieu = 0;

function machDangKetNoi() {
    return Date.now() - lanCuoiNhanDuLieu <= NGUONG_MAT_KET_NOI_MS;
}

client.on('connect', () => {
    console.log("Connected to MQTT Broker!");
    client.subscribe([TOPIC_SENSOR, TOPIC_RESPONSE]);
});

function getFormattedTime() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} - ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Lắng nghe dữ liệu từ MQTT
client.on('message', (topic, payload) => {
    try {
        const messageStr = payload.toString();
        const data = JSON.parse(messageStr);

        // 1. Nhận dữ liệu cảm biến -> Lưu vào SQLite
        if (topic === TOPIC_SENSOR) {
            lanCuoiNhanDuLieu = Date.now();
            const timeNow = getFormattedTime();
            db.run(`INSERT INTO sensor_data (device_id, temperature, humidity, light, time) VALUES (?, ?, ?, ?, ?)`,
                [data.device_id, data.temperature, data.humidity, data.light, timeNow]);
        }

        // 2. Nhận phản hồi bật/tắt thiết bị từ mạch
        if (topic === TOPIC_RESPONSE) {
            const timeNow = getFormattedTime();

            // NẾU LÀ ALL_LED: TÁCH THÀNH 3 DÒNG LƯU DATABASE CHO LED01, LED02, LED03
            if (data.device === "ALL_LED") {
                DANH_SACH_LED.forEach(tenDen => {
                    db.run(`INSERT INTO action_history (device_id, device, action, status, time) VALUES (?, ?, ?, ?, ?)`,
                        [data.device_id || "ESP8266-01", tenDen, data.action, data.status, timeNow]);
                });
            } else {
                db.run(`INSERT INTO action_history (device_id, device, action, status, time) VALUES (?, ?, ?, ?, ?)`,
                    [data.device_id || "ESP8266-01", data.device, data.action, data.status, timeNow]);
            }

            // PHẢN HỒI API CHO WEB/POSTMAN: VẪN GIỮ NGUYÊN "ALL_LED"
            if (pendingResponse) {
                clearTimeout(pendingResponse.timeoutTimer);
                const responseData = {
                    device: data.device, // Vẫn là "ALL_LED"
                    action: data.action,
                    status: data.status,
                    time: timeNow
                };
                pendingResponse.resolve(responseData);
                pendingResponse = null;
            }
        }
    } catch (e) {
        console.error("MQTT Message parse error:", e);
    }
});

// ================= MIDDLEWARE XÁC THỰC JWT =================
function verifyJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Chưa cung cấp token JWT!" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err || !phienDangNhap || phienDangNhap.token !== token) {
            return res.status(403).json({ error: "Token không hợp lệ, đã hết hạn hoặc đã đăng xuất!" });
        }
        req.user = user;
        next();
    });
}

// ================= CÁC API ENDPOINT =================

// 1. API Đăng nhập lấy Token JWT
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'quantruong' && password === '123456') {
        const token = jwt.sign({ username: 'quantruong', role: 'admin' }, SECRET_KEY, { expiresIn: '2h' });
        phienDangNhap = { username, password, token };
        return res.json({ success: true, token, message: "Đăng nhập thành công!" });
    }
    res.status(401).json({ success: false, error: "Sai tài khoản hoặc mật khẩu!" });
});

// 1b. Đăng xuất
app.post('/api/auth/logout', (req, res) => {
    phienDangNhap = null;
    res.json({ success: true, message: "Đã đăng xuất!" });
});

// 1c. Postman: GET /api/login -> xem tài khoản, mật khẩu và token của phiên đang đăng nhập trên web
app.get('/api/login', (req, res) => {
    if (!phienDangNhap) {
        return res.status(401).json({ success: false, error: "Chưa có ai đăng nhập trên web!" });
    }
    res.json({
        success: true,
        username: phienDangNhap.username,
        password: phienDangNhap.password,
        token: phienDangNhap.token
    });
});

// 1d. Trạng thái kết nối của mạch
app.get('/api/device/status', verifyJWT, (req, res) => {
    res.json({ connected: machDangKetNoi() });
});

// 2. API Dashboard
app.get('/api/dashboard', verifyJWT, (req, res) => {
    const limitCount = parseInt(req.query.limit) || 14;

    db.all(`SELECT id, device_id, temperature, humidity, light, time FROM sensor_data ORDER BY id DESC LIMIT ?`, [limitCount], (err, chartRows) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(`SELECT device, action FROM action_history WHERE status = 'SUCCESS' GROUP BY device ORDER BY id DESC`, [], (err, deviceRows) => {
            let led01State = false;
            let led02State = false;
            let led03State = false;

            if (deviceRows) {
                deviceRows.forEach(row => {
                    if (row.device === 'LED01') led01State = (row.action === 'ON');
                    if (row.device === 'LED02') led02State = (row.action === 'ON');
                    if (row.device === 'LED03') led03State = (row.action === 'ON');
                });
            }

            const latestSensor = chartRows.length > 0 ? chartRows[0] : { temperature: "--", humidity: "--", light: "--" };

            res.json({
                latestSensor: latestSensor,
                chartData: chartRows.reverse(),
                deviceState: { LED01: led01State, LED02: led02State, LED03: led03State }
            });
        });
    });
});

// 3. API Điều khiển thiết bị
app.post('/api/device/control', verifyJWT, (req, res) => {
    const { device, action } = req.body;
    if (!device || !action) return res.status(400).json({ error: "Thiếu thông tin device hoặc action!" });

    const payload = JSON.stringify({ device_id: "ESP8266-01", device, action });
    client.publish(TOPIC_CONTROL, payload);

    const timeoutPromise = new Promise((resolve) => {
        const timeoutTimer = setTimeout(() => {
            if (pendingResponse) {
                const failTime = getFormattedTime();
                // Mạch đã rút/mất kết nối -> PENDING (chờ), còn mạch online mà không phản hồi -> FAILED
                const trangThaiLoi = machDangKetNoi() ? "FAILED" : "PENDING";

                // NẾU TIMEOUT VỚI ALL_LED: LƯU FAILED CHO TỪNG ĐÈN RIÊNG BIỆT
                if (device === "ALL_LED") {
                    DANH_SACH_LED.forEach(tenDen => {
                        db.run(`INSERT INTO action_history (device_id, device, action, status, time) VALUES (?, ?, ?, ?, ?)`,
                            ["ESP8266-01", tenDen, action, trangThaiLoi, failTime]);
                    });
                } else {
                    db.run(`INSERT INTO action_history (device_id, device, action, status, time) VALUES (?, ?, ?, ?, ?)`,
                        ["ESP8266-01", device, action, trangThaiLoi, failTime]);
                }

                // TRẢ VỀ CHO POSTMAN/WEB VẪN GIỮ NGUYÊN "ALL_LED"
                resolve({
                    device, // Vẫn là "ALL_LED"
                    action,
                    status: trangThaiLoi,
                    time: failTime,
                    message: trangThaiLoi === "PENDING"
                        ? "Mạch đang ngắt kết nối, lệnh được lưu ở trạng thái PENDING!"
                        : "Lỗi: Không kết nối được với phần cứng (Timeout sau 5 giây)!"
                });
                pendingResponse = null;
            }
        }, 5000);

        pendingResponse = { resolve, timeoutTimer };
    });

    timeoutPromise.then(result => {
        res.json(result);
    });
});

// ================= PHÂN TRANG / TÌM KIẾM / SẮP XẾP DÙNG CHUNG =================
// Nếu request KHÔNG có page/limit -> trả mảng đầy đủ (để web cũ vẫn chạy).
// Nếu có page hoặc limit -> trả {data, pagination} với đủ trang trước/sau.
function xuLyDanhSach(req, res, { bang, cotChoPhep, cotMacDinh, boLoc }) {
    const q = req.query;
    const coPhanTrang = q.page !== undefined || q.limit !== undefined;

    const where = [];
    const params = [];
    boLoc(q, where, params);
    const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";

    const sortBy = cotChoPhep.includes(q.sortBy) ? q.sortBy : cotMacDinh;
    const order = String(q.order).toLowerCase() === "asc" ? "ASC" : "DESC";
    const orderSql = ` ORDER BY ${sortBy} ${order}, id ${order}`;

    if (!coPhanTrang) {
        return db.all(`SELECT * FROM ${bang}${whereSql}${orderSql}`, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    }

    const limit = Math.min(Math.max(parseInt(q.limit) || 10, 1), 100);
    let page = Math.max(parseInt(q.page) || 1, 1);

    db.get(`SELECT COUNT(*) AS total FROM ${bang}${whereSql}`, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = row.total;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        page = Math.min(page, totalPages);

        db.all(`SELECT * FROM ${bang}${whereSql}${orderSql} LIMIT ? OFFSET ?`,
            [...params, limit, (page - 1) * limit], (err2, rows) => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({
                    data: rows,
                    pagination: {
                        page,
                        limit,
                        total,
                        totalPages,
                        hasPrev: page > 1,
                        hasNext: page < totalPages,
                        prevPage: page > 1 ? page - 1 : null,   // API trang trước
                        nextPage: page < totalPages ? page + 1 : null, // API trang sau
                        firstPage: 1,
                        lastPage: totalPages
                    }
                });
            });
    });
}

// 4. API Data Sensor
// GET /api/sensors?page=1&limit=10&field=all|temperature|humidity|light|time|device_id&search=...&sortBy=id&order=desc
app.get('/api/sensors', verifyJWT, (req, res) => {
    xuLyDanhSach(req, res, {
        bang: "sensor_data",
        cotChoPhep: ["id", "device_id", "temperature", "humidity", "light", "time"],
        cotMacDinh: "id",
        boLoc: (q, where, params) => {
            const tuKhoa = (q.search || "").toString().trim();
            if (tuKhoa === "") return;
            const field = q.field || "all";
            const so = Number(tuKhoa);
            if (field === "time") {
                where.push("time LIKE ?");
                params.push(tuKhoa + "%");
            } else if (field === "device_id") {
                where.push("device_id LIKE ?");
                params.push("%" + tuKhoa + "%");
            } else if (["temperature", "humidity", "light"].includes(field)) {
                where.push(`${field} = ?`);
                params.push(so);
            } else {
                where.push("(temperature = ? OR humidity = ? OR light = ?)");
                params.push(so, so, so);
            }
        }
    });
});

// 5. API Action History
// GET /api/history?page=1&limit=10&device=LED01&action=ON&status=SUCCESS|FAILED|PENDING&date=2026/10/29&search=...&sortBy=id&order=desc
app.get('/api/history', verifyJWT, (req, res) => {
    xuLyDanhSach(req, res, {
        bang: "action_history",
        cotChoPhep: ["id", "device_id", "device", "action", "status", "time"],
        cotMacDinh: "id",
        boLoc: (q, where, params) => {
            if (q.device) { where.push("device = ?"); params.push(q.device); }
            if (q.action) { where.push("action = ?"); params.push(q.action); }
            if (q.status) { where.push("status = ?"); params.push(q.status); }
            if (q.date)   { where.push("time LIKE ?"); params.push(q.date.toString().trim() + "%"); }
            const tuKhoa = (q.search || "").toString().trim();
            if (tuKhoa !== "") {
                where.push("(device LIKE ? OR action LIKE ? OR status LIKE ? OR time LIKE ?)");
                const m = "%" + tuKhoa + "%";
                params.push(m, m, m, m);
            }
        }
    });
});

app.listen(3000, () => {
    console.log("Backend Server is running on http://localhost:3000");
});