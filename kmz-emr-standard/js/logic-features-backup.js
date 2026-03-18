/*!
 * KMZ EMR Standard - Logic and Features
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
import {
    TEXT_SIZE, SNAP_TOLERANCE_METERS, CABLE_DETECT_TOLERANCE,
    SMART_ROUTE_SNAP_RADIUS, SMART_ROUTE_FDT_RADIUS, OFFSET_DISTANCE,
    STRUCTURE_CLUSTER, STRUCTURE_SUBFEEDER, RULES_CLUSTER, RULES_SUBFEEDER,
    toRad, toDeg, vincentyDist, haversine, isPointInPolygon, distToSegment,
    getProjectedPoint, getBearing, getDestinationPoint, calculateLineLength,
    createName, createFolder, sortFolderChildren, linesIntersect
} from './config-utils.js';

/* ================= STATE MANAGEMENT ================= */
export let globalErrorLog = [];
// NOTE: processedHPDB sudah dipindah ke generateHPDB.js

export function resetLogicState() {
    globalErrorLog = [];
    // State HPDB di-reset via main.js memanggil resetHPDBState()
}

/* ================= LOGIC: CLUSTER (Fungsi Lama) ================= */
export function restructureKML(xmlDoc) {
    const kmlDoc = xmlDoc.querySelector('Document');
    const allFolders = Array.from(xmlDoc.querySelectorAll('Folder'));
    const boundaryOriginal = allFolders.find(f =>
        f.querySelector('name')?.textContent?.toUpperCase().includes('BOUNDARY CLUSTER')
    );

    let detectedRootName = 'CLUSTER ID';
    let detectedRootDesc = '';

    if (boundaryOriginal) {
        let parentCandidate = boundaryOriginal.parentElement;
        let attempts = 0;
        while (parentCandidate && parentCandidate.tagName === 'Folder' && attempts < 2) {
            const nameCheck = parentCandidate.querySelector('name')?.textContent || '';
            const descCheck = parentCandidate.querySelector('description')?.textContent || '';

            if (descCheck.trim().length > 0) {
                detectedRootName = nameCheck;
                detectedRootDesc = descCheck;
                break;
            }
            if (nameCheck.length > 3) {
                detectedRootName = nameCheck;
            }
            if (!descCheck) {
                parentCandidate = parentCandidate.parentElement;
                attempts++;
            } else {
                break;
            }
        }
    } else {
        for (let i = 0; i < kmlDoc.children.length; i++) {
            if (kmlDoc.children[i].tagName === 'Folder') {
                const f = kmlDoc.children[i];
                detectedRootName = f.querySelector('name')?.textContent || 'CLUSTER ID';
                detectedRootDesc = f.querySelector('description')?.textContent || '';
                break;
            }
        }
    }

    let boundaryClusterNode = null;
    if (boundaryOriginal) boundaryClusterNode = boundaryOriginal.cloneNode(true);

    const allPlacemarks = Array.from(xmlDoc.querySelectorAll('Placemark')).filter(pm => {
        if (boundaryOriginal && boundaryOriginal.contains(pm)) return false;
        return true;
    });

    const fdtBucket = [];
    const lineBuckets = {};
    const othersBucket = [];

    const addToLineBucket = (lineName, folderName, item, subFolderName = 'MAIN') => {
        if (!lineBuckets[lineName]) lineBuckets[lineName] = {};
        if (!lineBuckets[lineName][folderName]) lineBuckets[lineName][folderName] = {};
        if (!lineBuckets[lineName][folderName][subFolderName]) lineBuckets[lineName][folderName][subFolderName] = [];
        lineBuckets[lineName][folderName][subFolderName].push(item);
    };

    const strictCableRegex = /\b\d{2,3}C\/\d{1,2}T\b/i;

    allPlacemarks.forEach(pm => {
        const internalStyle = pm.querySelector('Style');
        if(internalStyle) internalStyle.remove();

        const name = (pm.querySelector('name')?.textContent || '').toUpperCase();
        let desc = (pm.querySelector('description')?.textContent || '').toUpperCase();
        const parentFolder = pm.parentElement;
        const parentName = (parentFolder.querySelector('name')?.textContent || '').toUpperCase().trim();
        const grandParentName = (parentFolder.parentElement?.querySelector('name')?.textContent || '').toUpperCase().trim();
        const fullText = name + ' ' + desc;
        const isLine = pm.querySelector('LineString') !== null;

        let lineName = 'MAIN';
        let curr = pm.parentElement;
        let foundLine = null;

        while (curr && curr.tagName === 'Folder') {
            const n = curr.querySelector('name')?.textContent.trim() || '';
            if (n === detectedRootName) {
            } else if (STRUCTURE_CLUSTER.includes(n) || n === 'FDT' || n === 'BOUNDARY CLUSTER' || n === 'OTHERS') {
            } else if (n !== '') {
                foundLine = n;
            }
            curr = curr.parentElement;
        }
        lineName = foundLine || 'MAIN';

        let targetType = 'UNKNOWN';
        let subFolderName = 'MAIN'; // Tambahan buat nangkep nama subfolder FAT

        if (parentName.includes('HP COVER')) { targetType = 'HP COVER'; }
        else if (parentName.includes('HP UNCOVER')) { targetType = 'HP UNCOVER'; }
        else if (grandParentName.includes('HP COVER')) { 
            targetType = 'HP COVER'; 
            subFolderName = parentName; // Tangkep nama subfolder aslinya!
        }
        else if (grandParentName.includes('HP UNCOVER')) { 
            targetType = 'HP UNCOVER'; 
            subFolderName = parentName; 
        }

        if (targetType === 'UNKNOWN') {
            if (!isLine && (name.includes('FDT') || parentName.includes('FDT'))) targetType = 'FDT_GLOBAL';
            else if (isLine && (strictCableRegex.test(fullText) || name.includes('CABLE') || parentName.includes('DISTRIBUTION'))) targetType = 'DISTRIBUTION CABLE';
            else {
                const match = STRUCTURE_CLUSTER.find(type => name.includes(type) || parentName.includes(type));
                if (match) targetType = match;
            }
        }

        if (targetType === 'UNKNOWN') {
            if (name.includes('SLING')) targetType = 'SLING WIRE';
            else if (name.includes('SLACK') || parentName.includes('SLACK')) targetType = 'SLACK HANGER';
            else {
                const match = STRUCTURE_CLUSTER.find(type => name.includes(type) || parentName.includes(type));
                if(match) targetType = match;
            }
        }

        const PRESERVE_DESC = ['BOUNDARY FAT', 'DISTRIBUTION CABLE', 'FDT', 'CABLE', 'FDT_GLOBAL'];
        if (!PRESERVE_DESC.includes(targetType)) {
            const descTag = pm.querySelector('description');
            if (descTag) descTag.remove();
        }

        pm.remove();
        if (targetType === 'FDT_GLOBAL') fdtBucket.push(pm);
        else if (targetType !== 'UNKNOWN') addToLineBucket(lineName, targetType, pm, subFolderName); // Kirim subFolderName ke keranjang
        else othersBucket.push(pm);
    });

    while (kmlDoc.firstChild) kmlDoc.removeChild(kmlDoc.firstChild);

    const root = xmlDoc.createElement('Folder');
    root.appendChild(createName(xmlDoc, detectedRootName));

    if (detectedRootDesc) {
        const d = xmlDoc.createElement('description');
        if (detectedRootDesc.match(/[<>]/)) {
            try {
                const cdata = xmlDoc.createCDATASection(detectedRootDesc);
                d.appendChild(cdata);
            } catch(e) { d.textContent = detectedRootDesc; }
        } else {
            d.textContent = detectedRootDesc;
        }
        root.appendChild(d);

        const s = xmlDoc.createElement('Snippet');
        s.textContent = detectedRootDesc.replace(/<[^>]*>?/gm, '').substring(0, 50) + '...';
        root.appendChild(s);
    }

    if (boundaryClusterNode) root.appendChild(boundaryClusterNode);
    if (fdtBucket.length > 0) root.appendChild(createFolder(xmlDoc, 'FDT', fdtBucket));

    const sortedLineKeys = Object.keys(lineBuckets).sort((a, b) => {
         const getInfo = (str) => {
             const fdtMatch = str.match(/FDT\s*(\d+)/i);
             const lineMatch = str.match(/LINE\s*([A-Z])/i);
             return {
                 fdt: fdtMatch ? parseInt(fdtMatch[1]) : 999,
                 line: lineMatch ? lineMatch[1] : str
             };
         };
         const infoA = getInfo(a);
         const infoB = getInfo(b);
         if (infoA.fdt !== infoB.fdt) return infoA.fdt - infoB.fdt;
         return infoA.line.localeCompare(infoB.line);
    });

    sortedLineKeys.forEach(ln => {
        let targetContainer = root;
        if (ln !== 'MAIN') {
            const lnFolder = xmlDoc.createElement('Folder');
            lnFolder.appendChild(createName(xmlDoc, ln));
            root.appendChild(lnFolder);
            targetContainer = lnFolder;
        }
        STRUCTURE_CLUSTER.forEach(folderName => {
            const subData = lineBuckets[ln][folderName];
            if (folderName === 'SLACK HANGER') return;

            if (subData) {
                const folder = xmlDoc.createElement('Folder');
                folder.appendChild(createName(xmlDoc, folderName));
                
                // LOOP untuk masukin MAIN dan SUBFOLDER (FAT)
                Object.keys(subData).forEach(subKey => {
                    if (subKey === 'MAIN') {
                        subData[subKey].forEach(i => folder.appendChild(i));
                    } else {
                        const subFolder = xmlDoc.createElement('Folder');
                        subFolder.appendChild(createName(xmlDoc, subKey));
                        subData[subKey].forEach(i => subFolder.appendChild(i));
                        folder.appendChild(subFolder);
                    }
                });
                
                targetContainer.appendChild(folder);
            } else { targetContainer.appendChild(createFolder(xmlDoc, folderName, [])); }
        });
        sortFolderChildren(targetContainer, STRUCTURE_CLUSTER);
    });

    if (othersBucket.length > 0) root.appendChild(createFolder(xmlDoc, 'OTHERS', othersBucket));
    kmlDoc.appendChild(root);
    return { rootName: detectedRootName };
}

