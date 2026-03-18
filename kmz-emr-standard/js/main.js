/*!
 * KMZ EMR Standard - Main Script
 * Copyright (c) 2026 Muhammad Ikhsanudin
 * * This file is part of KMZ EMR Standard.
 * This software is licensed under the PolyForm Strict License 1.0.0.
 * * STRICT PROHIBITION: You may use this software for your own purposes, 
 * but you MAY NOT modify, copy, or distribute this software or any 
 * modified version of it without prior written consent from the Copyright Holder.
 * * A copy of the license is located in the LICENSE file in the root directory, 
 * or can be found at: https://polyformproject.org/licenses/strict/1.0.0/
 */

/* IMPORT DARI FILE CONFIG DAN LOGIC */
import { STRUCTURE_CLUSTER, STRUCTURE_SUBFEEDER } from './config-utils.js';
/* IMPORT DARI FILE LOGIC-FEATURES */
import {
    restructureKML, restructureSubfeeder, processSmartRouting, generateAutoSlack, 
    organizeHpByBoundary, autoRepositionPoints, splitSlingWires, generateAutoSlackSubfeeder, 
    applyStyles, injectDescriptionsAndCalc, sortPlacemarksInsideFolders, generateSummaryTable,
    resetLogicState, globalErrorLog, autoCorrectHierarchy, testScrapeFatAddresses, cancelScrape 
} from './logic-features.js';

import { extractBOQData } from './generateBOQ.js';

// --- UPDATE IMPORT: Mengambil logic Excel dari file baru ---
import { 
    generateExcelHPDB, 
    resetHPDBState 
} from './generateHPDB.js';

let CURRENT_MODE = 'cluster';
let kmzFile = null;

// --- SETUP UI & EVENT LISTENERS ---
    const setupUI = () => {
    // Cari container utamanya yang tadi kita kasih ID
    const container = document.getElementById('checkboxContainer');
    if (!container) return; 

    // --- URUTAN 1: HP BOUNDARY (Tadi di-hardcode, sekarang di-inject) ---
    if (!document.getElementById('hpBoundaryWrapper')) {
        const divHpBoundary = document.createElement('div');
        divHpBoundary.id = 'hpBoundaryWrapper';
        divHpBoundary.className = 'checkbox-wrapper';
        divHpBoundary.title = "Uncheck/Matikan fitur ini jika KML lama menggunakan Polygon FAT yang belum diberi nama (Unnamed)";
        divHpBoundary.innerHTML = `<input type="checkbox" id="hpBoundaryCheck" checked><label for="hpBoundaryCheck">Assign HP by Boundary FAT</label>`;
        container.appendChild(divHpBoundary);
    }

    // --- URUTAN 2: AUTO SLACK 400M (KHUSUS SUBFEEDER) ---
    if (!document.getElementById('autoSlackWrapper')) {
        const divAutoSlack = document.createElement('div');
        divAutoSlack.id = 'autoSlackWrapper';
        divAutoSlack.className = 'checkbox-wrapper hidden'; // Default sembunyi
        divAutoSlack.innerHTML = `<input type="checkbox" id="toggleAutoSlack400mCheck"><label for="toggleAutoSlack400mCheck">Auto Slack Tiap 400m (Subfeeder)</label>`;
        container.appendChild(divAutoSlack);
    }

    // --- URUTAN 3: SMART ROUTING ---
    if (!document.getElementById('smartRouteCheck')) {
        const divSmart = document.createElement('div');
        divSmart.className = 'checkbox-wrapper';
        divSmart.innerHTML = `<input type="checkbox" id="smartRouteCheck"><label for="smartRouteCheck">Smart Cable Routing (Auto-Offset)</label>`;
        container.appendChild(divSmart);
    }

    // --- URUTAN 4: AUTO CORRECT FOLDERING ---
    if (!document.getElementById('toggleAutoCorrectCheck')) {
        const divAutoCorrect = document.createElement('div');
        divAutoCorrect.className = 'checkbox-wrapper';
        divAutoCorrect.innerHTML = `<input type="checkbox" id="toggleAutoCorrectCheck" checked><label for="toggleAutoCorrectCheck">Auto Correct Foldering (Pole/FAT)</label>`;
        container.appendChild(divAutoCorrect);
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupUI);
} else {
    setupUI();
}

/* ==========================================================================
   GLOBAL FUNCTIONS (WINDOW)
   ========================================================================== */

