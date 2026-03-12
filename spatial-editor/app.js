// --- STATE MANAGEMENT ---
let xmlDoc = null;
let originalFileName = "";
let allItems = []; // { id, name, type, node, folder, lat, lon }
let map = null;
let mapLayerGroup = null;
let mapOrderLines = null;
let sortableList = null;

let lightLayer;

// --- INIT LEAFLET MAP ---
document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map').setView([-7.250445, 112.768845], 11); // Surabaya default

    // Set layer map ke OpenStreetMap (Light)
    lightLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' });

    // Set default ke light
    lightLayer.addTo(map);

    mapLayerGroup = L.layerGroup().addTo(map);
    mapOrderLines = L.polyline([], {color: '#f85149', dashArray: '5, 5', weight: 2}).addTo(map);
    
    initSortable();
    addRuleRow(); // Add empty rule row on start
});

// --- FILE UPLOAD LOGIC ---
document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('fileInput').click());

document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    originalFileName = file.name;
    document.getElementById('fileName').textContent = originalFileName;
    
    try {
        let kmlString = "";
        if (file.name.endsWith('.kmz')) {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const kmlKey = Object.keys(contents.files).find(n => n.endsWith('.kml'));
            kmlString = await contents.files[kmlKey].async('string');
        } else {
            kmlString = await file.text();
        }
        
        xmlDoc = new DOMParser().parseFromString(kmlString, 'text/xml');
        parseKML();
    } catch (err) {
        alert("Error parsing file: " + err.message);
    }
});

// --- PARSE KML ---
function parseKML() {
    allItems = [];
    const placemarks = xmlDoc.querySelectorAll('Placemark');
    const folderSet = new Set();
    
    placemarks.forEach((pm, index) => {
        const nameNode = pm.querySelector('name');
        const name = nameNode ? nameNode.textContent : `Unnamed_${index}`;
        
        // LOGIC BARU: Bikin Path Hierarchy (LINE A ⟩ FAT)
        let pathList = [];
        let curr = pm.parentElement;
        while(curr && curr.tagName !== 'Document') {
            if (curr.tagName === 'Folder') {
                const fn = curr.querySelector('name');
                if(fn) pathList.unshift(fn.textContent.trim());
            }
            curr = curr.parentElement;
        }
        
        // Gabungin pake tanda panah
        let parentFolder = pathList.length > 0 ? pathList.join(' ⟩ ') : "Root";
        
        folderSet.add(parentFolder);
        
        let lat = null, lon = null;
        const pt = pm.querySelector('Point coordinates');
        const ls = pm.querySelector('LineString coordinates');
        const poly = pm.querySelector('Polygon coordinates');
        let type = 'Unknown';
        
        let coordsText = pt ? pt.textContent : (ls ? ls.textContent : (poly ? poly.textContent : null));
        if (coordsText) {
            const firstCoord = coordsText.trim().split(/\s+/)[0];
            [lon, lat] = firstCoord.split(',').map(Number);
            if(pt) type = 'Point';
            else if(ls) type = 'Line';
            else if(poly) type = 'Polygon';
        }
        
        allItems.push({ id: `item_${index}`, name, type, node: pm, folder: parentFolder, lat, lon, newName: null });
    });
    
    renderFolderCheckboxes(Array.from(folderSet));
    document.getElementById('processBtn').disabled = false;
}