/* ================= LOGIC: SUBFEEDER (FIXED) ================= */
export function restructureSubfeeder(xmlDoc) {
    const kmlDoc = xmlDoc.querySelector('Document');
    
    // 1. Identifikasi Root Name
    let detectedRootName = 'SUBFEEDER ID';
    const firstFolder = xmlDoc.querySelector('Folder');
    if (firstFolder) {
        const n = firstFolder.querySelector('name')?.textContent || '';
        if (n && !STRUCTURE_SUBFEEDER.includes(n)) detectedRootName = n;
    }

    // 2. Ambil Semua Placemark
    const allPlacemarks = Array.from(xmlDoc.querySelectorAll('Placemark'));

    // 3. Siapkan Bucket (Wadah)
    const groups = {}; 

    const getGroupKey = (pm) => {
        let curr = pm.parentElement;
        while(curr && curr.tagName === 'Folder') {
            const n = curr.querySelector('name')?.textContent.trim().toUpperCase() || '';
            const match = n.match(/FDT[\s.\-_]*(\d+)/i); 
            if (match) return `FDT ${parseInt(match[1])}`;
            curr = curr.parentElement;
        }
        return 'MAIN';
    };

    allPlacemarks.forEach(pm => {
        const internalStyle = pm.querySelector('Style');
        if(internalStyle) internalStyle.remove();

        // --- FITUR AUTO CORRECT: MENAMBAHKAN 'C' (MISAL 144 -> 144C) ---
        let name = (pm.querySelector('name')?.textContent || '').trim().toUpperCase();
        
        if (name.match(/JC|JOINT|FDT|CABLE|KABEL/)) {
            const coreRegex = /\b(12|24|36|48|72|96|144|288)(?!\s*C)\b/gi;
            if (coreRegex.test(name)) {
                name = name.replace(coreRegex, "$1C");
                const nameNode = pm.querySelector('name');
                if (nameNode) nameNode.textContent = name;
            }
        }

        const parentName = (pm.parentElement.querySelector('name')?.textContent || '').toUpperCase();
        const groupKey = getGroupKey(pm);
        
        if (!groups[groupKey]) groups[groupKey] = {};

        let targetType = 'UNKNOWN';

        if (name.includes('JOINT') || parentName.includes('JOINT')) targetType = 'JOINT CLOSURE';
        else if (name.includes('SLACK') || parentName.includes('SLACK')) targetType = 'SLACK HANGER';
        else if (name.includes('FDT') || parentName === 'FDT') targetType = 'FDT';
        else if (parentName === 'CABLE' || (pm.querySelector('LineString') && name.includes('CABLE'))) targetType = 'CABLE';
        else {
            const match = STRUCTURE_SUBFEEDER.find(type => name.includes(type) || parentName.includes(type));
            if (match) targetType = match;
            else {
                if (name.includes('POLE') || name.includes('TIANG')) {
                    if (name.includes('NEW')) {
                        if (name.includes('9-')) targetType = 'NEW POLE 9-4';
                        else if (name.includes('7-')) targetType = 'NEW POLE 7-4';
                        else targetType = 'NEW POLE 7-4';
                    } else {
                        targetType = 'EXISTING POLE PARTNER 7-4';
                    }
                }
            }
        }

        if (targetType === 'UNKNOWN') targetType = 'OTHERS';

        if (!groups[groupKey][targetType]) groups[groupKey][targetType] = [];
        
        const PRESERVE_DESC = ['CABLE', 'FDT'];
        if (!PRESERVE_DESC.includes(targetType)) {
            const desc = pm.querySelector('description');
            if (desc) desc.remove();
        }
        
        pm.remove(); 
        groups[groupKey][targetType].push(pm);
    });

    while (kmlDoc.firstChild) kmlDoc.removeChild(kmlDoc.firstChild);

    const root = xmlDoc.createElement('Folder');
    root.appendChild(createName(xmlDoc, detectedRootName));

    const sortedGroupKeys = Object.keys(groups).sort((a,b) => {
        if (a === 'MAIN') return -1;
        if (b === 'MAIN') return 1;
        const numA = parseInt(a.replace(/\D/g, '')) || 999;
        const numB = parseInt(b.replace(/\D/g, '')) || 999;
        return numA - numB;
    });

    sortedGroupKeys.forEach(key => {
        let container = root;
        if (key !== 'MAIN') {
            const groupFolder = xmlDoc.createElement('Folder');
            groupFolder.appendChild(createName(xmlDoc, key));
            root.appendChild(groupFolder);
            container = groupFolder;
        }

        STRUCTURE_SUBFEEDER.forEach(folderName => {
            const items = groups[key][folderName] || [];
            const folder = xmlDoc.createElement('Folder');
            folder.appendChild(createName(xmlDoc, folderName));
            items.forEach(pm => folder.appendChild(pm));
            container.appendChild(folder);
        });

        if (groups[key]['OTHERS'] && groups[key]['OTHERS'].length > 0) {
             const folder = xmlDoc.createElement('Folder');
             folder.appendChild(createName(xmlDoc, 'OTHERS'));
             groups[key]['OTHERS'].forEach(pm => folder.appendChild(pm));
             container.appendChild(folder);
        }
    });

    kmlDoc.appendChild(root);
}

/* ================= LOGIC: SMART ROUTING ================= */
export function processSmartRouting(xmlDoc, mode) {
    const poles = [];
    const validSnapPoints = [];
    const fdtPoints = []; // Nampung FDT dan JOINT CLOSURE sebagai terminal utama

    const ccw = (A, B, C) => (C.lat - A.lat) * (B.lon - A.lon) > (B.lat - A.lat) * (C.lon - A.lon);
    const linesIntersect = (p1, p2, p3, p4) => ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);

    const placemarks = Array.from(xmlDoc.querySelectorAll('Placemark'));
    placemarks.forEach(pm => {
        const name = (pm.querySelector('name')?.textContent || '').toUpperCase();
        const folderName = pm.parentElement.querySelector('name')?.textContent?.toUpperCase() || '';
        const pt = pm.querySelector('Point coordinates');
        if (!pt) return;
        const [lon, lat] = pt.textContent.trim().split(',').map(Number);

        if (folderName.includes('POLE') || name.includes('POLE') || name.includes('TIANG')) {
            const p = { lon, lat, id: `POLE_${lon.toFixed(6)}_${lat.toFixed(6)}`, element: pt, type: 'POLE' };
            poles.push(p);
            validSnapPoints.push(p);
        } else if (name.includes('FDT') || folderName === 'FDT' || name.includes('JOINT') || folderName === 'JOINT CLOSURE') {
            // Gabung FDT dan JC jadi satu kategori terminal (anchor utama)
            const f = { lon, lat, id: `ANCHOR_${lon.toFixed(6)}_${lat.toFixed(6)}`, element: pt, type: 'FDT' };
            fdtPoints.push(f);
        }
    });

    if (poles.length === 0) return;

    fdtPoints.forEach(fdt => {
        let nearest = null;
        let minD = Infinity;
        poles.forEach(p => {
            const d = haversine(fdt, p);
            if (d < minD) { minD = d; nearest = p; }
        });
        if (nearest && minD <= SMART_ROUTE_SNAP_RADIUS) {
            fdt.lon = nearest.lon;
            fdt.lat = nearest.lat;
            fdt.element.textContent = `${nearest.lon},${nearest.lat},0`;
            validSnapPoints.push({ lon: nearest.lon, lat: nearest.lat, id: `FDT_SNAP_${nearest.lon.toFixed(6)}`, type: 'FDT_SNAP' });
        }
    });

    const cables = [];
    placemarks.forEach(pm => {
        const folderName = pm.parentElement.querySelector('name')?.textContent?.toUpperCase() || '';
        // LOGIC BERCABANG BUAT NGENALIN FOLDER KABEL
        if (folderName === 'DISTRIBUTION CABLE' || folderName === 'SLING WIRE' || (mode === 'subfeeder' && folderName === 'CABLE')) {
            const ls = pm.querySelector('LineString coordinates');
            if (ls) {
                let coords = ls.textContent.trim().split(/\s+/).map(pair => {
                    const [lon, lat] = pair.split(',').map(Number);
                    return { lon, lat, snapped: false, id: null };
                });
                cables.push({ pm, coords, lsElement: ls });
            }
        }
    });

    const traversedSegments = new Set(); 
    const confirmedSegments = [];

    cables.forEach(cable => {
        cable.coords.forEach(pt => {
            let bestSnap = null;
            let bestDist = Infinity;
            validSnapPoints.forEach(target => {
                const limit = target.type.includes('FDT') ? SMART_ROUTE_FDT_RADIUS : SMART_ROUTE_SNAP_RADIUS;
                const d = haversine(pt, target);
                if (d <= limit && d < bestDist) { bestDist = d; bestSnap = target; }
            });
            if (bestSnap) { 
                pt.lon = bestSnap.lon; pt.lat = bestSnap.lat; 
                pt.snapped = true; pt.id = bestSnap.id; 
            }
        });

        const getDistToAnyFDT = (pt) => {
            let min = Infinity;
            fdtPoints.forEach(f => {
                const d = haversine(pt, f);
                if (d < min) min = d;
            });
            return min;
        };
        if (cable.coords.length > 0 && getDistToAnyFDT(cable.coords[cable.coords.length - 1]) < getDistToAnyFDT(cable.coords[0])) {
            cable.coords.reverse();
        }

        // =======================================================
        // IDE JENIUS LU: DATA SANITIZER (MENGGABUNGKAN TITIK GLITCH)
        // =======================================================
        const cleanedCoords = [];
        for (let i = 0; i < cable.coords.length; i++) {
            if (cleanedCoords.length === 0) {
                cleanedCoords.push(cable.coords[i]);
            } else {
                const lastCleanPt = cleanedCoords[cleanedCoords.length - 1];
                const distToLast = haversine(lastCleanPt, cable.coords[i]);
                
                // Kalau jarak titik berikutnya kurang dari 2 meter, 
                // anggap itu duplikat atau glitch AutoCAD. KITA SKIP (Merge)!
                if (distToLast > 2) {
                    cleanedCoords.push(cable.coords[i]);
                }
            }
        }
        const coords = cleanedCoords; // Gunakan koordinat yang udah bersih
        // =======================================================

        if (!coords.some(c => c.snapped)) return;

        const runs = [];
        let currentRun = [];
        let isCurrentRunTektok = false;

        for (let i = 0; i < coords.length - 1; i++) {
            const pCurrent = coords[i];
            const pNext = coords[i+1];
            
            const key1 = pCurrent.id || `${pCurrent.lat.toFixed(6)}_${pCurrent.lon.toFixed(6)}`;
            const key2 = pNext.id || `${pNext.lat.toFixed(6)}_${pNext.lon.toFixed(6)}`;
            const segKey = [key1, key2].sort().join('__');

            const isTektok = traversedSegments.has(segKey) && pCurrent.snapped && pNext.snapped;
            traversedSegments.add(segKey); 

            if (currentRun.length === 0) {
                isCurrentRunTektok = isTektok;
                currentRun.push(pCurrent, pNext);
            } else {
                if (isTektok === isCurrentRunTektok) {
                    currentRun.push(pNext); 
                } else {
                    runs.push({ isTektok: isCurrentRunTektok, points: currentRun }); 
                    currentRun = [pCurrent, pNext]; 
                    isCurrentRunTektok = isTektok;
                }
            }
        }
        if (currentRun.length > 0) runs.push({ isTektok: isCurrentRunTektok, points: currentRun });

        let cableTektokLen = 0;
        runs.forEach(run => {
            if (run.isTektok) {
                for (let i = 0; i < run.points.length - 1; i++) {
                    cableTektokLen += haversine(run.points[i], run.points[i+1]);
                }
            }
        });

        const simulatePoly = (points, angleOff) => {
            const poly = [];
            for (let i = 0; i < points.length; i++) {
                if (i === 0) {
                    const brng = getBearing(points[0], points[1]);
                    poly.push(getDestinationPoint(points[0], OFFSET_DISTANCE, brng + angleOff));
                } else if (i === points.length - 1) {
                    const brng = getBearing(points[i-1], points[i]);
                    poly.push(getDestinationPoint(points[i], OFFSET_DISTANCE, brng + angleOff));
                } else {
                    const brng1 = getBearing(points[i-1], points[i]);
                    const brng2 = getBearing(points[i], points[i+1]);
                    let diff = brng2 - brng1;
                    if (diff < -180) diff += 360;
                    if (diff > 180) diff -= 360;
                    
                    let bisectAngle = brng1 + (diff / 2) + angleOff;
                    
                    if (Math.abs(diff) > 120) {
                        // KARENA DATA UDAH BERSIH DARI GLITCH (Berkat ide lu),
                        // Kita sekarang bisa dorong titik puncaknya dengan aman sejauh 1 meter.
                        // Hasilnya: U-Turn kabel bakal memutar rapi di atas tiang FDT!
                        poly.push(getDestinationPoint(points[i], OFFSET_DISTANCE, bisectAngle));
                    } else {
                        let miterDist = OFFSET_DISTANCE / Math.max(0.3, Math.cos((diff / 2) * Math.PI / 180));
                        if (miterDist > OFFSET_DISTANCE * 2.5) miterDist = OFFSET_DISTANCE * 2.5; 
                        poly.push(getDestinationPoint(points[i], miterDist, bisectAngle));
                    }
                }
            }
            return poly;
        };

        const tektokRunsCount = runs.filter(r => r.isTektok).length;
        let currentDirs = Array(tektokRunsCount).fill(90); 

        const buildPathWithDirs = (dirsArray) => {
            let path = [];
            let tIndex = 0;
            runs.forEach((run) => {
                const pts = run.points;
                if (!run.isTektok) {
                    for (let i = 0; i < pts.length; i++) {
                        if (path.length === 0 || i > 0) path.push(pts[i]);
                    }
                } else {
                    const angleOff = dirsArray[tIndex++];
                    const poly = simulatePoly(pts, angleOff);
                    for (let i = 0; i < poly.length; i++) {
                        if (i === 0 && path.length > 0) {
                            const apex = path[path.length - 1];
                            const distToApex = haversine(apex, poly[0]);
                            if (distToApex > 0 && distToApex < OFFSET_DISTANCE * 3) {
                                 path.push(poly[0]);
                            } else {
                                 path[path.length - 1] = poly[0];
                            }
                        } else if (i > 0 || path.length === 0) {
                            path.push(poly[i]);
                        }
                    }
                }
            });
            return path;
        };

        const getOverlaps = (path) => {
            let hits = 0;
            for (let i = 0; i < path.length - 2; i++) {
                for (let j = i + 2; j < path.length - 1; j++) {
                    if (linesIntersect(path[i], path[i+1], path[j], path[j+1])) hits++;
                }
            }
            for (let i = 0; i < path.length - 1; i++) {
                for (let seg of confirmedSegments) {
                    if (linesIntersect(path[i], path[i+1], seg.start, seg.end)) hits++;
                }
            }
            return hits;
        };

        let bestPath = buildPathWithDirs(currentDirs);
        let bestHits = getOverlaps(bestPath);

        let maxIters = 10; 
        while (bestHits > 0 && maxIters > 0) {
            let improved = false;
            for (let t = 0; t < tektokRunsCount; t++) {
                let testDirs = [...currentDirs];
                testDirs[t] = testDirs[t] === 90 ? -90 : 90; 
                let testPath = buildPathWithDirs(testDirs);
                let testHits = getOverlaps(testPath);
                if (testHits < bestHits) {
                    bestHits = testHits;
                    currentDirs = testDirs;
                    bestPath = testPath;
                    improved = true;
                }
            }
            if (!improved) break; 
            maxIters--;
        }
        
        for (let i = 0; i < bestPath.length - 1; i++) {
            confirmedSegments.push({ start: bestPath[i], end: bestPath[i+1] });
        }

        let extData = cable.pm.querySelector('ExtendedData');
        if (!extData) {
            extData = xmlDoc.createElement('ExtendedData');
            cable.pm.appendChild(extData);
        }
        const oldTektok = extData.querySelector('Data[name="tektokLen"]');
        if (oldTektok) oldTektok.remove(); 

        const dataNode = xmlDoc.createElement('Data');
        dataNode.setAttribute('name', 'tektokLen');
        const valNode = xmlDoc.createElement('value');
        valNode.textContent = Math.round(cableTektokLen);
        dataNode.appendChild(valNode);
        extData.appendChild(dataNode);

        if (bestPath.length > 0) {
             cable.lsElement.textContent = bestPath.map(p => `${p.lon},${p.lat},0`).join(' ');
        }
    });
}

