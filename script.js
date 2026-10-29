const API_BASE = "http://localhost:3000/api";
let jwtToken = localStorage.getItem("iot_jwt_token") || "";

// Khởi tạo mảng dữ liệu
let sensorData = [];
let tatCaLichSu = [];
let banChupCamBien = [];   // dữ liệu bảng Data Sensor: chỉ lấy lúc đăng nhập
let banChupLichSu = [];    // dữ liệu bảng Action History: chỉ lấy lúc đăng nhập

let camBienDangHienThi = null;
let trangThaiDen = { LED01: false, LED02: false, LED03: false };
let dangDieuKhien = false;
let machDangKetNoi = null;   // null = chưa biết, true/false = trạng thái mạch

function hienCanhBaoMatKetNoi(hien) {
    let hop = document.getElementById("device-offline-alert");
    if (!hop) {
        hop = document.createElement("div");
        hop.id = "device-offline-alert";
        hop.className = "device-offline-alert";
        hop.innerHTML = '<span class="offline-icon">⚠️</span>' +
            '<div><strong>Đã ngắt kết nối với mạch!</strong>' +
            '<p>Không nhận được dữ liệu từ ESP8266. Hãy kiểm tra nguồn / dây cắm. Các lệnh điều khiển sẽ được ghi ở trạng thái PENDING.</p></div>' +
            '<button type="button" aria-label="Đóng">✕</button>';
        hop.querySelector("button").addEventListener("click", function() { hop.hidden = true; });
        document.body.appendChild(hop);
    }
    hop.classList.toggle("restored", !hien);
    if (hien) {
        hop.querySelector("strong").textContent = "Đã ngắt kết nối với mạch!";
        hop.querySelector("p").textContent = "Không nhận được dữ liệu từ ESP8266. Hãy kiểm tra nguồn / dây cắm. Các lệnh điều khiển sẽ được ghi ở trạng thái PENDING.";
        hop.querySelector(".offline-icon").textContent = "⚠️";
        hop.hidden = false;
    } else {
        hop.querySelector("strong").textContent = "Đã kết nối lại với mạch";
        hop.querySelector("p").textContent = "Mạch đã hoạt động trở lại.";
        hop.querySelector(".offline-icon").textContent = "✅";
        hop.hidden = false;
        setTimeout(function() { if (machDangKetNoi) hop.hidden = true; }, 3000);
    }
}

async function kiemTraKetNoiMach() {
    try {
        const kq = await goiAPI("/device/status");
        if (typeof kq.connected !== "boolean") return;
        if (machDangKetNoi !== kq.connected) {
            const lanDau = machDangKetNoi === null;
            machDangKetNoi = kq.connected;
            if (!kq.connected) {
                hienCanhBaoMatKetNoi(true);
                setTimeout(function() {
                    alert("⚠️ Đã ngắt kết nối với mạch!\nKhông nhận được dữ liệu từ ESP8266, hãy kiểm tra nguồn / dây cắm.");
                }, 50);
            }
            else if (!lanDau) hienCanhBaoMatKetNoi(false);
        }
    } catch (e) {
        console.error("Lỗi kiểm tra kết nối mạch:", e);
    }
}

// ================= 1. XÁC THỰC JWT & GỌI API =================
let timerCapNhat = null;
let timerKetNoi = null;

function hienThiManHinhDangNhap(hien) {
    document.getElementById("login-overlay").hidden = !hien;
}

async function dangNhapLayToken(username, password) {
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.token) {
            jwtToken = data.token;
            localStorage.setItem("iot_jwt_token", jwtToken);
            return { ok: true };
        }
        return { ok: false, error: data.error || "Đăng nhập thất bại!" };
    } catch (err) {
        console.error("Không kết nối được Backend:", err);
        return { ok: false, error: "Không kết nối được Backend!" };
    }
}

