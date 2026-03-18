/*!
 * KMZ EMR Standard - HPDB Excel Generator Worker
 * Copyright (c) 2026 Muhammad Ikhsanudin
 * * This file is part of KMZ EMR Standard.
 * This software is licensed under the PolyForm Strict License 1.0.0.
 * * STRICT PROHIBITION: You may use this software for your own purposes, 
 * but you MAY NOT modify, copy, or distribute this software or any 
 * modified version of it without prior written consent from the Copyright Holder.
 * * A copy of the license is located in the LICENSE file in the root directory, 
 * or can be found at: https://polyformproject.org/licenses/strict/1.0.0/
 */
 
importScripts('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js');

// --- 1. CONFIG STYLE & WARNA ---
const STYLES = {
    headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, // KUNING
    tubeColors: {
        'Blue': 'FF0066CC',   // Biru
        'Orange': 'FFFFC000', // Orange
        'Green': 'FF00B050',  // Hijau
        'Brown': 'FF833C0C',  // Coklat
        'Slate': 'FFBFBFBF',  // Abu-abu
        'White': 'FFFFFFFF',  // Putih
        'Red':   'FFFF0000',  // Merah
        'Black': 'FF000000',  // Hitam
        'Yellow':'FFFFFF00',  // Kuning
        'Violet':'FF7030A0',  // Ungu
        'Rose':  'FFFFC0CB',  // Pink
        'Aqua':  'FF00FFFF'   // Tosca
    },
    borderThin: { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} },
    borderMedium: { top: {style:'medium'}, left: {style:'medium'}, bottom: {style:'medium'}, right: {style:'medium'} }
};

const TUBE_ORDER = ["Blue", "Orange", "Green", "Brown", "Slate", "White", "Red", "Black", "Yellow", "Violet", "Rose", "Aqua"];

// --- 2. CONFIG HEADERS & HIDDEN COLUMNS ---
const REPORT_HEADERS = [
    "FDT Tray (Front)", "FDT Port", "Line", "Capacity", "Tube Colour", "Core Number", // A-F
    "FAT ID", "FAT Port", "Pole ID", "Pole Latitude", "Pole Longitude", "FAT Address", // G-L
    "Province", "regency_city", "district", "subdistrict", "postalcode", // M-Q
    "Roll_Out_ID", "acquisition_class", "acquisition_tier", "competition", "project_id", // R-V
    "Area", "Complex_name", "Clustername", "Commercial_name", // W-Z
    "Rw", "Rt", "address_prefix", "street", // AA-AD
    "address_suffix", "sub_address_prefix", "sub_address", "sub_address_suffix", // AE-AH (HIDDEN)
    "block", "homenumber", "dwelling_type", "building_type", // AI-AL
    "building_property_name", "building_property_location", "floor", "unit", // AM-AP (HIDDEN)
    "homepass_source", "oltcode", "fdtcode", "fatcode", // AQ-AT
    "RFSDate", "Latitude_homepass", "Longitude_homepass", "residential_service_ready", // AU-AX
    "sme_service_ready", "enterprise_service_ready", "installation", "availability", "network_presence", "wallplate_installation" // AY-BD (HIDDEN)
];

const HIDDEN_COLS_LIST = ['AE','AF','AG','AH','AL','AM','AN','AO','AP','AX','AY','AZ','BA','BB','BC','BD'];

