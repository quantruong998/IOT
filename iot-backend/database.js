const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./greenhouse.db');

db.serialize(() => {
    // 1. Bảng lưu dữ liệu cảm biến từ mạch gửi lên
    db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        temperature REAL,
        humidity REAL,
        light INTEGER,
        time TEXT
    )`);

    // 2. Bảng lưu lịch sử bật/tắt thiết bị
    db.run(`CREATE TABLE IF NOT EXISTS action_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        device TEXT,
        action TEXT,
        status TEXT,
        time TEXT
    )`);
});

module.exports = db;