// --- FOLDER & ITEM SELECTION ---
function renderFolderCheckboxes(folders) {
    const container = document.getElementById('folderList');
    container.innerHTML = '';
    
    // Grouping logic
    const groups = {};
    folders.sort().forEach(f => {
        const parts = f.split(' ⟩ ');
        const childName = parts.pop(); 
        const parentPath = parts.length > 0 ? parts.join(' ⟩ ') : 'Root';
        
        if (!groups[parentPath]) groups[parentPath] = [];
        groups[parentPath].push({ fullPath: f, childName: childName });
    });

    // Render per group
    Object.keys(groups).sort().forEach(parent => {
        const isRoot = parent === 'Root';
        // Deteksi apakah nama folder parent mengandung 'HP COVER'
        const isHpCover = parent.includes('HP COVER'); 

        let header;
        const childContainer = document.createElement('div');
        childContainer.className = isRoot ? '' : 'folder-group-children';

        if (!isRoot) {
            header = document.createElement('div');
            header.className = 'folder-group-header';
            
            // Set ikon panah awal
            const arrow = isHpCover ? '▶' : '▼';
            header.innerHTML = `<span class="toggle-icon">${arrow}</span> 📂 ${parent}`;
            container.appendChild(header);

            // Sembunyikan isi folder secara default jika itu HP COVER
            if (isHpCover) {
                childContainer.style.display = 'none';
            }

            // Tambahkan event click untuk buka/tutup folder
            header.addEventListener('click', () => {
                const isHidden = childContainer.style.display === 'none';
                childContainer.style.display = isHidden ? 'flex' : 'none';
                header.querySelector('.toggle-icon').textContent = isHidden ? '▼' : '▶';
            });
        }

        groups[parent].forEach(item => {
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" value="${item.fullPath}" class="folder-check"> <span class="folder-name">${item.childName}</span>`;
            childContainer.appendChild(label);
        });
        
        container.appendChild(childContainer);
    });
    
    // --- LOGIC SHIFT-CLICK MULTI-SELECT (BULLETPROOF) ---
    let lastCheckedIndex = null;
    const labels = Array.from(document.querySelectorAll('.folder-group-children label'));

    labels.forEach((label, index) => {
        label.addEventListener('mousedown', e => { 
            if (e.shiftKey) e.preventDefault(); 
        });

        label.addEventListener('click', function(e) {
            e.preventDefault(); 

            const chk = this.querySelector('.folder-check');
            chk.checked = !chk.checked; 
            const isChecked = chk.checked;

            if (e.shiftKey && lastCheckedIndex !== null) {
                const start = Math.min(lastCheckedIndex, index);
                const end = Math.max(lastCheckedIndex, index);
                
                for (let i = start; i <= end; i++) {
                    labels[i].querySelector('.folder-check').checked = isChecked;
                }
            }
            
            lastCheckedIndex = index; 
            updateSelectedItems(); 
        });
    });
}

// --- UPDATE: Fungsi filter item & Map (Ditambah logic Show/Hide tombol) ---
function updateSelectedItems() {
    const checkboxes = document.querySelectorAll('.folder-check');
    const checkedFolders = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    
    // Munculin tombol Unselect All cuma kalo ada yang dicentang
    const unselectBtn = document.getElementById('btnUnselectAll');
    if (unselectBtn) {
        if (checkedFolders.length > 0) {
            unselectBtn.classList.remove('hidden');
        } else {
            unselectBtn.classList.add('hidden');
        }
    }
    
    const selected = allItems.filter(item => checkedFolders.includes(item.folder));
    renderItemList(selected);
    updateMap(selected);
}

// --- UPDATE: Logic tombol Unselect All di header ---
const btnUnselect = document.getElementById('btnUnselectAll');
if (btnUnselect) {
    btnUnselect.addEventListener('click', (e) => {
        e.stopPropagation(); 
        e.preventDefault();
        
        const checkboxes = document.querySelectorAll('.folder-check');
        checkboxes.forEach(chk => chk.checked = false);
        updateSelectedItems(); 
    });
}

// --- RENDER SORTABLE LIST ---
function renderItemList(items) {
    const container = document.getElementById('itemList');
    container.innerHTML = '';
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.setAttribute('data-id', item.id);
        
        div.innerHTML = `
            <span class="old-name">::: [${item.type}] ${item.name}</span>
            <span class="preview-name" id="prev_${item.id}"></span>
        `;
        container.appendChild(div);
    });
    
    document.getElementById('selectedCount').textContent = items.length;
}

function initSortable() {
    const el = document.getElementById('itemList');
    sortableList = Sortable.create(el, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        
        // --- LOGIC MULTI-DRAG ---
        multiDrag: true,             // Aktifin fitur seret banyak item
        selectedClass: 'selected',   // Panggil CSS .selected yang baru kita bikin
        fallbackTolerance: 3,        // Biar klik biasa nggak gak sengaja ke-drag
        
        onEnd: () => { 
            updateMapOrderFromList(); 
        }
    });
}

// --- UPDATE MAP ---
function updateMap(items) {
    mapLayerGroup.clearLayers();
    const bounds = [];
    
    items.forEach(item => {
        if (item.lat && item.lon) {
            const marker = L.circleMarker([item.lat, item.lon], {
                radius: 4, color: item.type === 'Point' ? '#58a6ff' : '#f85149', fillOpacity: 0.8
            });
            marker.bindTooltip(item.name);
            mapLayerGroup.addLayer(marker);
            bounds.push([item.lat, item.lon]);
        }
    });
    
    if (bounds.length > 0) map.fitBounds(bounds, {padding: [20,20]});
    updateMapOrderFromList();
}