async function dangXuat() {
    clearInterval(timerCapNhat);
    timerCapNhat = null;
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: "POST" });
    } catch (err) {}
    jwtToken = "";
    localStorage.removeItem("iot_jwt_token");
    document.getElementById("login-pass").value = "";
    hienThiManHinhDangNhap(true);
}

async function goiAPI(duongDan, tuyChon = {}) {
    const cauHinh = {
        ...tuyChon,
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + jwtToken,
            ...(tuyChon.headers || {})
        }
    };

    const res = await fetch(`${API_BASE}${duongDan}`, cauHinh);

    if (res.status === 401 || res.status === 403) {
        if (jwtToken) await dangXuat();
        return {};
    }
    return res.json();
}

// ================= 2. THỜI GIAN & ĐIỀU HƯỚNG TRANG =================
function chuyenThoiGian(chuoi) {
    if (!chuoi || !chuoi.includes(" - ")) return 0;
    const [ngay, gio] = chuoi.split(" - ");
    const [y, m, d] = ngay.split("/").map(Number);
    const [hh, mm, ss] = gio.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, ss).getTime();
}

function nutCopyNgay(time) {
    return `<button type="button" class="copy-date-btn" data-date="${layNgayTuChuoi(time)}" title="Copy ngày">📋</button>`;
}

document.addEventListener("click", function(e) {
    const nut = e.target.closest(".copy-date-btn");
    if (!nut) return;
    const ngay = nut.dataset.date;
    const xong = function() {
        nut.textContent = "✓";
        setTimeout(function() { nut.textContent = "📋"; }, 1000);
    };
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(ngay).then(xong);
    } else {
        const o = document.createElement("textarea");
        o.value = ngay;
        document.body.appendChild(o);
        o.select();
        document.execCommand("copy");
        o.remove();
        xong();
    }
});

function layNgayTuChuoi(time) {
    if (!time) return "";
    const [ngay] = time.split(" - ");
    return ngay;
}

document.querySelectorAll(".nav-btn").forEach(function(nut) {
    nut.addEventListener("click", function() {
        const tenTrang = nut.dataset.page;
        document.querySelectorAll(".page").forEach(function(trang) {
            trang.classList.remove("active-page");
        });
        document.getElementById(tenTrang).classList.add("active-page");

        document.querySelectorAll(".nav-btn").forEach(function(b) {
            b.classList.remove("active");
        });
        nut.classList.add("active");

        if (tenTrang === "dashboard") {
            veBieuDo();
        }
    });
});

// ================= 3. DASHBOARD =================
function hienThiDashboard() {
    if (!camBienDangHienThi) {
        document.getElementById("nhiet-do").textContent = "-- °C";
        document.getElementById("do-am").textContent = "-- %";
        document.getElementById("anh-sang").textContent = "--";
        return;
    }
    document.getElementById("nhiet-do").textContent = camBienDangHienThi.temperature + " °C";
    document.getElementById("do-am").textContent = camBienDangHienThi.humidity + " %";
    document.getElementById("anh-sang").textContent = camBienDangHienThi.light + " ADC";
}

// ================= 4. ĐIỀU KHIỂN 3 ĐÈN (LED01, LED02, LED03, ALL_LED) =================
function hienThiDen() {
    ["LED01", "LED02", "LED03"].forEach(function(tenDen) {
        const dangBat = trangThaiDen[tenDen];
        const tenId = tenDen.toLowerCase();
        const nut = document.getElementById("btn-" + tenId);
        const trangThai = document.getElementById("state-" + tenId);
        const the = document.getElementById("card-" + tenId);

        if (nut) {
            nut.textContent = dangBat ? "Tắt " + tenDen : "Bật " + tenDen;
            nut.classList.toggle("on", dangBat);
        }
        if (trangThai) {
            trangThai.textContent = dangBat ? "BẬT" : "TẮT";
            trangThai.className = dangBat ? "state-on" : "state-off";
        }
        if (the) {
            the.classList.toggle("is-on", dangBat);
        }
    });

    // Mờ nút "Bật tất cả" khi cả 3 đèn đã bật, mờ nút "Tắt tất cả" khi cả 3 đèn đã tắt
    const caBaBat = trangThaiDen.LED01 && trangThaiDen.LED02 && trangThaiDen.LED03;
    const caBaTat = !trangThaiDen.LED01 && !trangThaiDen.LED02 && !trangThaiDen.LED03;

    const btnAllOn = document.getElementById("btn-all-on");
    const btnAllOff = document.getElementById("btn-all-off");

    if (btnAllOn) btnAllOn.disabled = caBaBat;
    if (btnAllOff) btnAllOff.disabled = caBaTat;
}