window.setMode = (mode) => {
    CURRENT_MODE = mode;
    
    // FIX-NYA DI SINI BRO: Kita kecualikan tombol yang ada di dalem Modal Template!
    document.querySelectorAll('.mode-option:not(#tpl-btn-cluster):not(#tpl-btn-subfeeder)').forEach(el => el.classList.remove('active'));
    
    const btn = document.getElementById(`btn-${mode}`);
    if (btn) btn.classList.add('active');

    // --- LOGIC ANIMASI HIDE/SHOW TOGGLE ---
    const hpBoundaryWrapper = document.getElementById('hpBoundaryWrapper');
    const autoSlackWrapper = document.getElementById('autoSlackWrapper');

    if (mode === 'cluster') {
        if (hpBoundaryWrapper) hpBoundaryWrapper.classList.remove('hidden'); 
        if (autoSlackWrapper) autoSlackWrapper.classList.add('hidden'); 
    } else {
        if (hpBoundaryWrapper) hpBoundaryWrapper.classList.add('hidden'); 
        if (autoSlackWrapper) autoSlackWrapper.classList.remove('hidden'); 
    }
};

window.setTplMode = (mode) => {
    document.getElementById('tplMode').value = mode;
    document.getElementById('tpl-btn-cluster').classList.remove('active');
    document.getElementById('tpl-btn-subfeeder').classList.remove('active');
    document.getElementById(`tpl-btn-${mode}`).classList.add('active');
    toggleTplInputs();
};

window.openTemplateModal = () => document.getElementById('templateModal').classList.add('open');

window.closeTemplateModal = () => {
    document.getElementById('templateModal').classList.remove('open');
};

// --- BURGER MENU LOGIC ---
const setupBurgerMenu = () => {
    const burgerBtn = document.getElementById('burgerBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');

    if (burgerBtn && dropdownMenu) {
        burgerBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            dropdownMenu.classList.toggle('hidden');
        });

        // Tutup otomatis kalau user klik di luar menu
        window.addEventListener('click', (e) => {
            if (!burgerBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.add('hidden');
            }
        });
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBurgerMenu);
} else {
    setupBurgerMenu();
}

// --- LISP MODAL LOGIC (Baru) ---
window.openLispModal = () => {
    document.getElementById('lispModal').classList.add('open');
    document.getElementById('dropdownMenu').classList.add('hidden'); // Tutup burger menu
};

window.closeLispModal = () => {
    document.getElementById('lispModal').classList.remove('open');
};

// --- LISP DOWNLOAD LOGIC (Sama kyk kemaren) ---
window.downloadLisp = async (fileName) => {
    const filePath = `assets/lisp/${fileName}`; 
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`File ${fileName} tidak ditemukan di server!`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download Error:', error);
        alert(`Gagal mendownload ${fileName}. Pastikan file ada di folder assets/lisp/`);
    }
};

// --- SYNCHRONIZE CLOSE MECHANISM (PENTING!) ---
// Taruh ini di paling bawah banget main.js lu berjejer kyk readme/template modal lu kemaren.
const lispOverlay = document.getElementById('lispModal');
if (lispOverlay) {
    lispOverlay.addEventListener('click', (e) => {
        // Kalau diklik are abu-abu nya (bukan modal box nya), tutup
        if (e.target === lispOverlay) {
            closeLispModal();
        }
    });
}

window.adjustValue = (elementId, delta) => {
    const input = document.getElementById(elementId);
    if (input) {
        let val = parseInt(input.value) || 0;
        val += delta;
        if (val < 1) val = 1;
        input.value = val;
        input.dispatchEvent(new Event('change'));
    }
};