/* ================= FEATURES ================= */
export function generateAutoSlack(xmlDoc) {
    const allFolders = Array.from(xmlDoc.querySelectorAll('Folder'));
    const fdtFolder = allFolders.find(f => f.querySelector('name')?.textContent === 'FDT');
    const fdtPlacemarks = fdtFolder ? Array.from(fdtFolder.querySelectorAll('Placemark')) : [];

    allFolders.forEach(folder => {
        const folderName = folder.querySelector('name')?.textContent.trim().toUpperCase() || '';
        const isLineA = folderName.includes('LINE A');
        const fatFolder = Array.from(folder.children).find(c => c.tagName === 'Folder' && c.querySelector('name')?.textContent === 'FAT');
        if (fatFolder) {
            let slackFolder = Array.from(folder.children).find(c => c.tagName === 'Folder' && c.querySelector('name')?.textContent === 'SLACK HANGER');
            if (!slackFolder) {
                slackFolder = xmlDoc.createElement('Folder');
                slackFolder.appendChild(createName(xmlDoc, 'SLACK HANGER'));
                folder.appendChild(slackFolder);
            } else {
                 while (slackFolder.children.length > 1) { slackFolder.removeChild(slackFolder.lastChild); }
            }
            const fats = Array.from(fatFolder.querySelectorAll('Placemark'));
            fats.forEach(fat => {
                const clone = fat.cloneNode(true);
                const d = clone.querySelector('description'); if(d) d.remove();
                const s = clone.querySelector('styleUrl'); if(s) s.remove();
                slackFolder.appendChild(clone);
            });
            if (isLineA && fats.length > 0 && fdtPlacemarks.length > 0) {
                const firstFatName = fats[0].querySelector('name')?.textContent.trim() || '';
                const complexFatRegex = /^(.*[\.\-])([A-Z])(\d{2,3})$/i;
                const simpleFatRegex = /^(.*)([A-Z])(\d{2,3})$/i;
                let match = firstFatName.match(complexFatRegex);
                if (!match) match = firstFatName.match(simpleFatRegex);
                let searchKey = '';
                if (match && match[1]) { searchKey = match[1].replace(/[\.\-]+$/, '').trim(); }
                else { searchKey = firstFatName.replace(/\.[A-Z0-9]+$/i, '').trim(); }
                if (searchKey.length > 2) {
                    const matchedFDT = fdtPlacemarks.find(fdt => {
                        const fName = fdt.querySelector('name')?.textContent || '';
                        return fName.toUpperCase().includes(searchKey.toUpperCase());
                    });
                    if (matchedFDT) {
                        const fdtClone = matchedFDT.cloneNode(true);
                        const d = fdtClone.querySelector('description'); if(d) d.remove();
                        const s = fdtClone.querySelector('styleUrl'); if(s) s.remove();
                        slackFolder.appendChild(fdtClone);
                    } else {
                        globalErrorLog.push(`Line containing ${firstFatName}: Parent FDT (${searchKey}) not found.`);
                    }
                }
            }
            sortFolderChildren(folder, STRUCTURE_CLUSTER);
        }
    });
}