function capNhatTrangThaiDenTuLichSu() {
    if (dangDieuKhien) return;
    let led1 = false;
    let led2 = false;
    let led3 = false;

    const lichSuTangDan = [...tatCaLichSu].sort(function(a, b) { return a.id - b.id; });
    lichSuTangDan.forEach(function(item) {
        if (item.status === "SUCCESS") {
            if (item.device === "LED01") led1 = (item.action === "ON");
            else if (item.device === "LED02") led2 = (item.action === "ON");
            else if (item.device === "LED03") led3 = (item.action === "ON");
            else if (item.device === "ALL_LED") {
                led1 = (item.action === "ON");
                led2 = (item.action === "ON");
                led3 = (item.action === "ON");
            }
        }
    });

    trangThaiDen.LED01 = led1;
    trangThaiDen.LED02 = led2;
    trangThaiDen.LED03 = led3;
    hienThiDen();
}

async function xuLyDieuKhien(thietBiGuiLen, hanhDong) {
    if (dangDieuKhien) return;
    dangDieuKhien = true;

    const trangThaiMoi = (hanhDong === "ON");
    const danhSachDenHieuUng = thietBiGuiLen === "ALL_LED" ? ["LED01", "LED02", "LED03"] : [thietBiGuiLen];

    const tatCaNut = ["btn-led01", "btn-led02", "btn-led03", "btn-all-on", "btn-all-off"];
    tatCaNut.forEach(function(id) {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });

    // Hiển thị hiệu ứng ĐANG XỬ LÝ màu cam
    danhSachDenHieuUng.forEach(function(tenDen) {
        const tenId = tenDen.toLowerCase();
        const the = document.getElementById("card-" + tenId);
        const nut = document.getElementById("btn-" + tenId);
        const trangThai = document.getElementById("state-" + tenId);

        if (the) the.classList.add("is-loading");
        if (nut) nut.innerHTML = '<span class="button-spinner"></span> Đang ' + (trangThaiMoi ? "bật" : "tắt") + '...';
        if (trangThai) {
            trangThai.textContent = "ĐANG XỬ LÝ";
            trangThai.className = "state-loading";
        }
    });

    try {
        const [ketQua] = await Promise.all([
            goiAPI("/device/control", {
                method: "POST",
                body: JSON.stringify({ device: thietBiGuiLen, action: hanhDong })
            }),
            new Promise(resolve => setTimeout(resolve, 1500))
        ]);

        if (ketQua.status === "SUCCESS") {
            danhSachDenHieuUng.forEach(function(tenDen) {
                trangThaiDen[tenDen] = trangThaiMoi;
            });
        } else {
            console.warn(`Thao tác ${thietBiGuiLen} (${hanhDong}) chưa thực hiện được (${ketQua.status}).`);
        }
    } catch (err) {
        console.error("Lỗi: Không thể kết nối tới máy chủ Backend!", err);
    } finally {
        danhSachDenHieuUng.forEach(function(tenDen) {
            const the = document.getElementById("card-" + tenDen.toLowerCase());
            if (the) the.classList.remove("is-loading");
        });

        dangDieuKhien = false;
        tatCaNut.forEach(function(id) {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        });

        // hienThiDen sẽ tự tính toán để làm mờ btn-all-on hoặc btn-all-off nếu đạt điều kiện
        hienThiDen();
        await taiDuLieuLichSu();
    }
}