// --- 3. MAIN WORKER LOGIC ---
self.onmessage = async function(e) {
    try {
        const { fdtGroups, dashboardData } = e.data;
        const wb = new ExcelJS.Workbook();
        
        // ==========================================
        // A. BUAT SHEET MASTER_DATA (Source of Truth)
        // ==========================================
        const wsMaster = wb.addWorksheet('MASTER_DATA');
        
        // 1. Header Database Kiri (Kolom A - I)
        const dbHeaders = ['ID_UNIK', 'POLE_ID', 'POLE_LAT', 'POLE_LON', 'HP_NAME', 'LINE', 'FAT_CODE', 'HP_LAT', 'HP_LON'];
        const masterHeaderRow = wsMaster.getRow(1);
        masterHeaderRow.values = dbHeaders;
        masterHeaderRow.font = { bold: true };

        // 2. Styling Kolom Database
        for (let i = 1; i <= 9; i++) {
            wsMaster.getColumn(i).width = 16; // Balikin ke 16 biar pas nggak kegencet
            wsMaster.getColumn(i).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        }

        // 3. Kolom J (Kosong sebagai Pemisah)
        wsMaster.getColumn(10).width = 5; 

        // 4. Logic Penempatan Dashboard di Sebelah Kanan (Menyamping)
        const sortedFdtKeys = Object.keys(fdtGroups).sort((a,b) => parseInt(a) - parseInt(b));
        let dashboardStartCol = 11; // Mulai dari Kolom K

        sortedFdtKeys.forEach(fdtID => {
            const fdtLabel = fdtID === 'OTHER' ? 'FDT GLOBAL' : `FDT ${fdtID.padStart(2, '0')}`;
            
            // Set Header FDT di baris 1
            wsMaster.getCell(1, dashboardStartCol).value = fdtLabel;
            wsMaster.getCell(1, dashboardStartCol).font = { bold: true, size: 12 };
            wsMaster.mergeCells(1, dashboardStartCol, 1, dashboardStartCol + 3);

            // Sub-Header Dashboard (Baris 2)
            const subHeaders = ['FAT_STREET_NAME', 'FAT_ID_KEY', 'TOTAL_HP', 'STATUS'];
            const subHeaderRow = wsMaster.getRow(2);
            subHeaders.forEach((h, idx) => {
                const cell = wsMaster.getCell(2, dashboardStartCol + idx);
                cell.value = h;
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
                cell.border = STYLES.borderThin;
                wsMaster.getColumn(dashboardStartCol + idx).width = 18; // Balikin settingan lebarnya
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            });

            // Isi Data Dashboard per FDT (Mulai baris 3)
            let dRow = 3;
            const fatStats = dashboardData[fdtID] || [];
            
            // Urutkan FAT agar rapi (A01, A02, dst)
            fatStats.sort((a, b) => a.fatName.localeCompare(b.fatName));

                fatStats.forEach(stat => {
                let statusTxt = "NORMAL";
                let isWarning = false; // Flag buat nandain butuh warna kuning

                if (stat.count < 10) { statusTxt = "⚠️ UNDER"; isWarning = true; }
                if (stat.count > 16) { statusTxt = "❌ OVER"; isWarning = true; }

                wsMaster.getCell(dRow, dashboardStartCol).value = stat.streetName || ""; // FAT_STREET_NAME
                wsMaster.getCell(dRow, dashboardStartCol + 1).value = stat.fatName.slice(-3); // FAT_ID_KEY
                wsMaster.getCell(dRow, dashboardStartCol + 2).value = stat.count; // TOTAL_HP
                
                const statusCell = wsMaster.getCell(dRow, dashboardStartCol + 3);
                statusCell.value = statusTxt; // STATUS

                // Kalau UNDER atau OVER, tembak warna background kuning
                if (isWarning) {
                    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
                    statusCell.font = { bold: true, color: { argb: 'FFFF0000' } }; // Bonus: Teks jadi merah biar makin 'ngamuk' keliatannya
                }
                
                // Styling data dashboard
                for(let i=0; i<4; i++) {
                    wsMaster.getCell(dRow, dashboardStartCol + i).border = STYLES.borderThin;
                    // Bikin vertical middle juga biar sama persis kayak header
                    wsMaster.getCell(dRow, dashboardStartCol + i).alignment = { vertical: 'middle', horizontal: 'center' };
                }
                dRow++;
            });

            dashboardStartCol += 5; // Geser ke kanan untuk FDT berikutnya (4 kolom data + 1 kolom kosong)
        });

        // ==========================================
        // FUNGSI HELPER: AUTOFIT COLUMN WIDTH (ACUAN 1 BARIS AJA)
        // ==========================================
        function autoFitColumnsByRow(worksheet, targetRowIndex, minWidth = 9) {
            const targetRow = worksheet.getRow(targetRowIndex);
            
            // Kita cuma muterin sel yang ada di baris acuan (misal: baris 8)
            targetRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                let finalWidth = minWidth;
                
                if (cell.value) {
                    const text = cell.value.toString();
                    // Kalau teks headernya di-wrap (ada enter), ukur baris terpanjangnya aja
                    const lines = text.split('\n');
                    const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
                    
                    finalWidth = maxLineLength + 2; // +2 buat padding biar gak mepet garis
                }
                
                // Kunci di minWidth kalau teksnya kependekan
                if (finalWidth < minWidth) {
                    finalWidth = minWidth;
                }
                
                worksheet.getColumn(colNumber).width = finalWidth;
            });
        }

        // ==========================================
        // FUNGSI HELPER: UBAH ANGKA JADI HURUF KOLOM EXCEL
        // ==========================================
        function getColLetter(colIndex) {
            let letter = '';
            while (colIndex > 0) {
                let temp = (colIndex - 1) % 26;
                letter = String.fromCharCode(temp + 65) + letter;
                colIndex = (colIndex - temp - 1) / 26;
            }
            return letter;
        }

        // Set zoom sheet MASTER_DATA jadi 85% juga
        wsMaster.views = [{ zoomScale: 85 }];

        // Simpan posisi baris awal untuk data Database Kiri
        let dbCurrentRow = 2; 
        let globalFatCounter = 0;
        // ==========================================
        // B. BUAT SHEET FDT (Report)
        // ==========================================
        sortedFdtKeys.forEach((fdtID, fdtIndex) => { // <--- Tambah fdtIndex di sini
            const sheetName = fdtID === 'OTHER' ? 'DETAIL_OTHERS' : `FDT-${fdtID.padStart(2, '0')}`;
            const wsFDT = wb.addWorksheet(sheetName);

            // --- LOGIC TENTUKAN KOLOM DASHBOARD DINAMIS ---
            const fdtDashboardStartCol = 11 + (fdtIndex * 5); // FDT 1 = 11 (K), FDT 2 = 16 (P), dst
            const streetColLetter = getColLetter(fdtDashboardStartCol);     // Kolom FAT_STREET_NAME
            const idColLetter = getColLetter(fdtDashboardStartCol + 1); // Kolom FAT_ID_KEY

        // --- SETUP HEADER STATIC (Baris 1-6) ---
            wsFDT.getCell('A1').value = 'FIBER CORE ASSIGNMENT';
            wsFDT.getCell('A1').font = { bold: true, size: 12 };

            // Row 3
            wsFDT.getCell('A3').value = 'Region';
            wsFDT.getCell('C3').value = ':'; 
            wsFDT.getCell('C3').alignment = { horizontal: 'right' };
            wsFDT.getCell('D3').value = 'TANGERANG'; // Manual Hardcode
            
            wsFDT.getCell('L3').value = 'FDT TYPE';
            wsFDT.getCell('M3').value = ':'; 
            wsFDT.getCell('M3').alignment = { horizontal: 'right' };
            wsFDT.getCell('N3').value = '72C'; // Manual Hardcode

            // Row 4
            wsFDT.getCell('A4').value = 'OLT / Feeder Line';
            wsFDT.getCell('C4').value = ':'; 
            wsFDT.getCell('C4').alignment = { horizontal: 'right' };
            wsFDT.getCell('D4').value = 'TANGERANG SEG-01'; // Manual Hardcode
            
            wsFDT.getCell('L4').value = 'HP / Construction type';
            wsFDT.getCell('M4').value = ':'; 
            wsFDT.getCell('M4').alignment = { horizontal: 'right' };
            const totalHP = fdtGroups[fdtID].length;
            wsFDT.getCell('N4').value = `${totalHP} HP /Aerial`; // Ini doang yg otomatis

            // Row 5
            wsFDT.getCell('A5').value = 'Cluster Name';
            wsFDT.getCell('C5').value = ':'; 
            wsFDT.getCell('C5').alignment = { horizontal: 'right' };
            wsFDT.getCell('D5').value = 'KELAPA DUA'; // Manual Hardcode
            
            wsFDT.getCell('L5').value = 'Distance From OLT';
            wsFDT.getCell('M5').value = ':'; 
            wsFDT.getCell('M5').alignment = { horizontal: 'right' };
            wsFDT.getCell('N5').value = 'm';

            // Row 6
            wsFDT.getCell('A6').value = 'FDT ID';
            wsFDT.getCell('C6').value = ':'; 
            wsFDT.getCell('C6').alignment = { horizontal: 'right' };
            wsFDT.getCell('D6').value = 'TGR.100.0101.FJKT.048'; // Manual Hardcode
            
            wsFDT.getCell('L6').value = 'COORDINATE FDT';
            wsFDT.getCell('M6').value = ':'; 
            wsFDT.getCell('M6').alignment = { horizontal: 'right' };
            wsFDT.getCell('N6').value = '-6.939921, 107.683027'; // Manual Hardcode 
            
            // --- TABLE HEADER (Baris 8) ---
            const headerRow = wsFDT.getRow(8);
            headerRow.values = REPORT_HEADERS;

            // 1. Kasih style dasar (Border, Alignment, dan Logika Warna Font)
            for (let i = 1; i <= REPORT_HEADERS.length; i++) {
                const cell = headerRow.getCell(i);
                cell.border = STYLES.borderThin; // <--- Ganti jadi borderThin
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };;

                // LOGIKA WARNA FONT: Kolom 1-12 Hitam, sisanya Putih
                if (i <= 12) {
                    cell.font = { bold: true, size: 10, color: { argb: 'FF000000' } }; // Hitam
                } else {
                    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }; // Putih
                }
            }

            // 2. CUSTOM WARNA PER RANGE (Tinggal lu atur nomor kolomnya)
            
            const headerColorRules = [
                { 
                    name: 'Light Green', 
                    argb: 'FF92D050', 
                    ranges: [[1, 12]] 
                },
                { 
                    name: 'Dark Red/Orange', 
                    argb: 'FFCC3300', 
                    ranges: [[13, 14], [18, 18], [20, 20], [22, 23], [25, 26], [45, 46]] 
                },
                { 
                    name: 'Dark Green', 
                    argb: 'FF009900', 
                    ranges: [[15, 17], [19, 19], [21, 21], [24, 24], [27, 30], [35, 37], [43, 44], [47, 49]] 
                },
                { 
                    name: 'Grey', 
                    argb: 'FF999999', 
                    ranges: [[31, 34], [38, 42], [50, 56]] 
                }
            ];

            // Eksekusi pewarnaan otomatis berdasarkan rules di atas
            headerColorRules.forEach(rule => {
                rule.ranges.forEach(([start, end]) => {
                    for (let c = start; c <= end; c++) {
                        wsFDT.getCell(8, c).fill = { 
                            type: 'pattern', 
                            pattern: 'solid', 
                            fgColor: { argb: rule.argb } 
                        };
                    }
                });
            });
            
            // Sisanya (21 sampai 56) biar putih aja, atau bisa lu tambah loop lagi di sini
            wsFDT.getRow(8).height = 40;

            // --- KELOMPOKKAN FAT UNTUK LOGIC MATH ---
            const fatMap = {};
            const lineFatCounts = {}; // Buat ngitung jumlah FAT per Line

            fdtGroups[fdtID].forEach(hp => {
                if (!fatMap[hp.fatCode]) fatMap[hp.fatCode] = [];
                fatMap[hp.fatCode].push(hp);

                // Kumpulin FAT unik per Line buat nentuin Capacity
                const cleanLine = hp.lineName.replace(/\s+FDT\s*\d+/i, '').trim(); // Potong jadi "LINE A" doang
                if (!lineFatCounts[cleanLine]) lineFatCounts[cleanLine] = new Set();
                lineFatCounts[cleanLine].add(hp.fatCode);
            });

            // ... (kode sebelumnya di atas)
            const sortedFatCodes = Object.keys(fatMap).sort();
            let currentRow = 9;
            
            // SIAPIN 2 COUNTER BERBEDA
            let fdtFatCounter = 0;   // Counter buat FDT Port (lanjut terus per FDT)
            let currentLine = ''; 
            let lineFatCounter = 0;  // Counter buat Tube & Core (reset tiap Line)

            sortedFatCodes.forEach(fatCode => {
                const hpList = fatMap[fatCode];
                
                // Ambil lineName dari HP pertama
                const sampleLineName = hpList[0].lineName;
                const cleanLineName = sampleLineName.replace(/\s+FDT\s*\d+/i, '').trim();

                // LOGIC RESET TUBE & CORE TIAP GANTI LINE
                if (cleanLineName !== currentLine) {
                    currentLine = cleanLineName;
                    lineFatCounter = 0; // Reset ke Tube Biru & Core 1
                }

                // 1. --- LOGIC FDT PORT & TRAY (Pakai fdtFatCounter) ---
                // Tray dilanjut terus karena secara fisik tray FDT itu gabungan semua line
                const trayNumber = Math.floor(fdtFatCounter / 8) + 1;
                const fdtTrayText = `G${trayNumber}`;
                const fdtPortNumber = fdtFatCounter + 1; // Port 1, 2, 3... dst

                // 2. --- LOGIC TUBE & CORE (Pakai lineFatCounter) ---
                const tubeIndex = Math.floor(lineFatCounter / 5); 
                const tubeNumber = tubeIndex + 1; 
                const tubeColorName = TUBE_ORDER[tubeIndex % 12];
                const tubeArgb = STYLES.tubeColors[tubeColorName];

                const fatIndexInTube = lineFatCounter % 5;
                const startCore = (tubeIndex * 12) + (fatIndexInTube * 2) + 1; 

                // Simpan baris awal FAT buat patokan Merge
                const startFatRow = currentRow; 

                hpList.forEach((hp, idx) => {
                    const uniqueID = `${fdtID}_${fatCode}_${hp.hpName}`;
                    
                    // Tulis Database ke MASTER_DATA
                    const rowData = [uniqueID, hp.poleId, hp.poleLat, hp.poleLon, hp.hpName, hp.lineName, fatCode, hp.hpLat, hp.hpLon];
                    rowData.forEach((val, colIdx) => {
                        wsMaster.getCell(dbCurrentRow, colIdx + 1).value = val;
                    });

                    // Cek Capacity per Line
                    const fatCountInThisLine = lineFatCounts[cleanLineName].size;
                    const capacityText = fatCountInThisLine <= 10 ? '24C/2T' : '48C/4T';

                    const row = wsFDT.getRow(currentRow);
                    row.height = 15; 
                    
                    const rowValues = new Array(REPORT_HEADERS.length).fill(null);
                    
                    if (idx === 0) {
                        rowValues[0] = fdtTrayText; 
                        rowValues[6] = fatCode; 
                    }

                    if (idx < 2) {
                        // FDT Port cuma di baris 1
                        rowValues[1] = idx === 0 ? fdtPortNumber : null; 
                        
                        rowValues[2] = cleanLineName; 
                        rowValues[3] = capacityText; 
                        rowValues[4] = tubeNumber; 
                        rowValues[5] = startCore + idx; // Core tetep 2 baris (startCore & startCore + 1)
                    }

                    // -- Data Dinamis KML Sisanya (Sama kayak sebelumnya) --
                    rowValues[7] = idx + 1; 
                    rowValues[8] = hp.poleId; 
                    rowValues[9] = hp.poleLat; 
                    rowValues[10] = hp.poleLon;
                    
                    rowValues[12] = hp.provinsi; // M9
                    rowValues[13] = hp.kabupaten; // N9
                    rowValues[14] = hp.kecamatan; // O9
                    rowValues[15] = hp.desa; // P9
                    rowValues[16] = hp.kodepos; // Q9 
                    rowValues[22] = hp.kabupaten; // N9 
                    rowValues[24] = "GRAND MOSQUE OF BANDUNG"; 
                    rowValues[25] = "GRAND MOSQUE OF BANDUNG"; 
                    rowValues[26] = "10"; 
                    rowValues[27] = "10"; 
                    rowValues[28] = "JLN."; 
                    rowValues[35] = hp.hpName; 
                    rowValues[43] = "TGR.100.0101"; 
                    rowValues[44] = "KLP.048"; 
                    rowValues[45] = fatCode; 
                    rowValues[47] = hp.hpLat; 
                    rowValues[48] = hp.hpLon; 

                    // Logika Potong "JALAN" untuk Kolom AD9 (Index 29)
                    let cleanStreet = (hp.streetName || "").replace(/^(JALAN\s+|GANG\s+|GG\.\s+)/i, '').trim();
                    rowValues[29] = cleanStreet; // AD9
                    
                    row.values = rowValues;

                    // --- STYLING BARIS 9 KE BAWAH ---
                    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        if (colNumber <= REPORT_HEADERS.length) {
                            cell.border = STYLES.borderThin;
                            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                            cell.font = { size: 10 }; 

                            // --- HIGHLIGHT WARNA BIRU UNTUK BARIS PERTAMA TIAP FAT ---
                            // Kasih warna biru ke semua kolom (colNumber !== 7 itu FAT ID, colNumber !== 5 itu Tube Colour)
                            if (idx === 0 && colNumber !== 7 && colNumber !== 5) {
                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B0F0' } };
                            }
                        }
                    });

                    // Styling Khusus Kolom Tube Colour (Tetep ditaruh setelahnya biar aman)
                    if (idx < 2) {
                        const cellTube = row.getCell(5);
                        cellTube.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tubeArgb } };
                        cellTube.font = { size: 10, color: { argb: 'FF000000' } };
                    }

                    wsFDT.getCell(`L${currentRow}`).value = { 
                        formula: `IFERROR(INDEX(MASTER_DATA!${streetColLetter}:${streetColLetter}, MATCH("${fatCode}", MASTER_DATA!${idColLetter}:${idColLetter}, 0)), "")` 
                    };

                    dbCurrentRow++;
                    currentRow++;
                });

                if (hpList.length > 1) {
                    wsFDT.mergeCells(startFatRow, 7, startFatRow + 1, 7);
                    wsFDT.getCell(startFatRow, 7).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                }

                // NAIKKAN KEDUA COUNTER SETELAH SELESAI 1 FAT
                fdtFatCounter++;
                lineFatCounter++;
            });

            // --- FINISHING TOUCHES FDT SHEET ---
            // ySplit: 9 mengunci baris 1-9. xSplit: 8 mengunci baris A-H.
            wsFDT.views = [{ state: 'frozen', xSplit: 8, ySplit: 9, zoomScale: 85 }];
            HIDDEN_COLS_LIST.forEach(colLetter => {
                const col = wsFDT.getColumn(colLetter);
                if(col) col.hidden = true;
            });
            wsFDT.autoFilter = `A8:BD8`;


            // Jalankan fungsi Autofit untuk sheet FDT ini
            autoFitColumnsByRow(wsFDT, 8, 9);
            
            // --- CUSTOM WIDTH UNTUK KOLOM TERTENTU ---
            // Ditulis di sini biar nimpa ukuran hasil autofit-nya, fix jadi 21
            ['I', 'L', 'AD', 'AJ'].forEach(col => {
                wsFDT.getColumn(col).width = 21;
            });
        }); // Penutup sortedFdtKeys.forEach

        wsMaster.getColumn(1).hidden = true; // Hide ID_UNIK

        // Kirim Buffer ke Main.js
        const buffer = await wb.xlsx.writeBuffer();
        self.postMessage({ status: 'success', buffer: buffer });

    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};