export function generateAutoSlackSubfeeder(xmlDoc, enableAuto400m = false) {
    const INTERVAL_SLACK = 400; // Taruh slack tiap 400 meter
    const MIN_DIST_TO_END = 20; // Jarak aman ke ujung biar ga dobel
    const CABLE_DETECT_TOLERANCE = 15; // Toleransi radius deteksi
    const POLE_SNAP_RADIUS = 75; // Cari tiang maksimal 75 meter dari titik 400m
    const MIN_SLACK_DISTANCE = 50; // Jarak minimal antar slack biar ga numpuk

    const folders = Array.from(xmlDoc.querySelectorAll('Folder'));

    folders.forEach(folder => {
        const children = Array.from(folder.children).filter(c => c.tagName === 'Folder');
        const hasCable = children.some(c => c.querySelector('name')?.textContent.trim() === 'CABLE');
        
        if (hasCable) {
            const cableFolder = children.find(c => c.querySelector('name')?.textContent.trim() === 'CABLE');
            const jcFolder = children.find(c => c.querySelector('name')?.textContent.trim() === 'JOINT CLOSURE');
            const fdtFolder = children.find(c => c.querySelector('name')?.textContent.trim() === 'FDT');
            
            let slackFolder = children.find(c => c.querySelector('name')?.textContent.trim() === 'SLACK HANGER');
            
            if (!slackFolder) {
                slackFolder = xmlDoc.createElement('Folder');
                slackFolder.appendChild(createName(xmlDoc, 'SLACK HANGER'));
                folder.appendChild(slackFolder);
            } else {
                while (slackFolder.children.length > 1) { 
                    slackFolder.removeChild(slackFolder.lastChild); 
                }
            }

            const polePoints = [];
            children.forEach(c => {
                const n = c.querySelector('name')?.textContent.trim().toUpperCase() || '';
                if (n.includes('POLE') || n.includes('TIANG')) {
                    c.querySelectorAll('Placemark').forEach(pm => {
                        const pt = pm.querySelector('Point coordinates');
                        if (pt) {
                            const [lon, lat] = pt.textContent.trim().split(',').map(Number);
                            polePoints.push({ lon, lat });
                        }
                    });
                }
            });

            const placedSlacks = [];
            const anchorPoints = [];

            // =======================================================
            // BAGIAN INI ALWAYS ON: Taro slack di Anchor (FDT & JC)
            // =======================================================
            [jcFolder, fdtFolder].forEach(targetFolder => {
                if (targetFolder) {
                    targetFolder.querySelectorAll('Placemark').forEach(pm => {
                        const pt = pm.querySelector('Point coordinates');
                        if (pt) {
                            const [lon, lat] = pt.textContent.trim().split(',').map(Number);
                            const type = targetFolder === jcFolder ? 'JC' : 'FDT';
                            
                            // --- AUTO-CORRECT EX -> EXT ---
                            let isExisting = false;
                            let pmNameTag = pm.querySelector('name');
                            if (pmNameTag) {
                                let originalName = pmNameTag.textContent.trim();
                                if (/\b(?:EX|EXT)\b/i.test(originalName)) {
                                    isExisting = true;
                                    pmNameTag.textContent = originalName.replace(/\bEX\b/gi, 'EXT');
                                }
                            }
                            const slackName = isExisting ? 'EXT SLACK 20m' : 'NEW SLACK 20m';
                            
                            const isTooClose = placedSlacks.some(s => haversine({lon, lat}, s) < CABLE_DETECT_TOLERANCE);
                            
                            if (!isTooClose) {
                                placedSlacks.push({lon, lat}); 
                                anchorPoints.push({ lon, lat, type });
                                
                                const slackClone = pm.cloneNode(true);
                                let nameTag = slackClone.querySelector('name');
                                if (!nameTag) {
                                    nameTag = xmlDoc.createElement('name');
                                    slackClone.insertBefore(nameTag, slackClone.firstChild);
                                }
                                nameTag.textContent = slackName; 
                                const d = slackClone.querySelector('description'); if(d) d.remove();
                                const s = slackClone.querySelector('styleUrl'); if(s) s.remove();
                                slackFolder.appendChild(slackClone);
                            }
                        }
                    });
                }
            });

            // =======================================================
            // BAGIAN INI TOGGLEABLE: Taro slack tiap 400m
            // =======================================================
            if (enableAuto400m && cableFolder) {
                cableFolder.querySelectorAll('Placemark').forEach(cablePm => {
                    const ls = cablePm.querySelector('LineString coordinates');
                    if (!ls) return;

                    const coords = ls.textContent.trim().split(/\s+/).filter(p => p.includes(',')).map(p => { 
                        const [lon, lat] = p.split(',').map(Number); 
                        return { lon, lat }; 
                    });

                    if (coords.length < 2) return;

                    const totalCableLength = coords.reduce((acc, curr, idx) => {
                        if (idx === 0) return 0;
                        return acc + haversine(coords[idx-1], curr);
                    }, 0);

                    let currentWalkedDist = 0; 
                    let distSinceLastSlack = 0; 

                    for (let i = 0; i < coords.length - 1; i++) {
                        const p1 = coords[i];
                        const p2 = coords[i+1];
                        const segLen = haversine(p1, p2);

                        let isP1NearAnchor = anchorPoints.some(anc => haversine(p1, anc) <= CABLE_DETECT_TOLERANCE);
                        if (isP1NearAnchor) distSinceLastSlack = 0;

                        let remainingSegLen = segLen;
                        let currentPt = p1;

                        while (distSinceLastSlack + remainingSegLen >= INTERVAL_SLACK) {
                            const distNeeded = INTERVAL_SLACK - distSinceLastSlack;
                            const brng = getBearing(currentPt, p2);
                            const idealSlackPt = getDestinationPoint(currentPt, distNeeded, brng);

                            currentWalkedDist += distNeeded;
                            const remainingCableDist = totalCableLength - currentWalkedDist;

                            if (remainingCableDist > MIN_DIST_TO_END) {
                                let nearestPole = null;
                                let minPoleDist = Infinity;

                                polePoints.forEach(pole => {
                                    const d = haversine(idealSlackPt, pole);
                                    if (d < minPoleDist) { minPoleDist = d; nearestPole = pole; }
                                });

                                // WAJIB DI TIANG (Ga ada tiang di radius 75m = Batal)
                                if (nearestPole && minPoleDist <= POLE_SNAP_RADIUS) {
                                    let finalSlackPt = nearestPole;
                                    const isTooClose = placedSlacks.some(s => haversine(finalSlackPt, s) < MIN_SLACK_DISTANCE);

                                    if (!isTooClose) {
                                        placedSlacks.push(finalSlackPt); 

                                        const newPm = xmlDoc.createElement('Placemark');
                                        newPm.appendChild(createName(xmlDoc, 'NEW SLACK 20m'));
                                        
                                        const ptNode = xmlDoc.createElement('Point');
                                        const coordsNode = xmlDoc.createElement('coordinates');
                                        coordsNode.textContent = `${finalSlackPt.lon.toFixed(6)},${finalSlackPt.lat.toFixed(6)},0`;
                                        ptNode.appendChild(coordsNode);
                                        newPm.appendChild(ptNode);
                                        
                                        slackFolder.appendChild(newPm);
                                    }
                                }
                            }
                            remainingSegLen -= distNeeded;
                            currentPt = idealSlackPt;
                            distSinceLastSlack = 0; 
                        }
                        currentWalkedDist += remainingSegLen;
                        distSinceLastSlack += remainingSegLen;
                    }
                });
            }
        }
    });
}

export function organizeHpByBoundary(xmlDoc, usePolygonAsMaster = true) {
    const boundaryPlacemarks = [];
    const allFolders = Array.from(xmlDoc.querySelectorAll('Folder'));

    // 1. Kumpulin semua Polygon BOUNDARY FAT dulu
    const boundaryFolders = allFolders.filter(f => f.querySelector('name')?.textContent.trim().toUpperCase() === 'BOUNDARY FAT');
    boundaryFolders.forEach(bf => {
        const lineFolder = bf.parentElement;

        bf.querySelectorAll('Placemark').forEach(pm => {
            let coordsText = '';
            const polygon = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
            const lineString = pm.querySelector('LineString coordinates');
            if (polygon) coordsText = polygon.textContent;
            else if (lineString) coordsText = lineString.textContent;

            if (coordsText) {
                const coords = coordsText.trim().split(/\s+/).map(pair => {
                    const [lon, lat] = pair.split(',').map(Number);
                    return { lon, lat };
                });
                const bNameNode = pm.querySelector('name');
                const bName = bNameNode?.textContent.trim() || 'Unknown';
                boundaryPlacemarks.push({
                    nameNode: bNameNode,
                    name: bName,
                    polygon: coords,
                    hpCount: 0,
                    element: pm,
                    parentLine: lineFolder,
                    assigned: false // Tracker buat fitur anti-duplicate
                });
            }
        });
    });

    if (boundaryPlacemarks.length === 0) return;

    if (usePolygonAsMaster) {
        // ==========================================================
        // LOGIC DEFAULT (ON): POLYGON SBG MASTER -> GROUPING HP
        // ==========================================================
        const allHpItems = [];
        allFolders.forEach(f => {
            const fName = f.querySelector('name')?.textContent.trim().toUpperCase() || '';
            if (fName === 'HP COVER') {
                f.querySelectorAll('Placemark').forEach(pm => {
                    const pt = pm.querySelector('Point coordinates');
                    if (pt) {
                        const [lon, lat] = pt.textContent.trim().split(',').map(Number);
                        allHpItems.push({ lon, lat, element: pm });
                    }
                });
            }
        });

        allHpItems.forEach(hp => {
            let matchedBoundary = null;
            for (const b of boundaryPlacemarks) {
                if (isPointInPolygon(hp, b.polygon)) {
                    matchedBoundary = b;
                    break;
                }
            }

            if (matchedBoundary) {
                matchedBoundary.hpCount++;
                let targetLine = matchedBoundary.parentLine;
                let hpCoverFolder = Array.from(targetLine.children).find(c =>
                    c.tagName === 'Folder' && c.querySelector('name')?.textContent.trim().toUpperCase() === 'HP COVER'
                );

                if (!hpCoverFolder) {
                    hpCoverFolder = xmlDoc.createElement('Folder');
                    hpCoverFolder.appendChild(createName(xmlDoc, 'HP COVER'));
                    targetLine.appendChild(hpCoverFolder);
                }

                let fatSubFolder = Array.from(hpCoverFolder.children).find(c =>
                    c.tagName === 'Folder' && c.querySelector('name')?.textContent.trim() === matchedBoundary.name
                );

                if (!fatSubFolder) {
                    fatSubFolder = xmlDoc.createElement('Folder');
                    fatSubFolder.appendChild(createName(xmlDoc, matchedBoundary.name));
                    hpCoverFolder.appendChild(fatSubFolder);
                }
                fatSubFolder.appendChild(hp.element);
            }
        });

        boundaryPlacemarks.forEach(b => {
            let d = b.element.querySelector('description');
            if (d) d.remove();
            d = xmlDoc.createElement('description');
            d.textContent = `${b.hpCount} HP`;
            b.element.appendChild(d);
        });

    } else {
        // ==========================================================
        // LOGIC BARU (OFF): HP FOLDER SBG MASTER -> NAMAIN POLYGON
        // ==========================================================
        allFolders.forEach(f => {
            const fName = f.querySelector('name')?.textContent.trim().toUpperCase() || '';
            if (fName === 'HP COVER') {
                const subFolders = Array.from(f.children).filter(c => c.tagName === 'Folder');
                
                subFolders.forEach(sub => {
                    const subName = sub.querySelector('name')?.textContent.trim() || 'Unknown';
                    const placemarks = Array.from(sub.querySelectorAll('Placemark'));
                    if (placemarks.length === 0) return;

                    // Ambil maksimal 3 sampel titik buat ngehindarin outlier HP nyasar
                    const samples = [];
                    for (let i = 0; i < placemarks.length && i < 3; i++) {
                        const pt = placemarks[i].querySelector('Point coordinates');
                        if (pt) {
                            const [lon, lat] = pt.textContent.trim().split(',').map(Number);
                            samples.push({ lon, lat });
                        }
                    }

                    if (samples.length > 0) {
                        let matchedBoundary = null;
                        
                        // Cek polygon mana yg nampung titik sampel ini
                        for (const b of boundaryPlacemarks) {
                            // Pake .some() -> kalau minimal 1 dari 3 sampel masuk, gas.
                            const isMatch = samples.some(pt => isPointInPolygon(pt, b.polygon));
                            if (isMatch) {
                                matchedBoundary = b;
                                break;
                            }
                        }

                        if (matchedBoundary) {
                            // Warning Duplikat
                            if (matchedBoundary.assigned && matchedBoundary.name !== subName) {
                                globalErrorLog.push(`⚠️ Duplikat FAT: Polygon untuk FAT [${matchedBoundary.name}] tertimpa oleh kelompok HP [${subName}]. Cek ulang file KML-nya.`);
                            }
                            
                            // Namain ulang Polygon berdasarkan Subfolder
                            if (matchedBoundary.nameNode) {
                                matchedBoundary.nameNode.textContent = subName;
                            } else {
                                const newNameNode = createName(xmlDoc, subName);
                                matchedBoundary.element.appendChild(newNameNode);
                                matchedBoundary.nameNode = newNameNode;
                            }
                            
                            matchedBoundary.name = subName;
                            matchedBoundary.assigned = true;
                            matchedBoundary.hpCount += placemarks.length; 
                        } else {
                            globalErrorLog.push(`⚠️ Error: Polygon boundary tidak ditemukan untuk kelompok HP [${subName}].`);
                        }
                    }
                });
            }
        });

        // Update deskripsi jumlah HP di Polygon (Optional, biar manis di kml)
        boundaryPlacemarks.forEach(b => {
            if (b.hpCount > 0) {
                let d = b.element.querySelector('description');
                if (d) d.remove();
                d = xmlDoc.createElement('description');
                d.textContent = `${b.hpCount} HP`;
                b.element.appendChild(d);
            }
        });
    }
}