// Bắt sự kiện click
document.getElementById("btn-led01").addEventListener("click", function() {
    xuLyDieuKhien("LED01", !trangThaiDen.LED01 ? "ON" : "OFF");
});
document.getElementById("btn-led02").addEventListener("click", function() {
    xuLyDieuKhien("LED02", !trangThaiDen.LED02 ? "ON" : "OFF");
});
document.getElementById("btn-led03").addEventListener("click", function() {
    xuLyDieuKhien("LED03", !trangThaiDen.LED03 ? "ON" : "OFF");
});
document.getElementById("btn-all-on").addEventListener("click", function() {
    xuLyDieuKhien("ALL_LED", "ON");
});
document.getElementById("btn-all-off").addEventListener("click", function() {
    xuLyDieuKhien("ALL_LED", "OFF");
});

hienThiDen();

// ================= 5. BIỂU ĐỒ CẢM BIẾN =================
const mauBieuDo = {
    temperature: "#ef704a",
    humidity: "#228bd4",
    light: "#d6a124"
};

const thangDo = {
    temperature: { min: 0, max: 100 },
    humidity: { min: 0, max: 100 },
    light: { min: 0, max: 1000 }
};

let duLieuBieuDo = [];
let diemBieuDo = [];
let vungBieuDo = null;
let viTriHover = -1;

