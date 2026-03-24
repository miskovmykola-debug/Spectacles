// InputHandler.js

// @input Component.Camera cam {"label": "Camera"}
// @input SceneObject[] trackSources {"label": "Track Sources (drag from)"}
// @input Asset.ObjectPrefab[] trackPrefabs {"label": "Track Prefabs (same order)"}
// @input float trackPadding = 0.05 {"label": "Track Padding (0-0.5)"}
// @input float trackManualScale = 1.0 {"label": "Track Manual Scale"}
// @input string switchName = "test" {"label": "Shader Switch Name"}
// @input int rotationAxis = 1 {"label": "Rotation Axis (0=X, 1=Y, 2=Z)", "widget": "combobox", "values": [{"label": "X", "value": 0}, {"label": "Y", "value": 1}, {"label": "Z", "value": 2}]}
// @input vec3 baseRotation = {0, 0, 0} {"label": "Base Rotation (degrees)"}
// @input float dropHeight = 30.0 {"label": "Drop Height (cm)"}
// @input float dropDuration = 0.4 {"label": "Drop Duration (sec)"}
// @input string trackSwitchName = "test" {"label": "Track Shader Switch Name"}

let tracks = [];
let cellSpacing = 1.0;
let ready = false;
let pendingSnaps = [];
let hoveredRow = -1;
let hoveredCol = -1;

let grabbedTrack = null;
let dragFeedbackRow = -1;
let dragFeedbackCol = -1;

let sourceEntries = [];
let activeSource = null;