export function autoRepositionPoints(xmlDoc, mode) {
    const anchors = [];
    const movables = [];
    const placemarks = xmlDoc.querySelectorAll('Placemark');
    
    placemarks.forEach(pm => {
        const name = (pm.querySelector('name')?.textContent || '').toUpperCase();
        const parentFolder = pm.parentElement.querySelector('name')?.textContent?.toUpperCase() || '';
        const pt = pm.querySelector('Point coordinates');
        
        if (pt) {
            const [lon, lat] = pt.textContent.trim().split(',').map(Number);
            const item = { element: pt, lon, lat, parent: parentFolder, name: name };
            
            if (parentFolder.includes('POLE') || name.includes('POLE') || name.includes('TIANG')) {
                anchors.push(item);
            } else {
                // LOGIC BERCABANG SESUAI MODE
                if (mode === 'cluster' && (parentFolder === 'FAT' || parentFolder === 'SLACK HANGER')) {
                    movables.push(item);
                } else if (mode === 'subfeeder' && (parentFolder === 'FDT' || parentFolder === 'JOINT CLOSURE' || parentFolder === 'SLACK HANGER' || name.includes('FDT') || name.includes('JOINT'))) {
                    movables.push(item);
                }
            }
        }
    });
    
    if (anchors.length === 0 || movables.length === 0) return;
    
    movables.forEach(mov => {
        let nearestAnchor = null;
        let minDst = Infinity;
        anchors.forEach(anc => {
            const d = haversine(mov, anc);
            if (d < minDst) { minDst = d; nearestAnchor = anc; }
        });
        // Toleransi snap 15 meter ke tiang terdekat
        if (nearestAnchor && minDst <= 15) {
            mov.element.textContent = `${nearestAnchor.lon},${nearestAnchor.lat},0`;
        }
    });
}

