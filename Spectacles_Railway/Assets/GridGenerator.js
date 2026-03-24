// GridGenerator.js

// @input Asset.ObjectPrefab cellPrefab {"label": "Cell Prefab"}
// @input Asset.Material gridMaterial {"label": "Grid Material"}
// @input int gridSize = 8 {"label": "Grid Size"}
// @input float cellPadding = 0.05 {"label": "Cell Padding (0-0.5)"}
// @input vec3 cellRotation = {-90, 0, 0} {"label": "Cell Rotation (degrees)"}

let cells = [];
let cellSize = 1.0;

function findVisualInCell(obj) {
    const vis = obj.getComponent("Component.RenderMeshVisual");
    if (vis) return vis;
    for (let c = 0; c < obj.getChildrenCount(); c++) {
        const childVis = findVisualInCell(obj.getChild(c));
        if (childVis) return childVis;
    }
    return null;
}

script.createEvent("OnStartEvent").bind(function () {
    if (!script.cellPrefab) {
        print("ERROR: GridGenerator -- cellPrefab is not assigned!");
        return;
    }

    const parent = script.getSceneObject();

    const tempCell = script.cellPrefab.instantiate(parent);
    const meshVisual = findVisualInCell(tempCell);
    if (meshVisual && meshVisual.mesh) {
        const min = meshVisual.mesh.aabbMin;
        const max = meshVisual.mesh.aabbMax;
        cellSize = max.x - min.x;
    }
    tempCell.destroy();

    const half = (script.gridSize - 1) / 2.0;
    const shrink = 1.0 - (script.cellPadding * 2);

    for (let row = 0; row < script.gridSize; row++) {
        cells[row] = [];
        for (let col = 0; col < script.gridSize; col++) {
            const cell = script.cellPrefab.instantiate(parent);
            cell.name = "Cell_" + row + "_" + col;

            const x = (col - half) * cellSize;
            const z = (row - half) * cellSize;

            cell.getTransform().setLocalPosition(new vec3(x, 0, z));
            cell.getTransform().setLocalScale(new vec3(shrink, shrink, shrink));

            const deg2rad = Math.PI / 180;
            cell.getTransform().setLocalRotation(quat.fromEulerAngles(
                script.cellRotation.x * deg2rad,
                script.cellRotation.y * deg2rad,
                script.cellRotation.z * deg2rad
            ));

            if (script.gridMaterial) {
                const mv = findVisualInCell(cell);
                if (mv) {
                    mv.mainMaterial = script.gridMaterial.clone();
                }
            }

            cells[row][col] = cell;
        }
    }

    global.gridData = {
        cells: cells,
        cellSize: cellSize,
        gridSize: script.gridSize,
        gridObject: parent
    };

    print("GridGenerator: " + script.gridSize + "x" + script.gridSize + " grid ready");
});