function veBieuDo() {
    const canvas = document.getElementById("sensor-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const vung = document.getElementById("chart-area");
    const soLuong = Number(document.getElementById("chart-count").value);

    duLieuBieuDo = [...sensorData]
        .sort(function(a, b) { return a.id - b.id; })
        .slice(-soLuong);

    const W = vung.clientWidth || 600;
    const H = vung.clientHeight || 250;
    canvas.width = W;
    canvas.height = H;

    const leTrai = 60;
    const lePhai = 60;
    const leTren = 30;
    const leDuoi = 45;
    const rong = W - leTrai - lePhai;
    const cao = H - leTren - leDuoi;
    vungBieuDo = { trai: leTrai, phai: W - lePhai, tren: leTren, duoi: H - leDuoi, rong: rong, cao: cao };

    function toaDoX(i) {
        return leTrai + (i / Math.max(duLieuBieuDo.length - 1, 1)) * rong;
    }

    function toaDoY(giaTri, loai) {
        const thang = thangDo[loai];
        return leTren + ((thang.max - giaTri) / (thang.max - thang.min)) * cao;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.font = "11px Arial";

    for (let i = 0; i <= 5; i++) {
        const y = leTren + (i / 5) * cao;
        ctx.strokeStyle = "#eaf0ed";
        ctx.beginPath();
        ctx.moveTo(leTrai, y);
        ctx.lineTo(W - lePhai, y);
        ctx.stroke();

        const tiLe = 1 - i / 5;
        const giaTriTrai = thangDo.temperature.min + tiLe * (thangDo.temperature.max - thangDo.temperature.min);
        const giaTriPhai = thangDo.light.min + tiLe * (thangDo.light.max - thangDo.light.min);

        ctx.fillStyle = "#63766e";
        ctx.textAlign = "right";
        ctx.fillText(giaTriTrai.toFixed(0), leTrai - 10, y + 4);
        ctx.textAlign = "left";
        ctx.fillText(giaTriPhai.toFixed(0), W - lePhai + 10, y + 4);
    }

    ctx.fillText("ADC", W - lePhai + 10, 18);
    ctx.textAlign = "right";
    ctx.fillText("°C / %", leTrai - 10, 18);
    ctx.textAlign = "center";

    if (duLieuBieuDo.length === 0) {
        diemBieuDo = [];
        return;
    }

    diemBieuDo = duLieuBieuDo.map(function(item, i) {
        return {
            x: toaDoX(i),
            temperature: { x: toaDoX(i), y: toaDoY(item.temperature, "temperature") },
            humidity: { x: toaDoX(i), y: toaDoY(item.humidity, "humidity") },
            light: { x: toaDoX(i), y: toaDoY(item.light, "light") }
        };
    });

    ["temperature", "humidity", "light"].forEach(function(loai) {
        ctx.beginPath();
        diemBieuDo.forEach(function(d, i) {
            if (i === 0) ctx.moveTo(d[loai].x, d[loai].y);
            else ctx.lineTo(d[loai].x, d[loai].y);
        });
        ctx.strokeStyle = mauBieuDo[loai];
        ctx.lineWidth = 2.5;
        ctx.stroke();

        diemBieuDo.forEach(function(d) {
            ctx.beginPath();
            ctx.arc(d[loai].x, d[loai].y, 3, 0, 2 * Math.PI);
            ctx.fillStyle = mauBieuDo[loai];
            ctx.fill();
        });
    });

    if (viTriHover >= 0 && viTriHover < diemBieuDo.length) {
        const d = diemBieuDo[viTriHover];
        ctx.beginPath();
        ctx.strokeStyle = "#93a6a0";
        ctx.lineWidth = 1;
        ctx.moveTo(d.x, leTren);
        ctx.lineTo(d.x, H - leDuoi);
        ctx.stroke();
    }
}

document.getElementById("sensor-chart").addEventListener("mousemove", function(event) {
    if (duLieuBieuDo.length === 0) return;
    const canvas = document.getElementById("sensor-chart");
    const tooltip = document.getElementById("chart-tooltip");
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (!vungBieuDo || x < vungBieuDo.trai || x > vungBieuDo.phai || y < vungBieuDo.tren || y > vungBieuDo.duoi) {
        viTriHover = -1;
        tooltip.hidden = true;
        veBieuDo();
        return;
    }

    const chiSo = Math.round(((x - vungBieuDo.trai) / vungBieuDo.rong) * Math.max(duLieuBieuDo.length - 1, 1));
    viTriHover = Math.max(0, Math.min(duLieuBieuDo.length - 1, chiSo));
    veBieuDo();

    const banGhi = duLieuBieuDo[viTriHover];
    tooltip.innerHTML = `
        <strong>${banGhi.time}</strong>
        <span>Nhiệt độ: <b>${banGhi.temperature} °C</b></span>
        <span>Độ ẩm: <b>${banGhi.humidity} %</b></span>
        <span>Ánh sáng: <b>${banGhi.light} ADC</b></span>
    `;
    tooltip.hidden = false;
    tooltip.style.left = Math.min(diemBieuDo[viTriHover].x + 12, canvas.width - 210) + "px";
    tooltip.style.top = Math.max(10, y - 80) + "px";
});

document.getElementById("sensor-chart").addEventListener("mouseleave", function() {
    viTriHover = -1;
    document.getElementById("chart-tooltip").hidden = true;
    veBieuDo();
});

document.getElementById("chart-count").addEventListener("change", veBieuDo);
window.addEventListener("resize", veBieuDo);

// ================= 6. BẢNG DATA SENSOR =================
let duLieuDangLoc = [];
let cotSapXep = "id";
let chieuSapXep = "desc";
let trangCamBien = 1;

const goiYPlaceholder = {
    all: "Nhập nhiệt độ (°C), độ ẩm (%) hoặc ánh sáng (ADC)...",
    temperature: "Nhập vào nhiệt độ (°C)...",
    humidity: "Nhập vào độ ẩm (%)...",
    light: "Nhập vào ánh sáng (ADC)...",
    time: "Nhập vào thời gian (Năm/Tháng/Ngày)..."
};

document.getElementById("search-field").addEventListener("change", function() {
    const loai = this.value;
    const oNhap = document.getElementById("search-value");
    oNhap.value = "";
    oNhap.type = loai === "time" ? "text" : "number";
    oNhap.placeholder = goiYPlaceholder[loai];
    locCamBien(true);
});

function locCamBien(resetTrang = false) {
    const loai = document.getElementById("search-field").value;
    const tuKhoa = document.getElementById("search-value").value.trim();
    const soCanTim = Number(tuKhoa);

    duLieuDangLoc = banChupCamBien.filter(function(item) {
        if (tuKhoa === "") return true;
        if (loai === "time") return layNgayTuChuoi(item.time) === tuKhoa;
        if (loai === "all") {
            return item.temperature === soCanTim || item.humidity === soCanTim || item.light === soCanTim;
        }
        return item[loai] === soCanTim;
    });

    if (resetTrang) trangCamBien = 1;
    hienThiBangCamBien();
}

document.getElementById("search-btn").addEventListener("click", function() { locCamBien(true); });
document.getElementById("clear-btn").addEventListener("click", function() {
    document.getElementById("search-field").value = "all";
    const oNhap = document.getElementById("search-value");
    oNhap.value = "";
    oNhap.type = "number";
    oNhap.placeholder = goiYPlaceholder.all;
    locCamBien(true);
});

document.querySelectorAll(".sort-btn").forEach(function(nut) {
    nut.addEventListener("click", function() {
        const cot = nut.dataset.sort;
        if (cotSapXep === cot) {
            chieuSapXep = chieuSapXep === "asc" ? "desc" : "asc";
        } else {
            cotSapXep = cot;
            chieuSapXep = "asc";
        }
        trangCamBien = 1;
        hienThiBangCamBien();
    });
});

function hienThiBangCamBien() {
    const danhSach = [...duLieuDangLoc];

    if (cotSapXep !== "") {
        danhSach.sort(function(a, b) {
            let kq = cotSapXep === "time"
                ? chuyenThoiGian(a.time) - chuyenThoiGian(b.time)
                : a[cotSapXep] - b[cotSapXep];
            return chieuSapXep === "desc" ? -kq : kq;
        });
    }

    const soDong = Number(document.getElementById("sensor-page-size").value);
    const tongBanGhi = danhSach.length;
    const tongTrang = Math.max(1, Math.ceil(tongBanGhi / soDong));
    trangCamBien = Math.min(trangCamBien, tongTrang);

    const batDau = (trangCamBien - 1) * soDong;
    const duLieuTrang = danhSach.slice(batDau, batDau + soDong);

    const tbody = document.getElementById("sensor-body");
    tbody.innerHTML = "";

    if (duLieuTrang.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Không tìm thấy dữ liệu</td></tr>';
    } else {
        duLieuTrang.forEach(function(item) {
            tbody.innerHTML += `
                <tr>
                    <td>#${item.id}</td>
                    <td>${item.temperature}</td>
                    <td>${item.humidity}</td>
                    <td>${item.light}</td>
                    <td>${item.time} ${nutCopyNgay(item.time)}</td>
                </tr>
            `;
        });
    }

    const tuDong = tongBanGhi === 0 ? 0 : batDau + 1;
    const denDong = Math.min(batDau + soDong, tongBanGhi);
    document.getElementById("sensor-result-range").textContent =
        "Hiển thị " + tuDong + " - " + denDong + " / " + tongBanGhi + " bản ghi";
    document.getElementById("sensor-page-info").textContent = trangCamBien + " / " + tongTrang;
    document.getElementById("sensor-prev").disabled = trangCamBien === 1;
    document.getElementById("sensor-next").disabled = trangCamBien === tongTrang;

    document.querySelectorAll(".sort-btn").forEach(function(nut) {
        const icon = nut.querySelector(".sort-icon");
        icon.textContent = nut.dataset.sort === cotSapXep ? (chieuSapXep === "asc" ? "↑" : "↓") : "↕";
    });
}

document.getElementById("sensor-prev").addEventListener("click", function() {
    if (trangCamBien > 1) { trangCamBien--; hienThiBangCamBien(); }
});
document.getElementById("sensor-next").addEventListener("click", function() {
    trangCamBien++; hienThiBangCamBien();
});
document.getElementById("sensor-page-size").addEventListener("change", function() {
    trangCamBien = 1; hienThiBangCamBien();
});

// ================= 7. BẢNG ACTION HISTORY =================
let cotSapXepLichSu = "id";
let chieuSapXepLichSu = "desc";
let trangLichSu = 1;

function veBangLichSu() {
    const thietBi = document.getElementById("history-device").value;
    const hanhDong = document.getElementById("history-action").value;
    const ketQua = document.getElementById("history-status").value;
    const ngay = document.getElementById("history-date").value.trim();

    const danhSach = banChupLichSu.filter(function(item) {
        if (thietBi !== "" && item.device !== thietBi) return false;
        if (hanhDong !== "" && item.action !== hanhDong) return false;
        if (ketQua !== "" && item.status !== ketQua) return false;
        if (ngay !== "" && layNgayTuChuoi(item.time) !== ngay) return false;
        return true;
    });

    danhSach.sort(function(a, b) {
        let kq = 0;
        if (cotSapXepLichSu === "time") kq = chuyenThoiGian(a.time) - chuyenThoiGian(b.time);
        else if (cotSapXepLichSu === "id") kq = a.id - b.id;
        else kq = a[cotSapXepLichSu].localeCompare(b[cotSapXepLichSu]);
        return chieuSapXepLichSu === "desc" ? -kq : kq;
    });

    const soDong = Number(document.getElementById("history-page-size").value);
    const tongBanGhi = danhSach.length;
    const tongTrang = Math.max(1, Math.ceil(tongBanGhi / soDong));
    trangLichSu = Math.min(trangLichSu, tongTrang);

    const batDau = (trangLichSu - 1) * soDong;
    const duLieuTrang = danhSach.slice(batDau, batDau + soDong);

    const tbody = document.getElementById("history-body");
    tbody.innerHTML = "";

    if (duLieuTrang.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Không có lịch sử phù hợp</td></tr>';
    } else {
        duLieuTrang.forEach(function(item) {
            const classAction = item.action === "ON" ? "history-on" : "history-off";
            const classStatus = "history-state " + item.status.toLowerCase();
            tbody.innerHTML += `
                <tr>
                    <td>#${item.id}</td>
                    <td>${item.device}</td>
                    <td class="${classAction}">${item.action}</td>
                    <td class="${classStatus}">${item.status}</td>
                    <td>${item.time} ${nutCopyNgay(item.time)}</td>
                </tr>
            `;
        });
    }

    const tuDong = tongBanGhi === 0 ? 0 : batDau + 1;
    const denDong = Math.min(batDau + soDong, tongBanGhi);
    document.getElementById("history-result-count").textContent =
        "Hiển thị " + tuDong + " - " + denDong + " / " + tongBanGhi + " bản ghi";
    document.getElementById("history-page-info").textContent = trangLichSu + " / " + tongTrang;
    document.getElementById("history-prev").disabled = trangLichSu === 1;
    document.getElementById("history-next").disabled = trangLichSu === tongTrang;

    document.querySelectorAll(".history-sort").forEach(function(nut) {
        const muiTen = nut.querySelector(".history-arrow");
        muiTen.textContent = nut.dataset.historySort === cotSapXepLichSu
            ? (chieuSapXepLichSu === "asc" ? "↑" : "↓") : "↕";
    });
}

function capNhatLocLichSu() {
    trangLichSu = 1;
    veBangLichSu();
}

document.getElementById("history-device").addEventListener("change", capNhatLocLichSu);
document.getElementById("history-action").addEventListener("change", capNhatLocLichSu);
document.getElementById("history-status").addEventListener("change", capNhatLocLichSu);
document.getElementById("history-date").addEventListener("change", capNhatLocLichSu);
document.getElementById("history-filter-btn").addEventListener("click", capNhatLocLichSu);

document.getElementById("history-clear-btn").addEventListener("click", function() {
    document.getElementById("history-device").value = "";
    document.getElementById("history-action").value = "";
    document.getElementById("history-status").value = "";
    document.getElementById("history-date").value = "";
    capNhatLocLichSu();
});

document.querySelectorAll(".history-sort").forEach(function(nut) {
    nut.addEventListener("click", function() {
        const cot = nut.dataset.historySort;
        if (cotSapXepLichSu === cot) {
            chieuSapXepLichSu = chieuSapXepLichSu === "asc" ? "desc" : "asc";
        } else {
            cotSapXepLichSu = cot;
            chieuSapXepLichSu = "asc";
        }
        trangLichSu = 1;
        veBangLichSu();
    });
});

document.getElementById("history-prev").addEventListener("click", function() {
    if (trangLichSu > 1) { trangLichSu--; veBangLichSu(); }
});
document.getElementById("history-next").addEventListener("click", function() {
    trangLichSu++; veBangLichSu();
});
document.getElementById("history-page-size").addEventListener("change", function() {
    trangLichSu = 1; veBangLichSu();
});

// ================= 8. ĐỒNG BỘ DỮ LIỆU TỪ BACKEND VỀ WEB =================
async function taiDuLieuCamBien(capNhatBang = false) {
    try {
        const danhSach = await goiAPI("/sensors");
        if (Array.isArray(danhSach)) {
            sensorData = danhSach;
            camBienDangHienThi = sensorData.length > 0 ? sensorData[0] : null;
            hienThiDashboard();

            if (document.getElementById("dashboard").classList.contains("active-page")) {
                veBieuDo();
            }
            if (capNhatBang) {
                banChupCamBien = sensorData;
                locCamBien(false);
            }
        }
    } catch (e) {
        console.error("Lỗi tải dữ liệu cảm biến:", e);
    }
}

async function taiDuLieuLichSu(capNhatBang = false) {
    try {
        const danhSach = await goiAPI("/history");
        if (Array.isArray(danhSach)) {
            tatCaLichSu = danhSach;
            capNhatTrangThaiDenTuLichSu();
            if (capNhatBang) {
                banChupLichSu = danhSach;
                veBangLichSu();
            }
        }
    } catch (e) {
        console.error("Lỗi tải lịch sử:", e);
    }
}

// Khởi chạy hệ thống và cập nhật tự động mỗi 2 giây
async function batDauCapNhat() {
    hienThiManHinhDangNhap(false);
    await taiDuLieuCamBien(true);
    await taiDuLieuLichSu(true);
    machDangKetNoi = null;
    await kiemTraKetNoiMach();

    clearInterval(timerCapNhat);
    clearInterval(timerKetNoi);
    timerKetNoi = setInterval(kiemTraKetNoiMach, 1000);

    timerCapNhat = setInterval(function() {
        taiDuLieuCamBien();
        if (!dangDieuKhien) {
            taiDuLieuLichSu();
        }
    }, 2000);
}

document.getElementById("login-form").addEventListener("submit", async function(e) {
    e.preventDefault();
    const loi = document.getElementById("login-error");
    loi.hidden = true;

    const kq = await dangNhapLayToken(
        document.getElementById("login-user").value.trim(),
        document.getElementById("login-pass").value
    );
    if (kq.ok) {
        batDauCapNhat();
    } else {
        loi.textContent = kq.error;
        loi.hidden = false;
    }
});

document.getElementById("logout-btn").addEventListener("click", dangXuat);

async function khoiChayHeThong() {
    hienThiDashboard();
    veBieuDo();
    hienThiBangCamBien();
    veBangLichSu();

    if (jwtToken) {
        batDauCapNhat();
    } else {
        hienThiManHinhDangNhap(true);
    }
}

khoiChayHeThong();