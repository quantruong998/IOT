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

                // NẾU TIMEOUT VỚI ALL_LED: LƯU FAILED CHO TỪNG ĐÈN RIÊNG BIỆT
                if (device === "ALL_LED") {
                    DANH_SACH_LED.forEach(tenDen => {
                        db.run(`INSERT INTO action_history (device_id, device, action, status, time) VALUES (?, ?, ?, ?, ?)`,
                            ["ESP8266-01", tenDen, action, "FAILED", failTime]);
                    });
                } else {
                    db.run(`INSERT INTO action_history (device_id, device, action, status, time) VALUES (?, ?, ?, ?, ?)`,
                        ["ESP8266-01", device, action, "FAILED", failTime]);
                }

                // TRẢ VỀ CHO POSTMAN/WEB VẪN GIỮ NGUYÊN "ALL_LED"
                resolve({
                    device, // Vẫn là "ALL_LED"
                    action,
                    status: "FAILED",
                    time: failTime,
                    message: "Lỗi: Không kết nối được với phần cứng (Timeout sau 5 giây)!"
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

// 4. API Data Sensor
app.get('/api/sensors', verifyJWT, (req, res) => {
    db.all(`SELECT id, device_id, temperature, humidity, light, time FROM sensor_data ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. API Action History
app.get('/api/history', verifyJWT, (req, res) => {
    db.all(`SELECT * FROM action_history ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(3000, () => {
    console.log("Backend Server is running on http://localhost:3000");
});