/* ================= APPLY STYLES (UPDATED WITH AUTO-CORRECT) ================= */
export function applyStyles(xmlDoc, mode) {
    const placemarks = xmlDoc.querySelectorAll('Placemark');
    const doc = xmlDoc.querySelector('Document');
    const stylesCreated = new Set();
    const styleB = xmlDoc.createElement('Style'); styleB.id = 'style_boundary';
    styleB.innerHTML = `<LineStyle><color>4dffffff</color><width>2</width></LineStyle><PolyStyle><color>4dffffff</color></PolyStyle>`;
    doc.appendChild(styleB);

    placemarks.forEach(pm => {
        // --- FITUR AUTO CORRECT FDT / CABLE (Merapikan typo sebelum di-proses) ---
        const coreRegex = /\b(\d+)\s*[cC](?:ore)?\b/gi;
        
        // 1. Cek & perbaiki typo di <name>
        let nameNode = pm.querySelector('name');
        if (nameNode) {
            nameNode.textContent = nameNode.textContent.replace(coreRegex, "$1C");
        }

        // 2. Cek & perbaiki typo di <description> (INI YANG KEMARIN KURANG)
        let descNode = pm.querySelector('description');
        if (descNode) {
            descNode.textContent = descNode.textContent.replace(coreRegex, "$1C");
        }

        const name = (pm.querySelector('name')?.textContent || '').toUpperCase();
        const desc = (pm.querySelector('description')?.textContent || '').toUpperCase();
        const fullText = name + ' ' + desc;
        const folderName = (pm.parentElement.querySelector('name')?.textContent || '').trim().toUpperCase();
        const grandParentName = (pm.parentElement.parentElement?.querySelector('name')?.textContent || '').trim().toUpperCase();

        if (folderName.includes('BOUNDARY CLUSTER')) { setStyle(pm, 'style_boundary'); return; }

        let rule = null;
        if (mode === 'cluster') {
            rule = RULES_CLUSTER.find(r => {
                if (r.folder !== '-' && r.folder === folderName) return true;
                if (folderName === 'DISTRIBUTION CABLE' && r.line !== '-' && fullText.includes(r.line)) return true;
                if (r.placemark !== '-' && fullText.includes(r.placemark)) return true;
                return false;
            });
            if (!rule) {
                if (grandParentName.includes('HP COVER') || folderName.includes('HP COVER')) rule = RULES_CLUSTER.find(r => r.folder === 'HP COVER');
                else if (grandParentName.includes('HP UNCOVER') || folderName.includes('HP UNCOVER')) rule = RULES_CLUSTER.find(r => r.folder === 'HP UNCOVER');
            }
        } else {
            // === LOGIKA SUBFEEDER ===
            if (folderName === 'CABLE') {
                const coreColors = { '288C': '#FFAA00', '144C': '#AAFF00', '96C': '#FF0000', '48C': '#AA00FF', '24C': '#00FF00' };
                const match = Object.keys(coreColors).find(k => fullText.includes(k));
                rule = { colorCode: match ? coreColors[match] : '#00AAFF', styleLink: '-', placemark: '-' };
            }
            else if (folderName === 'FDT') {
                const coreMatch = fullText.match(/\b(\d+)C\b/); 
                let core = '48C';
                if (coreMatch) core = coreMatch[0];

                const coreMap = { '288C': '#FFAA00', '144C': '#AAFF00', '96C': '#FF0000', '72C': '#0000FF', '48C': '#AA00FF', '36C': '#FF00FF', '24C': '#00FF00' };
                rule = { colorCode: coreMap[core] || '#AA00FF', styleLink: 'http://maps.google.com/mapfiles/kml/shapes/cross-hairs.png', placemark: 'FDT_' + core };
            }
            else if (folderName === 'JOINT CLOSURE') {
                const coreMatch = fullText.match(/\b(\d+)C\b/); 
                let core = '48C';
                if (coreMatch) core = coreMatch[0];

                const coreMap = { '288C': '#FFAA00', '144C': '#AAFF00', '96C': '#FF0000', '72C': '#0000FF', '48C': '#AA00FF', '36C': '#FF00FF', '24C': '#00FF00' };
                rule = { colorCode: coreMap[core] || '#AA00FF', styleLink: 'http://maps.google.com/mapfiles/kml/shapes/forbidden.png', placemark: 'JC_' + core };
            }
            else if (folderName.includes('POLE') || folderName.includes('TIANG')) {
                let pColor = '#550000';
                if (folderName.includes('NEW')) {
                    if (folderName.includes('9-')) pColor = '#FF0000';
                    else if (folderName.includes('7-5') || folderName.includes('7-4')) pColor = '#00FF00';
                    else if (folderName.includes('7-3')) pColor = '#00FFFF';
                    else if (folderName.includes('7-2.5')) pColor = '#AA00FF';
                }
                rule = { colorCode: pColor, styleLink: 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png', placemark: '-' };
            }
            else rule = RULES_SUBFEEDER.find(r => r.folder === folderName);
        }

        if (rule) {
            let iconScale = 1.1; let lineWidth = 2;
            if (folderName.includes('HP COVER') || folderName.includes('HP UNCOVER') || grandParentName.includes('HP ')) iconScale = 0.6;
            if (folderName === 'BOUNDARY FAT') lineWidth = 3;
            if (folderName === 'DISTRIBUTION CABLE' || folderName === 'SLING WIRE' || folderName === 'CABLE') lineWidth = 4;
            
            const safeName = (rule.placemark !== '-' ? rule.placemark : folderName).replace(/[^a-z0-9]/gi, '');
            
            let linkSuffix = 'NoIcon';
            if (rule.styleLink !== '-') {
                const parts = rule.styleLink.split('/');
                linkSuffix = parts[parts.length - 1].replace(/[^a-z0-9]/gi, '');
            }
            const styleId = `style_${rule.colorCode.replace('#','')}_${safeName}_S${iconScale}_W${lineWidth}_${linkSuffix}`;
            
            if (!stylesCreated.has(styleId)) {
                const style = xmlDoc.createElement('Style'); style.id = styleId;
                const kmlColor = 'ff' + rule.colorCode.replace('#', '').match(/.{2}/g).reverse().join('');
                let styleContent = '';
                if (rule.styleLink !== '-') {
                    styleContent += `<IconStyle><color>${kmlColor}</color><scale>${iconScale}</scale><Icon><href>${rule.styleLink}</href></Icon></IconStyle>`;
                }
                styleContent += `<LabelStyle><color>${kmlColor}</color><scale>${TEXT_SIZE}</scale></LabelStyle>`;
                styleContent += `<LineStyle><color>${kmlColor}</color><width>${lineWidth}</width></LineStyle><PolyStyle><color>66${kmlColor.substring(2)}</color></PolyStyle>`;
                style.innerHTML = styleContent;
                doc.appendChild(style);
                stylesCreated.add(styleId);
            }
            setStyle(pm, styleId);
        }
    });
}

function setStyle(pm, id) {
    let oldUrl = pm.querySelector('styleUrl');
    if(oldUrl) oldUrl.remove();
    let url = pm.ownerDocument.createElement('styleUrl');
    url.textContent = '#' + id;
    pm.appendChild(url);
}

export function injectDescriptionsAndCalc(xmlDoc, mode, doCalcCable) {
    const folders = xmlDoc.querySelectorAll('Folder');
    
    if (mode === 'subfeeder') {
        // TUKANG SAPU RENAME UDAH DIHAPUS DARI SINI
        
        const cableFolders = Array.from(folders).filter(f => f.querySelector('name')?.textContent.trim() === 'CABLE');
        cableFolders.forEach(cableFolder => {
            if (doCalcCable) {
                const parentLine = cableFolder.parentElement;
                if (!parentLine) return;
                
                const siblings = Array.from(parentLine.children).filter(c => c.tagName === 'Folder');
                const jcFolder = siblings.find(f => f.querySelector('name')?.textContent.trim() === 'JOINT CLOSURE');
                
                const jcPoints = [];
                if (jcFolder) {
                    jcFolder.querySelectorAll('Placemark').forEach(pm => {
                        const pt = pm.querySelector('Point coordinates');
                        if (pt) { const [lon, lat] = pt.textContent.trim().split(',').map(Number); jcPoints.push({lon, lat}); }
                    });
                }

                cableFolder.querySelectorAll('Placemark').forEach(pm => {
                    const ls = pm.querySelector('LineString coordinates');
                    if (ls) {
                        const coordsText = ls.textContent;
                        const linePoints = coordsText.trim().split(/\s+/).filter(p => p.includes(',')).map(p => { const [lon, lat] = p.split(',').map(Number); return { lon, lat }; });
                        
                        // 1. HITUNG PANJANG ASLI DULU (Q2)
                        const x = calculateLineLength(coordsText);
                        
                        // 2. OVERRIDE TOTAL SLACK PAKAI RUMUS BOQ
                        let countSlack_Total = 0;
                        if (x > 0) {
                            countSlack_Total = Math.ceil(x / 400) + 1; 
                        }

                        const countFDT_Text = 1; 
                        let countJC_Spatial = 0;
                        
                        jcPoints.forEach(jc => {
                            let minD = Infinity;
                            for(let i=0; i<linePoints.length-1; i++) {
                                const d = distToSegment(jc, linePoints[i], linePoints[i+1]);
                                if (d < minD) minD = d;
                            }
                            if (minD <= CABLE_DETECT_TOLERANCE) countJC_Spatial++;
                        });
                        
                        let countNew = countSlack_Total - countFDT_Text - countJC_Spatial;
                        if (countNew < 0) countNew = 0;
                        
                        // 3. KALKULASI FINAL BOQ
                        const totalSlackLength = countSlack_Total * 20;
                        const e = Math.ceil((x + totalSlackLength) * 1.05);
                        
                        let descTag = pm.querySelector('description') || pm.appendChild(xmlDoc.createElement('description'));
                        descTag.textContent = `Deskripsi :\n\nTotal Route\t: ${x} m\nTotal Slack\t: ${countSlack_Total} unit (${countFDT_Text} FDT, ${countJC_Spatial} JC, ${countNew} NEW) @20 m\nToleransi\t: 5%\n\nTotal Length Cable  : ${x} + ${totalSlackLength} ( x 5%) = ${e} m\n\nby Opname	 : -- m\nby OTDR 	 : -- m`;
                        
                        const nameTag = pm.querySelector('name');
                        if (nameTag) {
                            let oldName = nameTag.textContent.trim();
                            oldName = oldName.replace(/\s*-\s*\d+\s*m(eters?)?$/i, '');
                            nameTag.textContent = `${oldName} - ${e} m`;
                        }
                    }
                });
            }
        });
    }
    
    // ==========================================
    // LOGIC CLUSTER (Tetep Dibiarkan Sama)
    // ==========================================
    if (mode === 'cluster') {
        folders.forEach(folder => {
            let folderName = folder.querySelector('name')?.textContent.trim().toUpperCase() || '';
            if (folderName === 'SLING WIRE') {
                let totalMeters = 0;
                folder.querySelectorAll('Placemark').forEach(pm => {
                    const ls = pm.querySelector('LineString coordinates');
                    if (ls) {
                        const len = calculateLineLength(ls.textContent);
                        totalMeters += len;
                        let nameTag = pm.querySelector('name') || pm.appendChild(xmlDoc.createElement('name'));
                        nameTag.textContent = `LineString — ${len} meters`;
                    }
                });
                if (totalMeters > 0) {
                    let descTag = folder.querySelector('description') || folder.appendChild(xmlDoc.createElement('description'));
                    descTag.textContent = `${totalMeters} m`;
                }
            }
            else if (folderName === 'DISTRIBUTION CABLE') {
                if (doCalcCable) {
                    let fatCount = 0;
                    const parentFolder = folder.parentElement;
                    if (parentFolder) {
                        const fatFolder = Array.from(parentFolder.children).find(el => el.tagName === 'Folder' && el.querySelector('name')?.textContent.trim() === 'FAT');
                        if (fatFolder) fatCount = fatFolder.getElementsByTagName('Placemark').length;
                    }
                    const b = 1; const c = fatCount; const a = b + c; const d = a * 20;
                    folder.querySelectorAll('Placemark').forEach(pm => {
                        const ls = pm.querySelector('LineString coordinates');
                        if (ls) {
                            const x = calculateLineLength(ls.textContent);
                            const e = Math.ceil((x + d) * 1.05);
                            let nameTag = pm.querySelector('name');
                            if (nameTag) {
                                const oldName = nameTag.textContent.trim();
                                const regex = /(\d+)(\s*M)$/i;
                                if (regex.test(oldName)) nameTag.textContent = oldName.replace(regex, e + "$2");
                            }
                            let descTag = pm.querySelector('description') || pm.appendChild(xmlDoc.createElement('description'));
                            descTag.textContent = `Deskripsi :\n\nTotal Route \t : ${x} m\nTotal Slack\t : ${a} unit (${b} slack FDT & ${c} slack FAT) @20 m\nToleransi\t : 5%\n\nTotal Length Cable  : ${x} + ${d} ( x 5%) = ${e} m\n\nby Opname	 : -- m\nby OTDR 	 : -- m`;
                        }
                    });
                }
            }
            else {
                let suffix = null;
                if (folderName === 'FAT') suffix = ' FAT';
                else if (folderName === 'HP COVER') suffix = ' HP';
                else if (folderName === 'HP UNCOVER') suffix = ' HP';
                else if (folderName.includes('EXISTING POLE')) suffix = ' EXT POLE';
                else if (folderName.includes('NEW POLE')) suffix = ' POLE';
                if (suffix) {
                    const count = folder.getElementsByTagName('Placemark').length;
                    if (count > 0) {
                        let descTag = folder.querySelector('description') || folder.appendChild(xmlDoc.createElement('description'));
                        descTag.textContent = `${count}${suffix}`;
                    }
                }
            }
        });
    }
}

export function sortPlacemarksInsideFolders(xmlDoc, mode) {
    const folders = Array.from(xmlDoc.querySelectorAll('Folder'));
    const structure = mode === 'cluster' ? STRUCTURE_CLUSTER : STRUCTURE_SUBFEEDER;

    folders.forEach(folder => {
        const nameNode = folder.querySelector('name');
        const folderName = nameNode?.textContent.trim().toUpperCase() || "";

        const children = Array.from(folder.children).filter(c =>
            (c.tagName === 'Folder' || c.tagName === 'Placemark') && c !== nameNode
        );

        if (children.length < 2) return;

        if (structure.includes(folderName) || folderName === 'HP COVER' || folderName === 'HP UNCOVER' || folderName === 'FDT') {
            children.sort((a, b) => {
                const nameA = a.querySelector('name')?.textContent || "";
                const nameB = b.querySelector('name')?.textContent || "";
                return nameA.localeCompare(nameB, undefined, {numeric: true, sensitivity: 'base'});
            });
            children.forEach(c => folder.appendChild(c));
            return;
        }

        const isLineGroup = children.some(c => c.tagName === 'Folder' && c.querySelector('name')?.textContent.toUpperCase().includes('LINE '));

        if (isLineGroup) {
            children.sort((a, b) => {
                const nA = a.querySelector('name')?.textContent.trim().toUpperCase() || "";
                const nB = b.querySelector('name')?.textContent.trim().toUpperCase() || "";

                const getPriority = (name) => {
                    if (name.includes('BOUNDARY CLUSTER')) return 0;
                    if (name === 'FDT') return 1;
                    return 2;
                };

                const pA = getPriority(nA);
                const pB = getPriority(nB);

                if (pA !== pB) return pA - pB;

                const getInfo = (str) => {
                    const fdtMatch = str.match(/FDT\s*(\d+)/i);
                    const lineMatch = str.match(/LINE\s*([A-Z0-9]+)/i);
                    return {
                        fdt: fdtMatch ? parseInt(fdtMatch[1]) : 9999,
                        line: lineMatch ? lineMatch[1] : str
                    };
                };

                const infoA = getInfo(nA);
                const infoB = getInfo(nB);

                if (infoA.fdt !== infoB.fdt) return infoA.fdt - infoB.fdt;
                return infoA.line.localeCompare(infoB.line, undefined, {numeric: true});
            });
            children.forEach(c => folder.appendChild(c));
            return;
        }

        const hasStructureChildren = children.some(c => structure.includes(c.querySelector('name')?.textContent.trim().toUpperCase()));

        if (hasStructureChildren) {
            children.sort((a, b) => {
                const nA = a.querySelector('name')?.textContent.trim().toUpperCase() || "";
                const nB = b.querySelector('name')?.textContent.trim().toUpperCase() || "";

                const idxA = structure.indexOf(nA);
                const idxB = structure.indexOf(nB);

                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return nA.localeCompare(nB, undefined, {numeric: true});
            });
            children.forEach(c => folder.appendChild(c));
        }
    });
}

export function generateSummaryTable(xmlDoc) {
    const container = document.getElementById('summaryContent');
    if (!container) return;
    container.innerHTML = '';
    const allFolders = Array.from(xmlDoc.querySelectorAll('Folder'));
    const zoneStats = [];

    const getStats = (folder) => {
        const nameNode = folder.querySelector('name');
        if (!nameNode) return null;
        const name = nameNode.textContent.trim();

        if (name === 'HP COVER') {
            const subFolders = Array.from(folder.children).filter(c => c.tagName === 'Folder');
            if (subFolders.length > 0) {
                const allHpItems = [];
                subFolders.forEach(sub => {
                    const fatName = sub.querySelector('name')?.textContent || 'Unknown';
                    sub.querySelectorAll('Placemark').forEach(() => allHpItems.push({ type: 'Point', val: 1, detail: fatName, rawName: 'HP' }));
                });
                return { name, items: allHpItems };
            }
        }

        const placemarks = folder.querySelectorAll('Placemark');
        if (placemarks.length === 0) return null;
        const items = [];
        placemarks.forEach(pm => {
            const pmName = pm.querySelector('name')?.textContent || 'Unnamed';
            let type = pm.querySelector('LineString') ? 'Line' : 'Point';
            let val = type === 'Line' ? (pmName.match(/(\d+)\s*m/i) ? parseInt(pmName.match(/(\d+)\s*m/i)[1]) : 0) : 1;
            items.push({ type, val, detail: type === 'Line' ? (pmName.match(/(\d+)C/i) ? pmName.match(/(\d+)C/i)[0] : 'Cable') : pmName, rawName: pmName });
        });
        return { name, items };
    };

    allFolders.forEach(f => {
        const fname = f.querySelector('name')?.textContent || "";
        const children = Array.from(f.children).filter(c => c.tagName === 'Folder');
        const childrenNames = children.map(c => c.querySelector('name')?.textContent || "");

        if (childrenNames.some(n => ['FAT', 'CABLE', 'DISTRIBUTION CABLE', 'HP COVER', 'SLACK HANGER', 'SLING WIRE'].includes(n))) {
            const match = fname.match(/LINE\s+([A-Z])\s+FDT\s+(\d+)/i);
            const subData = [];
            children.forEach(sub => {
                const stats = getStats(sub);
                if(stats) subData.push(stats);
            });
            zoneStats.push({
                fullName: fname,
                fdt: match ? parseInt(match[2]) : 999,
                line: match ? match[1] : fname,
                data: subData
            });
        }
    });

    zoneStats.sort((a, b) => a.fdt !== b.fdt ? a.fdt - b.fdt : a.line.localeCompare(b.line));

    if (globalErrorLog.length > 0) {
        container.innerHTML += `<div class="error-log" style="display:block"><strong>⚠️ Alerts:</strong><br>${globalErrorLog.join('<br>')}</div>`;
    }

    const fdtGroups = {};
    zoneStats.forEach(zone => {
        if (!fdtGroups[zone.fdt]) fdtGroups[zone.fdt] = { lines: [], totals: {} };
        fdtGroups[zone.fdt].lines.push(zone);
        zone.data.forEach(d => {
            if (!fdtGroups[zone.fdt].totals[d.name]) fdtGroups[zone.fdt].totals[d.name] = 0;
            fdtGroups[zone.fdt].totals[d.name] += (d.name.includes('CABLE') || d.name === 'SLING WIRE') ? d.items.reduce((acc, i) => acc + i.val, 0) : d.items.length;
        });
    });

    Object.keys(fdtGroups).sort((a,b) => a-b).forEach(fdtKey => {
        const group = fdtGroups[fdtKey];
        let html = `<div class="summary-group"><div class="fdt-header"><span>${fdtKey === '999' ? 'GLOBAL' : `FDT ${fdtKey}`}</span></div><table class="fdt-summary-table"><tr><th>Item</th><th>Qty</th></tr>`;
        Object.entries(group.totals).forEach(([k, v]) => {
            html += `<tr><td>${k}</td><td><b>${v} ${(k.includes('CABLE') || k === 'SLING WIRE') ? 'm' : (k.includes('HP') ? 'HP' : 'unit')}</b></td></tr>`;
        });
        html += `</table>`;

        group.lines.forEach(line => {
            html += `<div class="line-section"><div class="line-title">📁 ${line.fullName}</div><table class="line-table"><tr><th>Item</th><th>Qty</th><th>Breakdown</th></tr>`;
            line.data.forEach(d => {
                let detailMap = {};
                if (d.name.includes('CABLE') || d.name === 'SLING WIRE') {
                    d.items.forEach(i => detailMap[i.detail] = (detailMap[i.detail] || 0) + i.val);
                } else {
                    d.items.forEach(i => { detailMap[i.detail] = (detailMap[i.detail] || 0) + 1; });
                }
                const dets = Object.entries(detailMap).map(([k, v]) => {
                    const isHp = d.name.includes('HP COVER');
                    const color = isHp ? (v >= 10 && v <= 16 ? '#4ade80' : '#ef4444') : '#aaa';
                    return `<span class="badge" style="color:${color}">${k}: ${v}${d.name.includes('CABLE') ? 'm' : ''}</span>`;
                });
                html += `<tr><td>${d.name}</td><td><b>${d.items.length}</b></td><td><div class="breakdown-cell">${dets.join('')}</div></td></tr>`;
            });
            html += `</table></div>`;
        });
        container.innerHTML += html + `</div>`;
    });
}

/* ================= LOGIC: AUTO CORRECT HIERARCHY (POLE, FAT, SLINGWIRE) ================= */
export function autoCorrectHierarchy(xmlDoc, mode, enableAutoCorrect = true) {
    if (!enableAutoCorrect || mode !== 'cluster') return;

    const TOLERANCE = 2; // Radius 2 meter
    const placemarks = Array.from(xmlDoc.querySelectorAll('Placemark'));

    const getParentLineFolder = (node) => {
        let curr = node.parentElement;
        while (curr && curr.tagName === 'Folder') {
            const n = curr.querySelector('name')?.textContent.trim().toUpperCase() || '';
            if (n.includes('LINE ')) return curr;
            curr = curr.parentElement;
        }
        return null;
    };

    const getLineCoords = (pm) => {
        const ls = pm.querySelector('LineString coordinates');
        if (!ls) return [];
        return ls.textContent.trim().split(/\s+/).map(pair => {
            const [lon, lat] = pair.split(',').map(Number);
            return { lon, lat };
        });
    };

    const checkPointToLineDistance = (pt, lineCoords) => {
        let minD = Infinity;
        for (let i = 0; i < lineCoords.length - 1; i++) {
            const d = distToSegment(pt, lineCoords[i], lineCoords[i+1]);
            if (d < minD) minD = d;
        }
        return minD;
    };

    const extractId = (name) => {
        const match = name.match(/(\d{1,3})\b(?!\D*\d)/);
        return match ? parseInt(match[1], 10) : null;
    };

    const allFolders = Array.from(xmlDoc.querySelectorAll('Folder'));

    // --- PHASE 1: KUMPULIN ANCHOR (DIST CABLE) & SLING WIRE ---
    const distCables = [];
    const slingWires = [];

    placemarks.forEach(pm => {
        const folderName = (pm.parentElement.querySelector('name')?.textContent || '').trim().toUpperCase();
        if (folderName === 'DISTRIBUTION CABLE') {
            const pLine = getParentLineFolder(pm);
            if (pLine) distCables.push({ element: pm, coords: getLineCoords(pm), parentLine: pLine });
        } else if (folderName === 'SLING WIRE') {
            // Sling wire status awal "kosong", biar dia ngikutin arus jaringan
            slingWires.push({ element: pm, coords: getLineCoords(pm), parentLine: null });
        }
    });

    // --- PHASE 2: KUMPULIN TITIK NODE (POLE & FAT) ---
    const nodes = [];
    placemarks.forEach(pm => {
        const name = (pm.querySelector('name')?.textContent || '').toUpperCase().trim();
        const folderName = (pm.parentElement.querySelector('name')?.textContent || '').trim().toUpperCase();
        
        const isPole = folderName.includes('POLE') || name.includes('POLE') || name.includes('TIANG');
        const isFat = folderName === 'FAT' || name.includes('FAT');

        if (isPole || isFat) {
            const ptEl = pm.querySelector('Point coordinates');
            if (!ptEl) return;
            const [lon, lat] = ptEl.textContent.trim().split(',').map(Number);
            nodes.push({
                element: pm, name, folderName, isPole, isFat, pt: { lon, lat },
                currentParentLine: getParentLineFolder(pm),
                numericId: isPole ? extractId(name) : null, // FIX: ID angka mutlak cuma buat Pole!
                resolvedLine: null, // Tempat folder akhir yang benar
                touchingDist: [],
                touchingSling: []
            });
        }
    });

    // --- PHASE 3: MAPPING SENTUHAN FISIK ---
    nodes.forEach(node => {
        distCables.forEach(dist => {
            if (checkPointToLineDistance(node.pt, dist.coords) <= TOLERANCE) node.touchingDist.push(dist);
        });
        slingWires.forEach(sling => {
            if (checkPointToLineDistance(node.pt, sling.coords) <= TOLERANCE) node.touchingSling.push(sling);
        });
    });

    const undisputedPoleRanges = {}; 
    const lineNameToFolder = {}; 

    // --- PHASE 4: ASSIGN NODE YANG LANGSUNG NEMPEL KABEL UTAMA ---
    nodes.forEach(node => {
        if (node.touchingDist.length > 0) {
            let chosenDist = node.touchingDist[0];
            
            // Kalau nempel persimpangan 2 kabel utama, akalin pakai inisial FAT buat nentuin
            if (node.touchingDist.length > 1 && node.isFat) {
                const match = node.name.match(/\b([A-Z])\d{1,3}\b/i) || node.name.match(/^[A-Z]/i);
                if (match) {
                    const guessLine = `LINE ${match[1].toUpperCase()}`;
                    const found = node.touchingDist.find(d => d.parentLine.querySelector('name').textContent.toUpperCase().includes(guessLine));
                    if (found) chosenDist = found;
                }
            }
            
            node.resolvedLine = chosenDist.parentLine;
            const lnName = node.resolvedLine.querySelector('name').textContent.trim().toUpperCase();
            lineNameToFolder[lnName] = node.resolvedLine;
            
            // Daftarin ID Pole ke kekuasaan Line tersebut
            if (node.isPole && node.numericId !== null) {
                if (!undisputedPoleRanges[lnName]) undisputedPoleRanges[lnName] = new Set();
                undisputedPoleRanges[lnName].add(node.numericId);
            }
        }
    });

    // --- PHASE 5: PENYEBARAN BERANTAI (FLOOD FILL NETWORK) ---
    // Menjalar dari Tiang yang sah -> Sling Wire -> Tiang Ujung
    let changed = true;
    let iters = 0;
    while (changed && iters < 50) { // Limit muter 50 kali biar gak infinite loop
        changed = false;
        iters++;

        // A. Tiang nyetrum Sling Wire
        nodes.forEach(node => {
            if (node.resolvedLine) {
                node.touchingSling.forEach(sling => {
                    if (!sling.parentLine) {
                        sling.parentLine = node.resolvedLine; 
                        changed = true;
                    }
                });
            }
        });

        // B. Sling Wire nyetrum Tiang selanjutnya
        nodes.forEach(node => {
            if (!node.resolvedLine && node.touchingSling.some(s => s.parentLine)) {
                const resolvedSling = node.touchingSling.find(s => s.parentLine);
                node.resolvedLine = resolvedSling.parentLine;
                changed = true;

                const lnName = node.resolvedLine.querySelector('name').textContent.trim().toUpperCase();
                lineNameToFolder[lnName] = node.resolvedLine;
                
                if (node.isPole && node.numericId !== null) {
                    if (!undisputedPoleRanges[lnName]) undisputedPoleRanges[lnName] = new Set();
                    undisputedPoleRanges[lnName].add(node.numericId);
                }
            }
        });
    }

    // --- PHASE 6: RESCUE MISSION (UNTUK PULAU TERISOLASI) ---
    // Tiang nyambung ga jelas/putus total, dicari pakai urutan ID tetangganya secara berantai
    changed = true;
    iters = 0;
    while (changed && iters < 10) {
        changed = false;
        iters++;
        nodes.forEach(node => {
            if (!node.resolvedLine && node.isPole && node.numericId !== null) {
                const prevId = node.numericId - 1;
                const nextId = node.numericId + 1;
                for (const [lnName, idSet] of Object.entries(undisputedPoleRanges)) {
                    if (idSet.has(prevId) || idSet.has(nextId)) {
                        node.resolvedLine = lineNameToFolder[lnName] || allFolders.find(f => f.querySelector('name')?.textContent.trim().toUpperCase() === lnName);
                        if (node.resolvedLine) {
                            idSet.add(node.numericId);
                            changed = true;
                            break;
                        }
                    }
                }
            }
        });
    }

    // --- PHASE 7: FAT HEURISTIC (UNTUK FAT MELAYANG BEBAS) ---
    nodes.forEach(node => {
        if (!node.resolvedLine && node.isFat) {
            const match = node.name.match(/\b([A-Z])\d{1,3}\b/i) || node.name.match(/^[A-Z]/i);
            if (match) {
                const lnName = `LINE ${match[1].toUpperCase()}`;
                const folder = allFolders.find(f => f.querySelector('name')?.textContent.trim().toUpperCase() === lnName);
                if (folder) node.resolvedLine = folder;
            }
        }
    });

    // --- PHASE 8: EKSEKUSI PEMINDAHAN (POLE & FAT) ---
    nodes.forEach(node => {
        const targetLine = node.resolvedLine;
        if (targetLine && targetLine !== node.currentParentLine) {
            let subName = node.folderName;
            if (node.isPole && (subName === 'OTHERS' || subName === 'MAIN' || subName === 'SLING WIRE')) subName = 'NEW POLE 7-4';

            let subFolder = Array.from(targetLine.children).find(c => c.tagName === 'Folder' && c.querySelector('name')?.textContent.trim().toUpperCase() === subName);
            if (!subFolder) {
                subFolder = xmlDoc.createElement('Folder');
                subFolder.appendChild(createName(xmlDoc, subName));
                targetLine.appendChild(subFolder);
            }
            subFolder.appendChild(node.element);
            globalErrorLog.push(`🔄 [Auto-Urut] ${node.isPole ? 'Pole' : 'FAT'} "${node.name}" dipindah ke ${targetLine.querySelector('name').textContent}.`);
        } else if (!targetLine) {
            globalErrorLog.push(`⚠️ [Spasial] ${node.isPole ? 'Pole' : 'FAT'} "${node.name}" gagal dialokasikan ke Line manapun. Coba cek koordinat.`);
        }
    });

    // --- PHASE 9: EKSEKUSI PEMINDAHAN SLING WIRE ---
    slingWires.forEach(sling => {
        // Fallback terakhir: kalau masih ada Sling melayang yang gagal nyetrum, paksa masuk dari tiang terdekat
        if (!sling.parentLine) {
            let nearestNode = null; let minD = Infinity;
            nodes.forEach(n => {
                if (n.resolvedLine) {
                    const d = checkPointToLineDistance(n.pt, sling.coords);
                    if (d < minD) { minD = d; nearestNode = n; }
                }
            });
            if (nearestNode && minD <= TOLERANCE) sling.parentLine = nearestNode.resolvedLine;
        }

        if (sling.parentLine) {
            const currentFolder = sling.element.parentElement;
            let targetFolder = Array.from(sling.parentLine.children).find(c => c.tagName === 'Folder' && c.querySelector('name')?.textContent.trim().toUpperCase() === 'SLING WIRE');
            
            if (!targetFolder) {
                targetFolder = xmlDoc.createElement('Folder');
                targetFolder.appendChild(createName(xmlDoc, 'SLING WIRE'));
                sling.parentLine.appendChild(targetFolder);
            }
            if (currentFolder !== targetFolder) {
                targetFolder.appendChild(sling.element);
            }
        }
    });
}

export function splitSlingWires(xmlDoc) {
    const placemarks = Array.from(xmlDoc.querySelectorAll('Placemark'));
    const poles = [];

    // Kumpulin semua titik Tiang
    placemarks.forEach(pm => {
        const name = (pm.querySelector('name')?.textContent || '').toUpperCase();
        const folderName = (pm.parentElement?.querySelector('name')?.textContent || '').toUpperCase();
        if (folderName.includes('POLE') || name.includes('POLE') || name.includes('TIANG')) {
            const pt = pm.querySelector('Point coordinates');
            if (pt) {
                const [lon, lat] = pt.textContent.trim().split(',').map(Number);
                poles.push({ lon, lat, name });
            }
        }
    });

    const slingWires = placemarks.filter(pm => {
        const folderName = (pm.parentElement?.querySelector('name')?.textContent || '').trim().toUpperCase();
        return folderName === 'SLING WIRE' && pm.querySelector('LineString coordinates');
    });

    slingWires.forEach(pm => {
        const ls = pm.querySelector('LineString coordinates');
        if (!ls) return;
        
        // Ambil semua vertex (titik belok) dari Sling Wire
        const coords = ls.textContent.trim().split(/\s+/).map(pair => {
            const [lon, lat] = pair.split(',').map(Number);
            return { lon, lat };
        });

        if (coords.length < 2) return;

        const segments = [];
        let currentPath = [coords[0]];

        // Telusuri segmen demi segmen
        for (let i = 1; i < coords.length; i++) {
            const p1 = currentPath[currentPath.length - 1];
            const p2 = coords[i];

            const polesOnSegment = [];
            
            // Cek ada tiang nggak di tengah-tengah garis ini?
            poles.forEach(pole => {
                const d = distToSegment(pole, p1, p2);
                if (d <= 2 && haversine(pole, p1) > 2) { 
                    polesOnSegment.push({ ...pole, dist: haversine(p1, pole) });
                }
            });

            if (polesOnSegment.length > 0) {
                // Urutin tiang berdasarkan jarak dari titik awal biar motongnya urut
                polesOnSegment.sort((a, b) => a.dist - b.dist);

                polesOnSegment.forEach(pole => {
                    currentPath.push({ lon: pole.lon, lat: pole.lat }); // Tutup potongan
                    segments.push([...currentPath]); // Simpan potongan
                    currentPath = [{ lon: pole.lon, lat: pole.lat }]; // Mulai potongan baru dari tiang ini
                });
            }
            
            if (haversine(currentPath[currentPath.length - 1], p2) > 2) {
                 currentPath.push(p2);
            }
        }
        if (currentPath.length > 1) segments.push(currentPath);

        // Kalau berhasil dipotong > 1, hapus garis lama, ganti sama garis potongan
        if (segments.length > 1) {
            const parent = pm.parentElement;
            const originalName = pm.querySelector('name')?.textContent || 'SLING WIRE';
            
            segments.forEach((seg, idx) => {
                const clone = pm.cloneNode(true);
                const cloneLs = clone.querySelector('LineString coordinates');
                cloneLs.textContent = seg.map(p => `${p.lon},${p.lat},0`).join(' ');
                
                const nameTag = clone.querySelector('name');
                if (nameTag) nameTag.textContent = `${originalName} (Segmen ${idx+1})`;
                
                parent.appendChild(clone);
            });
            pm.remove(); // Bye bye Trojan Horse!
        }
    });
}

/* ================= FITUR BARU: SCRAPE ALAMAT PER FAT ================= */
export let scrapeAbortController = null;

export function cancelScrape() {
    if (scrapeAbortController) {
        scrapeAbortController.abort();
        console.log("🛑 PROSES SCRAPE DIBATALKAN OLEH USER!");
    }
}

// ---> TAMBAHAN: Parameter onProgress buat update UI
export async function testScrapeFatAddresses(xmlDoc, onProgress = null) {
    console.log("🔍 Memulai pencarian titik FAT...");
    const allFolders = Array.from(xmlDoc.querySelectorAll('Folder'));
    const fatDataList = [];

    const lineFolders = allFolders.filter(f => f.querySelector('name')?.textContent.trim().toUpperCase().includes('LINE '));
    lineFolders.forEach(lineFolder => {
        const lineName = lineFolder.querySelector('name').textContent.trim();
        const fatFolder = Array.from(lineFolder.children).find(c =>
            c.tagName === 'Folder' && c.querySelector('name')?.textContent.trim().toUpperCase() === 'FAT'
        );

        if (fatFolder) {
            fatFolder.querySelectorAll('Placemark').forEach(pm => {
                const fatName = pm.querySelector('name')?.textContent.trim() || 'Unknown FAT';
                const pt = pm.querySelector('Point coordinates');
                if (pt) {
                    const [lng, lat] = pt.textContent.trim().split(',').map(Number);
                    fatDataList.push({ lineName, fatName, lat, lng });
                }
            });
        }
    });

    if (fatDataList.length === 0) return null;

    scrapeAbortController = new AbortController();
    const signal = scrapeAbortController.signal;

    // ---> Variabel untuk tracking progress
    let completed = 0;
    const total = fatDataList.length;
    if (onProgress) onProgress(0, total, "Memulai koneksi...");

    try {
        const finalResults = await Promise.all(fatDataList.map(async (fat) => {
            try {
                const response = await fetch('../api/get-address', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat: fat.lat, lng: fat.lng }),
                    signal: signal 
                });

                const data = await response.json();
                let resultObj = { ...fat, jalan: '-', desa: '-', kecamatan: '-', kabupaten: '-' };

                if (data.success) {
                    resultObj = { ...resultObj, ...data };
                    
                    // ==========================================
                    // FITUR BARU: TEXT CLEANER / PENCUCI STRING
                    // ==========================================
                    const cleanTxt = (txt) => {
                        if (!txt || txt === '-') return '-';
                        // 1. Hapus awalan: Provinsi, Kota, Kabupaten, Kab., Kecamatan, Kec., Desa, Kelurahan, Kel.
                        let res = txt.replace(/^(PROVINSI|KOTA|KABUPATEN|KAB\.|KECAMATAN|KEC\.|DESA|KELURAHAN|KEL\.)\s+/i, '');
                        // 2. Hapus akhiran "CITY" (buat ngakalin Google yg sok Inggris kyk "PALU CITY")
                        res = res.replace(/\s+CITY$/i, '');
                        return res.trim().toUpperCase(); // Sekalian di-uppercase biar seragam
                    };

                    resultObj.provinsi = cleanTxt(resultObj.provinsi);
                    resultObj.kabupaten = cleanTxt(resultObj.kabupaten);
                    resultObj.kecamatan = cleanTxt(resultObj.kecamatan);
                    resultObj.desa = cleanTxt(resultObj.desa);
                    // ==========================================
                }
                
                // ---> Lapor ke UI setiap 1 FAT selesai
                completed++;
                if (onProgress) onProgress(completed, total, fat.fatName);
                
                return resultObj;
            } catch (err) {
                if (err.name === 'AbortError') return null; 
                completed++;
                if (onProgress) onProgress(completed, total, `Error di ${fat.fatName}`);
                return { ...fat, jalan: '-', desa: '-' };
            }
        }));

        const validResults = finalResults.filter(r => r !== null);
        if (validResults.length === 0) return null; // Berarti di-cancel

        // (Jurus Pinjam Tetangga tetep ada di sini)
        for (let i = 0; i < validResults.length; i++) {
            let item = validResults[i];
            if (!item.jalan || item.jalan === '-' || item.jalan.toLowerCase().includes('unnamed')) {
                let tetangga = validResults.find((t, idx) => 
                    t.lineName === item.lineName && t.jalan && t.jalan !== '-' && 
                    !t.jalan.toLowerCase().includes('unnamed') && Math.abs(idx - i) <= 2 
                );
                item.jalan = tetangga ? tetangga.jalan : "Alamat Tidak Terpetakan";
            }

            // ========================================================
            // FITUR BARU: PENYERAGAMAN HYBRID (PROVINSI & KABUPATEN AJA)
            // DAN SMART FILL KODEPOS
            // ========================================================
            const frekuensi = { provinsi: {}, kabupaten: {}, kodepos: {} };

            // 1. Kumpulin data buat nyari yang paling dominan (Modus)
            validResults.forEach(item => {
                if (item.provinsi && item.provinsi !== '-' && item.provinsi !== 'UNKNOWN') 
                    frekuensi.provinsi[item.provinsi] = (frekuensi.provinsi[item.provinsi] || 0) + 1;
                
                if (item.kabupaten && item.kabupaten !== '-' && item.kabupaten !== 'UNKNOWN') 
                    frekuensi.kabupaten[item.kabupaten] = (frekuensi.kabupaten[item.kabupaten] || 0) + 1;
                    
                if (item.kodepos && item.kodepos !== '-' && item.kodepos !== 'UNKNOWN') 
                    frekuensi.kodepos[item.kodepos] = (frekuensi.kodepos[item.kodepos] || 0) + 1;
            });

            const getDominan = (obj) => Object.keys(obj).sort((a, b) => obj[b] - obj[a])[0] || '-';
            
            const domProvinsi = getDominan(frekuensi.provinsi);
            const domKabupaten = getDominan(frekuensi.kabupaten);
            const domKodeposGlobal = getDominan(frekuensi.kodepos); // Buat jaga-jaga kalau sekampung ga ada kodepos

            // 2. Eksekusi Penyeragaman & Penambalan Kodepos
            validResults.forEach(item => {
                // A. Seragamkan Provinsi & Kabupaten secara mutlak
                if (domProvinsi !== '-') item.provinsi = domProvinsi;
                if (domKabupaten !== '-') item.kabupaten = domKabupaten;
                
                // B. Tambal Kodepos yang bolong
                if (!item.kodepos || item.kodepos === '-') {
                    // Cari tetangga yang desanya sama dan kodeposnya ada isinya
                    let tetanggaDesa = validResults.find(t => t.desa === item.desa && t.kodepos && t.kodepos !== '-');
                    
                    if (tetanggaDesa) {
                        item.kodepos = tetanggaDesa.kodepos; // Pinjem kodepos tetangga se-desa
                    } else {
                        // Kalau satu desa ga ada yang punya kodepos, pinjem kodepos dominan di project ini
                        item.kodepos = domKodeposGlobal !== '-' ? domKodeposGlobal : '';
                    }
                }
            });
            console.log("✅ Data Administratif Hybrid Berhasil Diterapkan!");
            // ========================================================
        }

        return validResults;
    } catch (err) {
        if (err.name !== 'AbortError') console.error("Fatal Error saat Promise.all:", err);
        return null;
    }
}