function init() {
    if (!global.gridData) return;

    const size = global.gridData.gridSize;
    for (let row = 0; row < size; row++) {
        tracks[row] = [];
        for (let col = 0; col < size; col++) {
            tracks[row][col] = null;
        }
    }

    if (size >= 2) {
        const p0 = global.gridData.cells[0][0].getTransform().getLocalPosition();
        const p1 = global.gridData.cells[0][1].getTransform().getLocalPosition();
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const dz = p1.z - p0.z;
        cellSpacing = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    if (script.trackSources && script.trackPrefabs) {
        const count = Math.min(script.trackSources.length, script.trackPrefabs.length);
        for (let i = 0; i < count; i++) {
            const src = script.trackSources[i];
            if (!src || !script.trackPrefabs[i]) continue;

            const body = findBody(src);
            if (body) {
                body.dynamic = true;
            }

            sourceEntries.push({
                obj: src,
                prefabIndex: i,
                origPos: src.getTransform().getLocalPosition(),
                origRot: src.getTransform().getLocalRotation(),
                body: body
            });
            registerSourceForSIK(src);
            print("InputHandler: source[" + i + "] registered -- " + src.name);
        }
    }

    ready = true;
    print("InputHandler ready. Cell spacing: " + cellSpacing.toFixed(4));
}

// ---- Recursive component finders ----

function findVisual(obj) {
    const vis = obj.getComponent("Component.RenderMeshVisual");
    if (vis) return vis;
    for (let c = 0; c < obj.getChildrenCount(); c++) {
        const childVis = findVisual(obj.getChild(c));
        if (childVis) return childVis;
    }
    return null;
}

function findBody(obj) {
    const body = obj.getComponent("Physics.BodyComponent");
    if (body) return body;
    for (let c = 0; c < obj.getChildrenCount(); c++) {
        const childBody = findBody(obj.getChild(c));
        if (childBody) return childBody;
    }
    return null;
}

function getTrackScale() {
    const shrink = 1.0 - (script.trackPadding * 2);
    return cellSpacing * shrink * script.trackManualScale;
}

function makeRotation(steps) {
    const angle = steps * Math.PI / 2;
    const deg2rad = Math.PI / 180;
    const bx = script.baseRotation.x * deg2rad;
    const by = script.baseRotation.y * deg2rad;
    const bz = script.baseRotation.z * deg2rad;
    const baseQ = quat.fromEulerAngles(bx, by, bz);

    let tapQ;
    const axis = script.rotationAxis;
    if (axis === 0) tapQ = quat.fromEulerAngles(angle, 0, 0);
    else if (axis === 2) tapQ = quat.fromEulerAngles(0, 0, angle);
    else tapQ = quat.fromEulerAngles(0, angle, 0);

    return tapQ.multiply(baseQ);
}

// ---- Cell lookup ----

function findCellByScreenPos(touchPos) {
    const grid = global.gridData;
    let closestDist = Infinity;
    let closestRow = -1;
    let closestCol = -1;

    for (let row = 0; row < grid.gridSize; row++) {
        for (let col = 0; col < grid.gridSize; col++) {
            const worldPos = grid.cells[row][col].getTransform().getWorldPosition();
            const screenPos = script.cam.worldSpaceToScreenSpace(worldPos);
            const dx = screenPos.x - touchPos.x;
            const dy = screenPos.y - touchPos.y;
            const dist = dx * dx + dy * dy;

            if (dist < closestDist) {
                closestDist = dist;
                closestRow = row;
                closestCol = col;
            }
        }
    }

    if (closestRow < 0) return null;
    return { row: closestRow, col: closestCol };
}

function findNearestCellByLocalPos(localPos) {
    const grid = global.gridData;
    let closestDist = Infinity;
    let closestRow = -1;
    let closestCol = -1;

    for (let row = 0; row < grid.gridSize; row++) {
        for (let col = 0; col < grid.gridSize; col++) {
            const cp = grid.cells[row][col].getTransform().getLocalPosition();
            const dx = cp.x - localPos.x;
            const dz = cp.z - localPos.z;
            const dist = dx * dx + dz * dz;

            if (dist < closestDist) {
                closestDist = dist;
                closestRow = row;
                closestCol = col;
            }
        }
    }

    if (closestRow < 0) return null;
    return { row: closestRow, col: closestCol };
}

function findNearestCellByWorldPos(worldPos) {
    const grid = global.gridData;
    let closestDist = Infinity;
    let closestRow = -1;
    let closestCol = -1;

    for (let row = 0; row < grid.gridSize; row++) {
        for (let col = 0; col < grid.gridSize; col++) {
            const cp = grid.cells[row][col].getTransform().getWorldPosition();
            const dx = cp.x - worldPos.x;
            const dz = cp.z - worldPos.z;
            const dist = dx * dx + dz * dz;

            if (dist < closestDist) {
                closestDist = dist;
                closestRow = row;
                closestCol = col;
            }
        }
    }

    if (closestRow < 0) return null;
    return { row: closestRow, col: closestCol };
}

function isInsideGridWorld(worldPos) {
    const grid = global.gridData;
    if (grid.gridSize < 2) return true;
    const c00 = grid.cells[0][0].getTransform().getWorldPosition();
    const cNN = grid.cells[grid.gridSize - 1][grid.gridSize - 1].getTransform().getWorldPosition();
    const cx = (c00.x + cNN.x) / 2;
    const cz = (c00.z + cNN.z) / 2;
    const halfX = Math.abs(cNN.x - c00.x) / 2 + cellSpacing * 0.5;
    const halfZ = Math.abs(cNN.z - c00.z) / 2 + cellSpacing * 0.5;
    return Math.abs(worldPos.x - cx) <= halfX && Math.abs(worldPos.z - cz) <= halfZ;
}

function findTrackByObject(obj) {
    const grid = global.gridData;
    for (let row = 0; row < grid.gridSize; row++) {
        for (let col = 0; col < grid.gridSize; col++) {
            if (tracks[row][col] && tracks[row][col].sceneObject === obj) {
                return { row: row, col: col };
            }
        }
    }
    return null;
}

function isValidCell(row, col) {
    const grid = global.gridData;
    return row >= 0 && row < grid.gridSize && col >= 0 && col < grid.gridSize;
}

// ---- Highlight (grid cell: 0=default, 1=green, 2=red) ----

function setCellSwitch(row, col, value) {
    if (row < 0 || col < 0) return;
    const cellMv = findVisual(global.gridData.cells[row][col]);
    if (cellMv && cellMv.mainMaterial) {
        cellMv.mainMaterial.mainPass[script.switchName] = value;
    }
}

function highlightCell(row, col) {
    setCellSwitch(row, col, 1.0);
}

function unhighlightCell(row, col) {
    setCellSwitch(row, col, 0.0);
}

function clearAllHighlights() {
    if (!global.gridData) return;
    const grid = global.gridData;
    for (let row = 0; row < grid.gridSize; row++) {
        for (let col = 0; col < grid.gridSize; col++) {
            const mv = findVisual(grid.cells[row][col]);
            if (mv && mv.mainMaterial) {
                mv.mainMaterial.mainPass[script.switchName] = 0.0;
            }
        }
    }
    hoveredRow = -1;
    hoveredCol = -1;
}

// ---- Track shader switch (0=default, 1=green, 2=red) ----

function setTrackSwitch(obj, value) {
    const mv = findVisual(obj);
    if (mv && mv.mainMaterial) {
        mv.mainMaterial.mainPass[script.trackSwitchName] = value;
    }
}

function isInsideGrid(localPos) {
    const grid = global.gridData;
    if (grid.gridSize < 2) return true;
    const half = (grid.gridSize - 1) / 2.0;
    const maxDist = (half + 0.5) * cellSpacing;
    const cx = Math.abs(localPos.x);
    const cz = Math.abs(localPos.z);
    return cx <= maxDist && cz <= maxDist;
}

function clearDragFeedback() {
    if (dragFeedbackRow >= 0) {
        setCellSwitch(dragFeedbackRow, dragFeedbackCol, 0.0);
        const occupant = tracks[dragFeedbackRow][dragFeedbackCol];
        if (occupant) {
            setTrackSwitch(occupant.sceneObject, 0.0);
        }
        dragFeedbackRow = -1;
        dragFeedbackCol = -1;
    }
}

function updateGrabbedTrackFeedback() {
    if (!grabbedTrack) return;

    const obj = grabbedTrack.sceneObject;
    const localPos = obj.getTransform().getLocalPosition();

    clearDragFeedback();

    if (!isInsideGrid(localPos)) {
        setTrackSwitch(obj, 2.0);
        return;
    }

    const nearest = findNearestCellByLocalPos(localPos);
    if (!nearest) {
        setTrackSwitch(obj, 2.0);
        return;
    }

    dragFeedbackRow = nearest.row;
    dragFeedbackCol = nearest.col;

    const occupant = tracks[nearest.row][nearest.col];
    if (occupant) {
        setTrackSwitch(obj, 2.0);
        setCellSwitch(nearest.row, nearest.col, 2.0);
        setTrackSwitch(occupant.sceneObject, 2.0);
    } else {
        setTrackSwitch(obj, 1.0);
        setCellSwitch(nearest.row, nearest.col, 1.0);
    }
}

// ---- Physics snap (initial drop) ----

function updateSnaps() {
    const now = getTime();
    let i = pendingSnaps.length;

    while (i--) {
        const snap = pendingSnaps[i];
        const elapsed = now - snap.spawnTime;

        if (elapsed >= script.dropDuration) {
            const body = findBody(snap.sceneObject);
            if (body) {
                body.dynamic = true;
            }
            snap.sceneObject.getTransform().setLocalPosition(snap.targetPos);
            snap.sceneObject.getTransform().setLocalRotation(makeRotation(snap.rotation));
            registerTrackForSIK(snap.sceneObject);
            print("Snapped (" + snap.row + ", " + snap.col + ") to center");
            pendingSnaps.splice(i, 1);
        }
    }
}

function registerTrackForSIK(obj) {
    if (!global.newTracks) {
        global.newTracks = [];
    }
    global.newTracks.push(obj);
}

function registerSourceForSIK(obj) {
    if (!global.newSources) {
        global.newSources = [];
    }
    global.newSources.push(obj);
}

// ---- Source: drag to place ----

function findSourceEntry(obj) {
    for (let i = 0; i < sourceEntries.length; i++) {
        if (sourceEntries[i].obj === obj) return sourceEntries[i];
    }
    return null;
}

function handleSourceGrab(obj) {
    const entry = findSourceEntry(obj);
    if (!entry) return;
    activeSource = entry;
    print("SOURCE GRAB: type " + entry.prefabIndex + " (" + obj.name + ")");
}

function handleSourceRelease(obj) {
    if (!activeSource || activeSource.obj !== obj) return;
    const entry = activeSource;
    activeSource = null;

    clearDragFeedback();

    const worldPos = obj.getTransform().getWorldPosition();
    const nearest = findNearestCellByWorldPos(worldPos);

    obj.getTransform().setLocalPosition(entry.origPos);
    obj.getTransform().setLocalRotation(entry.origRot);

    if (!nearest) {
        print("SOURCE RELEASE: no nearest cell found");
        return;
    }

    const cellWorld = global.gridData.cells[nearest.row][nearest.col].getTransform().getWorldPosition();
    const dx = worldPos.x - cellWorld.x;
    const dz = worldPos.z - cellWorld.z;
    const distToCell = Math.sqrt(dx * dx + dz * dz);

    if (distToCell > cellSpacing * 1.5) {
        print("SOURCE RELEASE: too far from grid, cancelled");
        return;
    }

    if (tracks[nearest.row][nearest.col]) {
        print("SOURCE RELEASE: cell (" + nearest.row + ", " + nearest.col + ") occupied");
        setCellSwitch(nearest.row, nearest.col, 2.0);
        setTrackSwitch(tracks[nearest.row][nearest.col].sceneObject, 2.0);

        const delayEvent = script.createEvent("DelayedCallbackEvent");
        const feedbackRow = nearest.row;
        const feedbackCol = nearest.col;
        delayEvent.bind(function () {
            setCellSwitch(feedbackRow, feedbackCol, 0.0);
            if (tracks[feedbackRow] && tracks[feedbackRow][feedbackCol]) {
                setTrackSwitch(tracks[feedbackRow][feedbackCol].sceneObject, 0.0);
            }
        });
        delayEvent.reset(0.3);
        return;
    }

    placeTrackOfType(nearest.row, nearest.col, entry.prefabIndex);
    print("SOURCE RELEASE: type " + entry.prefabIndex + " placed at (" + nearest.row + ", " + nearest.col + ")");
}

function updateSourceDragFeedback() {
    if (!activeSource) return;

    const worldPos = activeSource.obj.getTransform().getWorldPosition();

    clearDragFeedback();

    if (!isInsideGridWorld(worldPos)) return;

    const nearest = findNearestCellByWorldPos(worldPos);
    if (!nearest) return;

    dragFeedbackRow = nearest.row;
    dragFeedbackCol = nearest.col;

    const occupant = tracks[nearest.row][nearest.col];
    if (occupant) {
        setCellSwitch(nearest.row, nearest.col, 2.0);
        setTrackSwitch(occupant.sceneObject, 2.0);
    } else {
        setCellSwitch(nearest.row, nearest.col, 1.0);
    }
}

function holdSourcesInPlace() {
    for (let i = 0; i < sourceEntries.length; i++) {
        const entry = sourceEntries[i];
        if (activeSource && activeSource.obj === entry.obj) continue;
        entry.obj.getTransform().setLocalPosition(entry.origPos);
        entry.obj.getTransform().setLocalRotation(entry.origRot);
    }
}

function holdTracksInPlace() {
    const grid = global.gridData;
    if (!grid) return;
    for (let row = 0; row < grid.gridSize; row++) {
        for (let col = 0; col < grid.gridSize; col++) {
            const t = tracks[row][col];
            if (!t) continue;
            if (grabbedTrack && grabbedTrack.sceneObject === t.sceneObject) continue;
            const cellPos = grid.cells[row][col].getTransform().getLocalPosition();
            t.sceneObject.getTransform().setLocalPosition(cellPos);
            t.sceneObject.getTransform().setLocalRotation(makeRotation(t.rotation));
        }
    }
}

// ---- Snap a track to a specific cell ----

function snapTrackToCell(trackData, row, col) {
    const grid = global.gridData;
    const cellLocalPos = grid.cells[row][col].getTransform().getLocalPosition();

    const body = findBody(trackData.sceneObject);
    if (body) {
        body.dynamic = true;
    }

    trackData.sceneObject.getTransform().setLocalPosition(
        new vec3(cellLocalPos.x, cellLocalPos.y, cellLocalPos.z)
    );
    trackData.sceneObject.getTransform().setLocalRotation(makeRotation(trackData.rotation));
    trackData.sceneObject.name = "Track_" + row + "_" + col;
    tracks[row][col] = trackData;
}

// ---- Knockback ----

function knockbackTrack(occupantRow, occupantCol, pushRow, pushCol) {
    const occupant = tracks[occupantRow][occupantCol];
    if (!occupant) return false;

    const targetRow = occupantRow + pushRow;
    const targetCol = occupantCol + pushCol;

    if (isValidCell(targetRow, targetCol) && !tracks[targetRow][targetCol]) {
        tracks[occupantRow][occupantCol] = null;
        snapTrackToCell(occupant, targetRow, targetCol);
        print("Knockback (" + occupantRow + "," + occupantCol + ") -> (" + targetRow + "," + targetCol + ")");
        return true;
    }

    const dirs = [
        { r: -1, c: 0 }, { r: 1, c: 0 },
        { r: 0, c: -1 }, { r: 0, c: 1 }
    ];
    for (let d = 0; d < dirs.length; d++) {
        const nr = occupantRow + dirs[d].r;
        const nc = occupantCol + dirs[d].c;
        if (isValidCell(nr, nc) && !tracks[nr][nc]) {
            tracks[occupantRow][occupantCol] = null;
            snapTrackToCell(occupant, nr, nc);
            print("Knockback fallback (" + occupantRow + "," + occupantCol + ") -> (" + nr + "," + nc + ")");
            return true;
        }
    }

    print("Knockback failed -- no empty adjacent cell");
    return false;
}

// ---- Place new track ----

function placeTrackOfType(row, col, typeIndex) {
    if (!script.trackPrefabs || typeIndex >= script.trackPrefabs.length) {
        print("ERROR: no prefab for index " + typeIndex);
        return;
    }

    const prefab = script.trackPrefabs[typeIndex];
    if (!prefab) {
        print("ERROR: prefab[" + typeIndex + "] is null!");
        return;
    }
    const grid = global.gridData;
    const cellLocalPos = grid.cells[row][col].getTransform().getLocalPosition();
    const s = getTrackScale();
    const targetPos = new vec3(cellLocalPos.x, cellLocalPos.y, cellLocalPos.z);

    const obj = prefab.instantiate(grid.gridObject);
    obj.name = "Track_" + typeIndex + "_" + row + "_" + col;

    const tr = obj.getTransform();
    tr.setLocalScale(new vec3(s, s, s));
    tr.setLocalRotation(makeRotation(0));
    tr.setLocalPosition(new vec3(targetPos.x, targetPos.y + script.dropHeight, targetPos.z));

    const mv = findVisual(obj);
    if (mv && mv.mainMaterial) {
        mv.mainMaterial = mv.mainMaterial.clone();
    }

    pendingSnaps.push({
        sceneObject: obj,
        targetPos: targetPos,
        spawnTime: getTime(),
        row: row,
        col: col,
        rotation: 0
    });

    tracks[row][col] = { sceneObject: obj, rotation: 0, typeIndex: typeIndex };
    print("Placed type " + typeIndex + " at (" + row + ", " + col + ")");
}

function rotateTrack(row, col) {
    const track = tracks[row][col];
    track.rotation = (track.rotation + 1) % 4;
    track.sceneObject.getTransform().setLocalRotation(makeRotation(track.rotation));
    print("Rotated (" + row + ", " + col + ") = " + (track.rotation * 90) + "deg");
}

// ---- Grab / Release (placed tracks) ----

function handleTrackGrab(obj) {
    print("GRAB EVENT received for: " + obj.name);
    const cell = findTrackByObject(obj);
    if (!cell) {
        print("GRAB: track not found in grid");
        return;
    }

    const trackData = tracks[cell.row][cell.col];
    tracks[cell.row][cell.col] = null;

    grabbedTrack = {
        sceneObject: obj,
        rotation: trackData.rotation,
        fromRow: cell.row,
        fromCol: cell.col,
        grabTime: getTime()
    };

    const body = findBody(obj);
    if (body) {
        body.dynamic = false;
    }

    setTrackSwitch(obj, 1.0);
    print("GRAB: picked up from (" + cell.row + ", " + cell.col + ")");
}

function handleTrackRelease(obj) {
    if (!grabbedTrack || grabbedTrack.sceneObject !== obj) {
        print("RELEASE: no matching grab");
        return;
    }

    clearDragFeedback();

    const currentLocalPos = obj.getTransform().getLocalPosition();
    const nearest = findNearestCellByLocalPos(currentLocalPos);
    const holdTime = getTime() - grabbedTrack.grabTime;

    if (nearest && nearest.row === grabbedTrack.fromRow && nearest.col === grabbedTrack.fromCol && holdTime < 0.4) {
        grabbedTrack.rotation = (grabbedTrack.rotation + 1) % 4;
        setTrackSwitch(obj, 0.0);
        snapTrackToCell(grabbedTrack, grabbedTrack.fromRow, grabbedTrack.fromCol);
        print("TAP-ROTATE: (" + nearest.row + ", " + nearest.col + ") = " + (grabbedTrack.rotation * 90) + "deg");
        grabbedTrack = null;
        return;
    }

    if (!nearest) {
        setTrackSwitch(obj, 0.0);
        snapTrackToCell(grabbedTrack, grabbedTrack.fromRow, grabbedTrack.fromCol);
        print("RELEASE: no cell found, returning to origin");
        grabbedTrack = null;
        return;
    }

    let targetRow = nearest.row;
    let targetCol = nearest.col;

    if (tracks[targetRow][targetCol]) {
        const pushRow = targetRow - grabbedTrack.fromRow;
        const pushCol = targetCol - grabbedTrack.fromCol;
        const normR = pushRow === 0 ? 0 : (pushRow > 0 ? 1 : -1);
        const normC = pushCol === 0 ? 0 : (pushCol > 0 ? 1 : -1);

        let pr = normR;
        let pc = normC;
        if (pr === 0 && pc === 0) { pr = 1; }
        if (pr !== 0 && pc !== 0) {
            if (Math.abs(pushRow) >= Math.abs(pushCol)) { pc = 0; }
            else { pr = 0; }
        }

        const pushed = knockbackTrack(targetRow, targetCol, pr, pc);
        if (!pushed) {
            setTrackSwitch(obj, 0.0);
            snapTrackToCell(grabbedTrack, grabbedTrack.fromRow, grabbedTrack.fromCol);
            print("RELEASE: can't push occupant, returning to origin");
            grabbedTrack = null;
            return;
        }
    }

    setTrackSwitch(obj, 0.0);
    snapTrackToCell(grabbedTrack, targetRow, targetCol);
    print("RELEASE: placed at (" + targetRow + ", " + targetCol + ")");
    grabbedTrack = null;
}

// ---- Tap handler (cell tap = only rotate existing track) ----

function handleTap(row, col) {
    highlightCell(row, col);

    if (tracks[row][col]) {
        rotateTrack(row, col);
        print("TAP: rotated (" + row + ", " + col + ")");
    }
}

// ---- SIK event processing ----

function processSIKEvent(event) {
    if (!ready) init();
    if (!ready) return;

    if (event.type === "triggerStart" && event.row >= 0) {
        handleTap(event.row, event.col);
    }

    if (event.type === "triggerEnd") {
        unhighlightCell(event.row, event.col);
    }

    if (event.type === "hoverEnter" && event.row >= 0) {
        if (hoveredRow >= 0) unhighlightCell(hoveredRow, hoveredCol);
        hoveredRow = event.row;
        hoveredCol = event.col;
        highlightCell(event.row, event.col);
    }

    if (event.type === "hoverExit") {
        unhighlightCell(event.row, event.col);
        if (hoveredRow === event.row && hoveredCol === event.col) {
            hoveredRow = -1;
            hoveredCol = -1;
        }
    }

    if (event.type === "sourceGrab" && event.trackObj) {
        handleSourceGrab(event.trackObj);
    }

    if (event.type === "sourceRelease" && event.trackObj) {
        handleSourceRelease(event.trackObj);
    }

    if (event.type === "trackGrab" && event.trackObj) {
        handleTrackGrab(event.trackObj);
    }

    if (event.type === "trackRelease" && event.trackObj) {
        handleTrackRelease(event.trackObj);
    }
}

// --- Preview: мишка ---

let mouseSourceDrag = null;

function findSourceByScreenPos(touchPos) {
    if (!script.cam) return null;
    let closestDist = Infinity;
    let closestEntry = null;

    for (let i = 0; i < sourceEntries.length; i++) {
        const worldPos = sourceEntries[i].obj.getTransform().getWorldPosition();
        const screenPos = script.cam.worldSpaceToScreenSpace(worldPos);
        const dx = screenPos.x - touchPos.x;
        const dy = screenPos.y - touchPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.05 && dist < closestDist) {
            closestDist = dist;
            closestEntry = sourceEntries[i];
        }
    }
    return closestEntry;
}

