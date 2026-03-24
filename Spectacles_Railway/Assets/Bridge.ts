import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"

@component
export class Bridge extends BaseScriptComponent {
    private cellsBound: boolean = false

    onAwake() {
        this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    }

    private onUpdate() {
        if (!this.cellsBound) {
            this.tryBindCells()
        }
        this.bindNewTracks()
        this.bindNewSources()
    }

    private findInteractable(obj: SceneObject): Interactable | null {
        const inter = obj.getComponent(Interactable.getTypeName()) as Interactable
        if (inter) return inter
        for (let c = 0; c < obj.getChildrenCount(); c++) {
            const childInter = this.findInteractable(obj.getChild(c))
            if (childInter) return childInter
        }
        return null
    }

    private tryBindCells() {
        const gridData = (global as any).gridData
        if (!gridData) return

        const size: number = gridData.gridSize
        let count = 0

        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const cell: SceneObject = gridData.cells[row][col]
                const interactable = this.findInteractable(cell)

                if (interactable) {
                    this.bindCell(interactable, row, col)
                    count++
                }
            }
        }

        this.cellsBound = true
        print("Bridge: " + count + "/" + (size * size) + " cells bound")
    }

    private bindNewTracks() {
        const queue = (global as any).newTracks as SceneObject[] | undefined
        if (!queue || queue.length === 0) return

        const items = queue.splice(0)
        for (let i = 0; i < items.length; i++) {
            const obj = items[i]
            const interactable = this.findInteractable(obj)

            if (interactable) {
                this.bindTrack(interactable, obj)
                print("Bridge: track bound -- " + obj.name)
            } else {
                print("Bridge: no Interactable on track " + obj.name)
            }
        }
    }

    private bindCell(interactable: Interactable, row: number, col: number) {
        interactable.onTriggerStart.add(() => {
            this.pushEvent("triggerStart", row, col)
        })

        interactable.onTriggerEnd.add(() => {
            this.pushEvent("triggerEnd", row, col)
        })

        interactable.onHoverEnter.add(() => {
            this.pushEvent("hoverEnter", row, col)
        })

        interactable.onHoverExit.add(() => {
            this.pushEvent("hoverExit", row, col)
        })
    }

    private bindNewSources() {
        const queue = (global as any).newSources as SceneObject[] | undefined
        if (!queue || queue.length === 0) return

        const items = queue.splice(0)
        for (let i = 0; i < items.length; i++) {
            const obj = items[i]
            const interactable = this.findInteractable(obj)

            if (interactable) {
                this.bindSource(interactable, obj)
                print("Bridge: source bound -- " + obj.name)
            } else {
                print("Bridge: no Interactable on source " + obj.name)
            }
        }
    }

    private bindSource(interactable: Interactable, obj: SceneObject) {
        const grabHandler = () => {
            this.pushTrackEvent("sourceGrab", obj)
        }

        const releaseHandler = () => {
            this.pushTrackEvent("sourceRelease", obj)
        }

        interactable.onTriggerStart.add(grabHandler)
        interactable.onTriggerEnd.add(releaseHandler)
        interactable.onTriggerEndOutside.add(releaseHandler)
        interactable.onTriggerCanceled.add(releaseHandler)
    }

    private bindTrack(interactable: Interactable, obj: SceneObject) {
        const grabHandler = () => {
            this.pushTrackEvent("trackGrab", obj)
        }

        const releaseHandler = () => {
            this.pushTrackEvent("trackRelease", obj)
        }

        interactable.onTriggerStart.add(grabHandler)
        interactable.onTriggerEnd.add(releaseHandler)
        interactable.onTriggerEndOutside.add(releaseHandler)
        interactable.onTriggerCanceled.add(releaseHandler)
    }

    private pushEvent(type: string, row: number, col: number) {
        if (!(global as any).gridEvents) {
            (global as any).gridEvents = []
        }
        (global as any).gridEvents.push({ type: type, row: row, col: col })
    }

    private pushTrackEvent(type: string, obj: SceneObject) {
        if (!(global as any).gridEvents) {
            (global as any).gridEvents = []
        }
        (global as any).gridEvents.push({ type: type, trackObj: obj })
    }
}