window.downloadAsset = async (coreType) => {
    const fileName = `template_${coreType}.xlsx`;
    const filePath = `assets/${fileName}`;
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`File ${fileName} tidak ditemukan di server!`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `HPDB - TEMPLATE - ${coreType} CORE.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download Error:', error);
        alert('Gagal mendownload file template. Cek koneksi atau pastikan file assets sudah terupload.');
    }
};

window.toggleTplInputs = () => {
    const m = document.getElementById('tplMode').value;
    const group = document.getElementById('lineInputGroup');
    const modalBox = document.querySelector('.modal-box');
    if (!group || !modalBox) return;

    const startModalHeight = modalBox.offsetHeight;
    modalBox.style.height = `${startModalHeight}px`;

    const isCluster = (m === 'cluster');
    const wasClosed = group.classList.contains('closed');
    
    group.style.transition = 'none';
    if (isCluster) group.classList.remove('closed');
    else group.classList.add('closed');
    
    modalBox.style.height = 'auto';
    const targetModalHeight = modalBox.offsetHeight;

    modalBox.style.height = `${startModalHeight}px`;
    if (wasClosed) group.classList.add('closed');
    else group.classList.remove('closed');
    
    void group.offsetHeight; 
    group.style.transition = '';

    requestAnimationFrame(() => {
        modalBox.style.height = `${targetModalHeight}px`;
        if (isCluster) group.classList.remove('closed');
        else group.classList.add('closed');
    });

    setTimeout(() => { modalBox.style.height = 'auto'; }, 300);
};

window.switchTemplateTab = (tabName) => {
    const modalBox = document.querySelector('.modal-box');
    const startHeight = modalBox.offsetHeight;
    modalBox.style.height = `${startHeight}px`;

    document.querySelectorAll('.modal-tab').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-head-${tabName}`).classList.add('active');
    const newContent = document.getElementById(`tab-content-${tabName}`);
    newContent.classList.add('active');

    modalBox.style.height = 'auto';
    const targetHeight = modalBox.offsetHeight;
    modalBox.style.height = `${startHeight}px`;

    requestAnimationFrame(() => { modalBox.style.height = `${targetHeight}px`; });
    setTimeout(() => { modalBox.style.height = 'auto'; }, 300); 
};