script.createEvent("TouchStartEvent").bind(function (eventData) {
    if (!global.gridData) return;
    if (!script.cam) return;
    if (!ready) init();

    const touchPos = eventData.getTouchPosition();

    const srcHit = findSourceByScreenPos(touchPos);
    if (srcHit) {
        mouseSourceDrag = srcHit;
        handleSourceGrab(srcHit.obj);
        print("INPUT: source grab (" + srcHit.obj.name + ")");
        return;
    }
});

script.createEvent("TouchMoveEvent").bind(function (eventData) {
    if (!mouseSourceDrag || !script.cam) return;

    const touchPos = eventData.getTouchPosition();
    const camPos = script.cam.getSceneObject().getTransform().getWorldPosition();
    const srcWorld = mouseSourceDrag.obj.getTransform().getWorldPosition();
    const distToCamera = camPos.sub(srcWorld).length;

    const worldPos = script.cam.screenSpaceToWorldSpace(touchPos, distToCamera);

    mouseSourceDrag.obj.getTransform().setWorldPosition(
        new vec3(worldPos.x, srcWorld.y, worldPos.z)
    );
});

script.createEvent("TouchEndEvent").bind(function () {
    if (mouseSourceDrag) {
        handleSourceRelease(mouseSourceDrag.obj);
        print("INPUT: source release");
        mouseSourceDrag = null;
    }
    clearAllHighlights();
});

// --- Spectacles: SIK events + physics snap ---
script.createEvent("UpdateEvent").bind(function () {
    if (!ready) init();

    updateSnaps();
    updateGrabbedTrackFeedback();
    updateSourceDragFeedback();
    holdTracksInPlace();
    holdSourcesInPlace();

    if (global.gridEvents && global.gridEvents.length > 0) {
        const events = global.gridEvents.splice(0);
        for (let i = 0; i < events.length; i++) {
            processSIKEvent(events[i]);
        }
    }
});