function updateMapOrderFromList() {
    const domItems = document.querySelectorAll('.list-item');
    const lineCoords = [];
    
    domItems.forEach(dom => {
        const id = dom.getAttribute('data-id');
        const item = allItems.find(i => i.id === id);
        if(item && item.lat && item.lon) {
            lineCoords.push([item.lat, item.lon]);
        }
    });
    
    mapOrderLines.setLatLngs(lineCoords);
}

// --- AUTO SORTING BUTTONS ---
document.getElementById('btnSortAlpha').addEventListener('click', () => {
    const container = document.getElementById('itemList');
    const divs = Array.from(container.children);
    divs.sort((a,b) => a.querySelector('.old-name').textContent.localeCompare(b.querySelector('.old-name').textContent));
    divs.forEach(d => container.appendChild(d));
    updateMapOrderFromList();
});

document.getElementById('btnSortSpatial').addEventListener('click', () => {
    const container = document.getElementById('itemList');
    const divs = Array.from(container.children);
    divs.sort((a,b) => {
        const itemA = allItems.find(i => i.id === a.getAttribute('data-id'));
        const itemB = allItems.find(i => i.id === b.getAttribute('data-id'));
        return (itemB.lat || 0) - (itemA.lat || 0); 
    });
    divs.forEach(d => container.appendChild(d));
    updateMapOrderFromList();
});

// --- RULES DYNAMIC UI ---
function addRuleRow() {
    const container = document.getElementById('rulesContainer');
    const row = document.createElement('div');
    row.className = 'rule-row';
    
    row.innerHTML = `
        <input type="text" class="input-dark r-prefix" placeholder="FDT-">
        <input type="number" class="input-number-clean r-start" placeholder="Start" value="1" min="0">
        <input type="number" class="input-number-clean r-count" placeholder="Count" value="10" min="1">
        <input type="text" class="input-dark r-suffix" placeholder="-NEW">
        <button class="btn-danger remove-rule" title="Remove Rule">×</button>
    `;
    container.appendChild(row);
    
    row.querySelector('.remove-rule').addEventListener('click', () => row.remove());
}

document.getElementById('addRuleBtn').addEventListener('click', addRuleRow);

// --- PREVIEW LOGIC ---
document.getElementById('previewBtn').addEventListener('click', () => {
    const rows = document.querySelectorAll('.rule-row');
    const padding = parseInt(document.querySelector('input[name="padding"]:checked').value);
    
    const rules = [];
    rows.forEach(row => {
        rules.push({
            prefix: row.querySelector('.r-prefix').value || '',
            start: parseInt(row.querySelector('.r-start').value) || 1,
            count: parseInt(row.querySelector('.r-count').value) || 0,
            suffix: row.querySelector('.r-suffix').value || ''
        });
    });
    
    const domItems = document.querySelectorAll('.list-item');
    document.querySelectorAll('.preview-name').forEach(el => el.textContent = '');
    
    let domIndex = 0;
    
    rules.forEach(rule => {
        for(let i=0; i<rule.count; i++) {
            if(domIndex >= domItems.length) break; 
            
            const num = String(rule.start + i).padStart(padding, '0');
            const newName = `${rule.prefix}${num}${rule.suffix}`;
            
            const previewSpan = domItems[domIndex].querySelector('.preview-name');
            previewSpan.textContent = `➔ ${newName}`;
            
            domItems[domIndex].setAttribute('data-newname', newName);
            domIndex++;
        }
    });
});

// --- PROCESS & DOWNLOAD ---
document.getElementById('processBtn').addEventListener('click', async () => {
    const domItems = document.querySelectorAll('.list-item');
    const delDesc = document.getElementById('delDescCheck').checked;
    
    let renameCount = 0;
    
    domItems.forEach(dom => {
        const id = dom.getAttribute('data-id');
        const newName = dom.getAttribute('data-newname');
        
        const item = allItems.find(i => i.id === id);
        if (item) {
            if (newName) {
                let nameNode = item.node.querySelector('name');
                if (!nameNode) {
                    nameNode = xmlDoc.createElement('name');
                    item.node.appendChild(nameNode);
                }
                nameNode.textContent = newName;
                renameCount++;
            }
            if (delDesc) {
                const descNode = item.node.querySelector('description');
                if (descNode) descNode.remove();
            }
        }
    });
    
    if (renameCount === 0 && !delDesc) {
        alert("Tidak ada item yang di-rename. Cek preview dulu brok!");
        return;
    }

    const zipOut = new JSZip();
    zipOut.file("doc.kml", new XMLSerializer().serializeToString(xmlDoc));
    const blob = await zipOut.generateAsync({type:'blob'});
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `RENAMED_${originalFileName.replace('.kml', '.kmz')}`;
    a.click();
});