// --- FUNGSI GENERATE TEMPLATE ---
window.generateTemplateAction = async () => {
    const mode = document.getElementById('tplMode').value;
    const fdtCount = parseInt(document.getElementById('tplFdtCount').value) || 1;
    const lineCount = parseInt(document.getElementById('tplLineCount').value) || 1;
    const zip = new JSZip();
    let kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>TEMPLATE_${mode.toUpperCase()}_${fdtCount}FDT</name>`;

    const makeFolder = (name, contents = '') => `<Folder><name>${name}</name>${contents}</Folder>`;
    let rootContent = '';

    if (mode === 'cluster') {
        rootContent += makeFolder('BOUNDARY CLUSTER') + makeFolder('FDT');
        for (let f = 1; f <= fdtCount; f++) {
            for (let l = 0; l < lineCount; l++) {
                const lineChar = String.fromCharCode(65 + l);
                let folderName = (fdtCount === 1) ? `LINE ${lineChar}` : `LINE ${lineChar} FDT ${f}`;
                let lineContent = makeFolder('BOUNDARY FAT');
                STRUCTURE_CLUSTER.forEach(item => {
                    if(!['BOUNDARY FAT', 'FDT'].includes(item)) lineContent += makeFolder(item);
                });
                rootContent += makeFolder(folderName, lineContent);
            }
        }
    } else {
        if (fdtCount === 1) {
            STRUCTURE_SUBFEEDER.forEach(item => { 
                rootContent += makeFolder(item); 
            });
        } else {
            for (let f = 1; f <= fdtCount; f++) {
                let fdtContent = '';
                STRUCTURE_SUBFEEDER.forEach(item => { 
                    fdtContent += makeFolder(item); 
                });
                rootContent += makeFolder(`FDT ${f}`, fdtContent);
            }
        }
    }

    kml += makeFolder((mode === 'subfeeder' ? 'SUBFEEDER ID' : 'CLUSTER ID'), rootContent) + `</Document></kml>`;
    zip.file("doc.kml", kml);
    const blob = await zip.generateAsync({type:"blob"});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `TEMPLATE_${mode.toUpperCase()}.kmz`;
    a.click();
    document.getElementById('templateModal').classList.remove('open');
};

window.openReadme = async function() {
    const modal = document.getElementById('readmeModal');
    const container = document.getElementById('mdContainer');
    modal.classList.add('open');
    try {
        const response = await fetch('README.md');
        if (!response.ok) throw new Error();
        container.innerHTML = marked.parse(await response.text());
    } catch (error) {
        container.innerHTML = 'README.md not found.';
    }
};

// --- FILE INPUT HANDLER ---
const kmzInput = document.getElementById('kmzFile');
const processBtn = document.getElementById('processBtn');
const fileLabel = document.getElementById('fileLabel');

if (kmzInput) {
    kmzInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            kmzFile = e.target.files[0];
            fileLabel.textContent = kmzFile.name;
            fileLabel.style.color = 'var(--primary)';
            processBtn.disabled = false;
        }
    });

    const dropZone = kmzInput.parentElement;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('highlight'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('highlight'), false);
    });
    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            kmzFile = files[0];
            kmzInput.files = files;
            fileLabel.textContent = kmzFile.name;
            fileLabel.style.color = 'var(--primary)';
            processBtn.disabled = false;
        }
    });
}

const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        // --- BAGIAN INI DIHAPUS BIAR FILE TETEP ADA ---
        // kmzFile = null;
        // document.getElementById('kmzFile').value = '';
        // fileLabel.textContent = 'Drag & drop KMZ/KML here';
        // fileLabel.style.color = 'var(--text-muted)';
        
        // --- TETAP RESET HASIL PREVIEW & DOWNLOAD AREA ---
        document.getElementById('summaryContent').innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg><span>No data processed yet. Upload a file to see details.</span></div>';
        document.getElementById('status').innerHTML = '';
        document.getElementById('downloadArea').innerHTML = '';
        
        // --- RESET STATE & BATALIN SCRAPE ---
        cancelScrape();
        resetLogicState();
        resetHPDBState(); 
        
        // --- UPDATE PENTING: TOMBOL PROCESS DIBIKIN NYALA LAGI ---
        if (kmzFile) {
            processBtn.disabled = false; 
        }
    });
}

// --- MAIN PROCESS BUTTON ---
processBtn.addEventListener('click', async () => {
    if (!kmzFile) return;
    processBtn.disabled = true;
    const statusEl = document.getElementById('status');
    const dlArea = document.getElementById('downloadArea');
    statusEl.innerHTML = '<span class="loading-spinner"></span> Processing...';
    dlArea.innerHTML = '';
    
    // --- UPDATE: Reset kedua state ---
    resetLogicState();
    resetHPDBState();

    try {
        let xmlDoc;
        if (kmzFile.name.endsWith('.kmz')) {
            const zip = new JSZip();
            const contents = await zip.loadAsync(kmzFile);
            const kmlKey = Object.keys(contents.files).find(n => n.endsWith('.kml'));
            const kmlString = await contents.files[kmlKey].async('string');
            xmlDoc = new DOMParser().parseFromString(kmlString, 'text/xml');
        } else {
            xmlDoc = new DOMParser().parseFromString(await kmzFile.text(), 'text/xml');
        }

        const doCalc = document.getElementById('calcCableCheck').checked;
        const doSmartRoute = document.getElementById('smartRouteCheck')?.checked || false;
        const usePolygonMaster = document.getElementById('hpBoundaryCheck')?.checked ?? true;
        const enableAutoCorrectFolder = document.getElementById('toggleAutoCorrectCheck').checked;
        // Tangkep value checkbox baru
        const enableAutoSlack400m = document.getElementById('toggleAutoSlack400mCheck')?.checked || false;

        let rootName = 'PROCESSED';
        if (CURRENT_MODE === 'subfeeder') {
            restructureSubfeeder(xmlDoc); 
            autoRepositionPoints(xmlDoc, CURRENT_MODE);
            if (doSmartRoute) {
                processSmartRouting(xmlDoc, CURRENT_MODE);
            }
            // Passing value-nya ke sini
            generateAutoSlackSubfeeder(xmlDoc, enableAutoSlack400m);
            applyStyles(xmlDoc, 'subfeeder');
            injectDescriptionsAndCalc(xmlDoc, 'subfeeder', doCalc);
} else {
            // CLUSTER LOGIC
            const res = restructureKML(xmlDoc);
            rootName = res.rootName;
            if (doSmartRoute) { processSmartRouting(xmlDoc, CURRENT_MODE); }
            autoRepositionPoints(xmlDoc, CURRENT_MODE); 
            splitSlingWires(xmlDoc);
            autoCorrectHierarchy(xmlDoc, CURRENT_MODE, enableAutoCorrectFolder); 
            generateAutoSlack(xmlDoc);
            applyStyles(xmlDoc, 'cluster');
            injectDescriptionsAndCalc(xmlDoc, 'cluster', doCalc);
            organizeHpByBoundary(xmlDoc, usePolygonMaster);
            sortPlacemarksInsideFolders(xmlDoc, CURRENT_MODE);
            
            // KODE LAMA "generateExcelHPDB(xmlDoc, rootName);" UDAH GW HAPUS DARI SINI BIAR GA JALAN SENDIRI
        }

        generateSummaryTable(xmlDoc);

        const zipOut = new JSZip();
        zipOut.file("doc.kml", new XMLSerializer().serializeToString(xmlDoc));
        const blob = await zipOut.generateAsync({type:'blob'});

        const dlBtn = document.createElement('button');
        dlBtn.className = 'primary';
        dlBtn.style.marginTop = '10px';
        dlBtn.textContent = 'Download Result KMZ';
        dlBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `PROCESSED_${kmzFile.name.replace('.kml', '.kmz')}`;
            a.click();
        };
        dlArea.appendChild(dlBtn);

        // --- 1. UI HPDB & SCRAPE BUTTON (HANYA UNTUK CLUSTER) ---
        let hpdbWrapper = null;
        let xlsBtn = null;    
        let scrapeBtn = null; 

        if (CURRENT_MODE === 'cluster') {
            hpdbWrapper = document.createElement('div');
            hpdbWrapper.className = 'hpdb-action-wrapper';

            xlsBtn = document.createElement('button');
            xlsBtn.className = 'btn-purple';
            xlsBtn.style.flex = '1';
            xlsBtn.style.margin = '0';
            xlsBtn.innerHTML = `<span>Download HPDB (Excel)</span>`;
            
            scrapeBtn = document.createElement('button');
            scrapeBtn.className = 'btn-icon-only';
            scrapeBtn.title = "Scrape Full Address dari Google Maps";
            scrapeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;

            hpdbWrapper.appendChild(xlsBtn);
            hpdbWrapper.appendChild(scrapeBtn);
            dlArea.appendChild(hpdbWrapper);

            const progressWrapper = document.createElement('div');
            progressWrapper.className = 'progress-wrapper';
            progressWrapper.innerHTML = `
                <div class="progress-text">
                    <span id="progLabel">Mempersiapkan...</span>
                    <span id="progCount" style="color:var(--primary)">0/0</span>
                </div>
                <div class="progress-bar-bg"><div class="progress-bar-fill" id="progFill"></div></div>
                <button class="btn-cancel-mini" id="progCancel">Cancel Scraping</button>
            `;
            dlArea.appendChild(progressWrapper);

            // LOGIC DOWNLOAD DEFAULT (HARDCODE BANDUNG)
            xlsBtn.onclick = async () => {
                xlsBtn.innerHTML = `<span class="loading-spinner"></span>`;
                xlsBtn.disabled = true; scrapeBtn.disabled = true;
                try {
                    // AMBIL NAMA ROOT DINAMIS
                    const docFolder = xmlDoc.querySelector('Document > Folder');
                    const actualRootName = docFolder ? (docFolder.querySelector('name')?.textContent || rootName) : rootName;
                    
                    const excelBlob = await generateExcelHPDB(xmlDoc, actualRootName, null);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(excelBlob);
                    a.download = `HPDB_${kmzFile.name.replace(/\.k?mz|\.kml/i, '')}.xlsx`;
                    a.click();
                } catch (e) { 
                    alert("Error: " + e.message); // UPDATE BIAR KETAHUAN ERRORNYA APA
                    console.error("HPDB Default Error:", e);
                }
                xlsBtn.innerHTML = `<span>Download HPDB (Excel)</span>`;
                xlsBtn.disabled = false; scrapeBtn.disabled = false;
            };

            // LOGIC DOWNLOAD + SCRAPE (TOMBOL PETIR)
            scrapeBtn.onclick = async () => {
                hpdbWrapper.style.display = 'none';
                progressWrapper.style.display = 'flex';
                
                const progLabel = document.getElementById('progLabel');
                const progCount = document.getElementById('progCount');
                const progFill = document.getElementById('progFill');
                const btnCancel = document.getElementById('progCancel');

                const updateUI = (curr, tot, fatName) => {
                    progLabel.textContent = `Scraping: ${fatName}`;
                    progCount.textContent = `${curr}/${tot}`;
                    progFill.style.width = `${(curr / tot) * 100}%`;
                };

                btnCancel.onclick = () => {
                    cancelScrape(); 
                    btnCancel.textContent = "Canceling...";
                    btnCancel.disabled = true;
                };

                const scrapedData = await testScrapeFatAddresses(xmlDoc, updateUI);

                if (scrapedData) {
                    progLabel.textContent = "Generating Excel...";
                    progFill.style.background = "#4ade80"; 
                    try {
                        const docFolder = xmlDoc.querySelector('Document > Folder');
                        const actualRootName = docFolder ? (docFolder.querySelector('name')?.textContent || rootName) : rootName;
                        
                        const excelBlob = await generateExcelHPDB(xmlDoc, actualRootName, scrapedData);
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(excelBlob);
                        a.download = `HPDB_${kmzFile.name.replace(/\.k?mz|\.kml/i, '')}_Scraped.xlsx`;
                        a.click();
                    } catch (e) { 
                        alert("Error: " + e.message); 
                        console.error("HPDB Scrape Error:", e);
                    }
                }

                progressWrapper.style.display = 'none';
                hpdbWrapper.style.display = 'flex';
                progFill.style.width = '0%';
                progFill.style.background = "var(--primary)";
                btnCancel.textContent = "Cancel Scraping";
                btnCancel.disabled = false;
            };
        }

        // --- 2. TOMBOL BOQ (UNTUK CLUSTER & SUBFEEDER) ---
        const boqBtn = document.createElement('button');
        boqBtn.className = 'btn-purple';
        boqBtn.style.marginTop = '8px';
        boqBtn.style.backgroundColor = '#d97706'; 
        boqBtn.style.borderColor = 'rgba(255,255,255,0.1)';
        boqBtn.innerHTML = `<span class="loading-spinner" style="margin-right:8px;"></span> Generating Auto BOQ...`;
        boqBtn.disabled = true;
        dlArea.appendChild(boqBtn);

        try {
            const docFolder = xmlDoc.querySelector('Document > Folder');
            const actualRootName = docFolder ? (docFolder.querySelector('name')?.textContent || rootName) : rootName;

            const boqData = extractBOQData(xmlDoc, actualRootName, CURRENT_MODE);
            const tplPath = CURRENT_MODE === 'subfeeder' ? 'assets/template_sfBOQ.xlsx' : 'assets/template_clrBOQ.xlsx';
            const tplRes = await fetch(tplPath);
            
            if (!tplRes.ok) throw new Error(`Template BOQ tidak ditemukan di ${tplPath}`);
            const tplBuffer = await tplRes.arrayBuffer();

            const boqWorker = new Worker('js/boq.worker.js');
            boqWorker.postMessage({ boqData, templateBuffer: tplBuffer, mode: CURRENT_MODE }, [tplBuffer]);

            boqWorker.onmessage = (e) => {
                if (e.data.status === 'success') {
                    const blob = new Blob([e.data.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    boqBtn.innerHTML = `<span>Download Auto BOQ (Excel)</span>`;
                    boqBtn.disabled = false;
                    boqBtn.onclick = () => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        const prefix = CURRENT_MODE === 'subfeeder' ? 'BOQ_SF_' : 'BOQ_CLR_';
                        a.download = `${prefix}${kmzFile.name.replace(/\.k?mz|\.kml/i, '')}.xlsx`;
                        a.click();
                    };
                } else {
                    boqBtn.innerHTML = `<span>❌ Gagal Generate BOQ</span>`;
                    console.error("BOQ Worker Error:", e.data.error);
                    statusEl.innerHTML = `<span style="color:#ef4444; font-weight:bold;">❌ Gagal Generate BOQ: Cek Console</span>`;
                }
                boqWorker.terminate(); 
            };

            boqWorker.onerror = (err) => {
                 boqBtn.innerHTML = `<span>❌ Worker Error BOQ</span>`;
                 console.error(err);
                 boqWorker.terminate();
            }

        } catch (err) {
            boqBtn.innerHTML = `<span>❌ BOQ Batal</span>`;
            statusEl.innerHTML = `<span style="color:#ef4444; font-weight:bold;">${err.message}</span>`;
            console.error("Kesalahan Proses:", err);
        }
        
        if (!statusEl.innerHTML.includes("❌")) {
            statusEl.innerHTML = '✅ Done!';
        }
 
    } catch (err) {
        statusEl.innerHTML = `<span style="color:red">Error: ${err.message}</span>`;
        console.error(err);
    } finally {
        processBtn.disabled = false;
    }});

const resizer = document.getElementById('dragMe');
const leftPanel = document.getElementById('panelLeft');
if (resizer && leftPanel) {
    resizer.addEventListener('mousedown', (e) => {
        const x = e.clientX;
        const w = parseInt(window.getComputedStyle(leftPanel).width, 10);
        const onMouseMove = (e) => { leftPanel.style.width = `${w + (e.clientX - x)}px`; };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            resizer.classList.remove('resizing');
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp, {once: true});
        resizer.classList.add('resizing');
    });
}